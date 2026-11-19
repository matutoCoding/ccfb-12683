import type {
  Detector,
  ProcessParams,
  SimulationEvidence,
  SimulationResult,
  StandardLimits,
  Workpiece,
  XRayMachine,
} from '@/types';
import { lookupMu } from './attenuation';
import { computeGeometry } from './geometry';
import {
  addNoise,
  applyDarkGain,
  averageFrames,
  repairBadPixels,
  type CalibrationSet,
} from './detector';
import {
  buildEvidence,
  drEquivalentDensity,
  estimateSnr,
  filmDensity,
  scatterRatio,
  subjectContrast,
  transmitBeam,
  DEFAULT_FILM,
} from './imaging';
import { ugLimit } from './standards';
import { mean, stddev, clamp } from './math';
import { uid } from '../data/storage';

export interface SimOptions {
  width: number;
  height: number;
  /** 仿真模式：DR 平板或胶片 */
  mode: 'dr' | 'film';
  /** 焊缝中心（归一化坐标 0..1）与走向 */
  weldCenterX: number;
  weldWidthFrac: number;
  /** 焊缝余高/增厚 mm（焊缝处比母材厚） */
  weldReinforcement: number;
  /** 人工缺陷（气孔/夹渣），归一化位置与直径 mm */
  defects: { x: number; y: number; diameterMm: number; densityLoss: number }[];
  frames: number;
  calibration?: CalibrationSet;
  seed?: number;
}

/**
 * 生成一张仿真 DR/胶片图。
 * 每个像素按其几何位置确定路径厚度 t(x,y)=母材厚+焊缝增厚，
 * 指数衰减求直接强度、按厚度分档加散射，再经特性曲线转黑度/灰度，
 * 焦点半影做几何模糊卷积，坏点单独标记不与缺陷混淆。
 */
export function runSimulation(
  proc: ProcessParams,
  wp: Workpiece,
  machine: XRayMachine,
  detector: Detector,
  standard: StandardLimits,
  mu: ReturnType<typeof lookupMu>,
  opts: SimOptions,
): SimulationResult {
  const { width: w, height: h } = opts;
  const geo = computeGeometry(machine.focalSpot, proc.layout, detector.pixelSize);
  const n = scatterRatio(proc.thickness);

  // ---- 1. 逐像素厚度图 ----
  const thickness = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = (x + 0.5) / w;
      let t = proc.thickness;
      // 焊缝区增厚（余弦过渡）
      const dw = (fx - opts.weldCenterX) / opts.weldWidthFrac;
      if (Math.abs(dw) <= 1) t += opts.weldReinforcement * (0.5 + 0.5 * Math.cos(dw * Math.PI));
      // 缺陷：局部减薄（气孔含气，衰减小→更黑）
      for (const dft of opts.defects) {
        const dx = (fx - dft.x) * w * detector.pixelSize;
        const dy = ((y + 0.5) / h - dft.y) * h * detector.pixelSize;
        const dist = Math.hypot(dx, dy);
        if (dist <= dft.diameterMm / 2) t -= dft.densityLoss * (1 - dist / (dft.diameterMm / 2));
      }
      thickness[y * w + x] = Math.max(0, t);
    }
  }

  // ---- 2. 指数衰减 + 分档散射 → 总强度（相对 I0） ----
  const intensity = new Float32Array(w * h);
  for (let i = 0; i < thickness.length; i++) {
    const beam = transmitBeam({ muPerCm: mu.mu, thicknessMm: thickness[i] });
    intensity[i] = beam.total;
  }

  // ---- 3. 几何模糊（焦点半影）：盒式卷积，核宽=几何模糊像素 ----
  const blurred = geo.geometricBlurPx > 0.25 ? boxBlur(intensity, w, h, geo.geometricBlurPx) : intensity;

  // ---- 4. 加噪声、探测器校正、多帧叠加 ----
  const signalGain = 20000;
  const readNoise = 40;
  let frameStack: Float32Array[] = [];
  for (let f = 0; f < opts.frames; f++) {
    let noisy = addNoise(blurred, signalGain, readNoise, (opts.seed ?? 1) + f);
    if (opts.calibration) {
      noisy = applyDarkGain(noisy, opts.calibration);
      const repaired = repairBadPixels(noisy, opts.calibration);
      noisy = repaired.image;
    }
    frameStack.push(noisy);
  }
  const corrected = averageFrames(frameStack);

  // ---- 5. 转显示灰度（DR 线性归一；胶片走 H&D 特性曲线） ----
  const display = new Float32Array(w * h);
  const density = new Float32Array(w * h);
  const maxI = Math.max(...corrected, 1e-6);
  for (let i = 0; i < corrected.length; i++) {
    if (opts.mode === 'film') {
      const exposure = corrected[i] / maxI;
      density[i] = filmDensity(exposure, DEFAULT_FILM);
      display[i] = clamp(density[i] / DEFAULT_FILM.dMax, 0, 1);
    } else {
      // I0=1 为零厚度入射基准，corrected 即相对 I0 的剂量，等效黑度跨图口径一致
      density[i] = drEquivalentDensity(corrected[i], 1);
      // DR 显示：剂量越高越亮，反转成底片观感（厚处亮、薄处黑）
      display[i] = clamp(1 - corrected[i] / maxI, 0, 1);
    }
  }

  // ---- 6. 统计：黑度范围、SNR、主因对比度 ----
  const dMin = Math.min(...density);
  const dMax = Math.max(...density);
  const dMean = mean(Array.from(density));
  const snr = estimateSnr(mean(Array.from(corrected)) * signalGain, readNoise, opts.frames);
  const contrast = subjectContrast(mu.mu, opts.weldReinforcement || 2, n);

  const beamRef = transmitBeam({ muPerCm: mu.mu, thicknessMm: proc.thickness });
  const evidence: SimulationEvidence = buildEvidence({
    kv: proc.kv,
    muPerCm: mu.mu,
    hvlMm: mu.hvlMm,
    tvlMm: mu.tvlMm,
    thicknessMm: proc.thickness,
    focalSpot: machine.focalSpot,
    f: geo.f,
    l1: geo.l1,
    l2: geo.l2,
    ug: geo.ug,
    ugLimit: ugLimit(standard, proc.thickness),
    magnification: geo.magnification,
    beam: beamRef,
    standard: standard.standardCode,
    curveName: opts.mode === 'film' ? 'H&D 胶片特性曲线 G=2.4' : 'DR 等效黑度 −lg10(I/I0)',
  });

  return {
    id: uid('sim'),
    processId: proc.id,
    at: Date.now(),
    width: w,
    height: h,
    densityMin: dMin,
    densityMax: dMax,
    densityMean: dMean,
    snr,
    contrast,
    ug: geo.ug,
    geometricBlurPx: geo.geometricBlurPx,
    motionBlurPx: geo.motionBlurPx,
    evidence,
    // 图数据挂在非枚举字段，避免进 React state 时反复序列化
    ...({ image: display, densityMap: density, thicknessMap: thickness } as object),
  } as SimulationResult & { image: Float32Array; densityMap: Float32Array; thicknessMap: Float32Array };
}

/** 盒式模糊（可分离两次一维卷积，近似焦点半影的均匀分布） */
function boxBlur(src: Float32Array, w: number, h: number, radiusPx: number): Float32Array {
  const r = Math.max(1, Math.round(radiusPx));
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let c = 0;
      for (let k = -r; k <= r; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k));
        s += src[y * w + xx];
        c++;
      }
      tmp[y * w + x] = s / c;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let c = 0;
      for (let k = -r; k <= r; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k));
        s += tmp[yy * w + x];
        c++;
      }
      out[y * w + x] = s / c;
    }
  }
  return out;
}

/** 沿水平线取黑度剖面（黑度计拉线） */
export function densityProfile(result: SimulationResult & { densityMap?: Float32Array }, yFrac: number): number[] {
  const dm = (result as unknown as { densityMap: Float32Array }).densityMap;
  const y = Math.round(yFrac * (result.height - 1));
  const out: number[] = [];
  for (let x = 0; x < result.width; x++) out.push(dm[y * result.width + x]);
  return out;
}

export function imageStats(result: SimulationResult & { image?: Float32Array }) {
  const img = (result as unknown as { image: Float32Array }).image;
  return { mean: mean(Array.from(img)), std: stddev(Array.from(img)) };
}
