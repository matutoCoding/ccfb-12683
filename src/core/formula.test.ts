import { describe, expect, it } from 'vitest';
import { computeGeometry, ellipticalGap } from './geometry';
import { lookupMu, invertMuFromBlocks, ATTENUATION_DB } from './attenuation';
import { planExposure } from './exposure';
import {
  DEFAULT_FILM,
  densityDifferenceFilm,
  drEquivalentDensity,
  filmDensity,
  scatterRatio,
  subjectContrast,
  transmitBeam,
} from './imaging';
import { ugLimit, DEFAULT_STANDARDS } from './standards';
import { applyDarkGain, averageFrames, repairBadPixels } from './detector';
import { detectAbrupt, sampleCylinder, summarizeThickness } from './thickness';
import type { ExposureLayout } from '@/types';

const layout = (f: number, l1: number): ExposureLayout => ({
  focalDistance: f,
  sourceToObject: l1,
  objectToDetector: f - l1,
  sourceSide: 'outside',
  offsetAngle: 0,
  sourcePos: { x: 0, y: 0, z: 0 },
  detectorPos: { x: 0, y: 0, z: f },
});

describe('几何不清晰度 Ug 标准公式', () => {
  it('Ug=d·L2/L1，与手算一致', () => {
    // d=3mm, F=700, L1=600, L2=100 → Ug=3×100/600=0.5mm
    const r = computeGeometry(3, layout(700, 600), 0.2);
    expect(r.ug).toBeCloseTo(0.5, 6);
    expect(r.magnification).toBeCloseTo(700 / 600, 10);
    expect(r.l2).toBeCloseTo(100, 10);
    expect(r.geometricBlurPx).toBeCloseTo(2.5, 6);
  });

  it('贴探测器 L2=0 时 Ug=0', () => {
    const r = computeGeometry(2.5, layout(500, 500), 0.2);
    expect(r.ug).toBeCloseTo(0, 10);
  });

  it('运动模糊与几何模糊分开计数', () => {
    const r = computeGeometry(3, layout(700, 600), 0.2, 0.3);
    expect(r.motionBlurPx).toBeCloseTo((0.3 * (700 / 600)) / 0.2, 6);
  });

  it('双壁双影椭圆开口间距判定', () => {
    const g = computeGeometry(3, layout(700, 600), 0.2);
    const e = ellipticalGap(8, g.magnification, 12, g.ug);
    // 2×8×1.1667 − (12+0.5) = 18.667−12.5 = 6.167 < 限值10 → 不合格
    expect(e.gapMm).toBeCloseTo(6.1667, 3);
    expect(e.ok).toBe(0);
  });
});

describe('Ug 标准限值分档', () => {
  const std = DEFAULT_STANDARDS[0];
  it('AB 级厚度分档查表', () => {
    expect(ugLimit(std, 10)).toBe(0.2);
    expect(ugLimit(std, 25)).toBe(0.2);
    expect(ugLimit(std, 26)).toBe(0.4);
    expect(ugLimit(std, 90)).toBe(0.8);
    expect(ugLimit(std, 150)).toBe(1.0);
    expect(ugLimit(std, 300)).toBe(1.2);
  });
});

describe('衰减系数库与半值层', () => {
  it('表点精确命中（查表一模一样）', () => {
    const r = lookupMu(Object.values(ATTENUATION_DB), 'steel', 200);
    expect(r.mu).toBe(1.06);
    expect(r.extrapolated).toBe(false);
  });

  it('HVL 与教材经验值核对：100kV≈1.2cm，200kV≈2.1cm，400kV≈3.2cm', () => {
    for (const [kv, expectedCm] of [
      [100, 3.2],
      [200, 6.55],
      [400, 12.38],
    ] as const) {
      const r = lookupMu(Object.values(ATTENUATION_DB), 'steel', kv);
      expect(r.hvlMm).toBeCloseTo(expectedCm, 1);
    }
  });

  it('管电压升高 μ 单调下降 → 对比度趋势正确', () => {
    const mu100 = lookupMu(Object.values(ATTENUATION_DB), 'steel', 100).mu;
    const mu300 = lookupMu(Object.values(ATTENUATION_DB), 'steel', 300).mu;
    expect(mu300).toBeLessThan(mu100);
    const n = scatterRatio(30);
    expect(subjectContrast(mu300, 2, n)).toBeLessThan(subjectContrast(mu100, 2, n));
  });

  it('越界外推给标记', () => {
    const r = lookupMu(Object.values(ATTENUATION_DB), 'steel', 500);
    expect(r.extrapolated).toBe(true);
    expect(r.mu).toBe(0.56);
  });

  it('两试块反推 μ 可往返还原', () => {
    // 真值 μ=2.0，t1=20,t2=30，G=2.4 → ΔD=G·μ·Δt/(10ln10)
    const muTrue = 2.0;
    const dt = 10;
    const dD = (DEFAULT_FILM.g * muTrue * dt) / (10 * Math.LN10);
    const mu = invertMuFromBlocks({
      date: 0,
      t1: 20,
      t2: 30,
      d1: 3.0 + dD,
      d2: 3.0,
      kv: 150,
      scatterRatio: 1.5,
      gradient: DEFAULT_FILM.g,
    });
    expect(mu).toBeCloseTo(muTrue, 8);
  });

  it('DR 强度比反推 μ', () => {
    // I1/I2=exp(μΔt/10)
    const mu = invertMuFromBlocks({
      date: 0,
      t1: 10,
      t2: 20,
      d1: 0,
      d2: 0,
      kv: 120,
      scatterRatio: 1,
      intensityRatio: Math.exp((1.5 * 10) / 10),
    });
    expect(mu).toBeCloseTo(1.5, 8);
  });
});

describe('环缝最少透照次数（对标准表）', () => {
  // Do=1000, Di=960, T=20, K=1.03。数值射线追踪定案，闭式 η/θ 可手算互校。
  const base = {
    outerDiameter: 1000,
    innerDiameter: 960,
    k: 1.03,
    seamType: 'circumferential' as const,
  };

  it('外透法 F=1200,K=1.03：θ=17.79°,η=7.32°（正弦定律独立验证）→ N=25', () => {
    const p = planExposure({ ...base, sourceSide: 'outside', focalDistance: 1200 });
    expect(p.halfAngleDeg).toBeCloseTo(7.315, 2);
    expect(p.shotCount).toBe(25);
  });

  it('外透法 K=1.2：θ=41.81°,η=16.13° → N=12', () => {
    const p = planExposure({ ...base, k: 1.2, sourceSide: 'outside', focalDistance: 1200 });
    expect(p.halfAngleDeg).toBeCloseTo(16.127, 2);
    expect(p.shotCount).toBe(12);
  });

  it('内透中心法 β=arccos(1/K)=13.86° → N=13（手算）', () => {
    const p = planExposure({ ...base, sourceSide: 'inside', focalDistance: 500 });
    expect(p.halfAngleDeg).toBeCloseTo(13.86, 1);
    expect(p.shotCount).toBe(13);
  });

  it('内透中心法 K=1.2：β=33.56° → N=6（手算）', () => {
    const p = planExposure({ ...base, k: 1.2, sourceSide: 'inside', focalDistance: 500 });
    expect(p.halfAngleDeg).toBeCloseTo(33.56, 1);
    expect(p.shotCount).toBe(6);
  });

  it('内透偏心法 cosβ=(F+T)/(F+KT)：F=200 → β≈4.23°,N=43，偏心后次数多于中心法', () => {
    const center = planExposure({ ...base, sourceSide: 'inside', focalDistance: 500 });
    const ecc = planExposure({ ...base, sourceSide: 'inside', focalDistance: 200 });
    expect(ecc.halfAngleDeg).toBeCloseTo(4.227, 2);
    expect(ecc.shotCount).toBe(43);
    expect(ecc.shotCount).toBeGreaterThan(center.shotCount);
  });

  it('近中心（偏移<2T）自动按中心法，保证与中心法连续', () => {
    const center = planExposure({ ...base, sourceSide: 'inside', focalDistance: 500 });
    const near = planExposure({ ...base, sourceSide: 'inside', focalDistance: 490 });
    expect(near.halfAngleDeg).toBeCloseTo(center.halfAngleDeg, 6);
    expect(near.shotCount).toBe(center.shotCount);
  });

  it('纵缝按长度/有效长度向上取整并给搭接', () => {
    const p = planExposure({
      ...base,
      seamType: 'longitudinal',
      sourceSide: 'outside',
      focalDistance: 700,
      seamLength: 1000,
      effectiveLengthPerShot: 300,
    });
    expect(p.shotCount).toBe(4);
    expect(p.layoutMarks).toHaveLength(4);
  });
});

describe('黑度与对比度物理', () => {
  it('指数衰减 + 散射', () => {
    const b = transmitBeam({ muPerCm: 2.0, thicknessMm: 30 });
    expect(b.direct).toBeCloseTo(Math.exp(-6), 10);
    expect(b.n).toBe(scatterRatio(30));
    expect(b.total).toBeCloseTo(b.direct * (1 + b.n), 10);
  });

  it('胶片黑度随曝光单调，特性曲线线性段', () => {
    // 取线性段内两个曝光量，避开 dMax 钳制：0.5→1.777，5→4.177
    const d1 = filmDensity(0.5, DEFAULT_FILM);
    const d2 = filmDensity(5, DEFAULT_FILM);
    expect(d2 - d1).toBeCloseTo(DEFAULT_FILM.g, 8); // 10倍曝光差 G 个黑度
  });

  it('黑度差公式 ΔD=GμΔt/(10ln10)', () => {
    const dd = densityDifferenceFilm(2.0, 20, 24, 1.5, 2.4);
    expect(dd).toBeCloseTo((2.4 * 2.0 * 4) / (10 * Math.LN10), 8);
  });

  it('DR 等效黑度=D0−lg10(透过率)，基准 D0=2.0', () => {
    expect(drEquivalentDensity(0.1)).toBeCloseTo(3.0, 8);
    expect(drEquivalentDensity(0.01)).toBeCloseTo(4.0, 8);
  });
});

describe('探测器校正', () => {
  const w = 2;
  const h = 2;
  const cal = {
    width: w,
    height: h,
    dark: new Float32Array([10, 10, 10, 10]),
    gain: new Float32Array([2, 1, 1, 1]),
    bad: new Uint8Array([0, 1, 0, 0]),
  };
  it('暗场扣除+增益归一', () => {
    const out = applyDarkGain(new Float32Array([110, 60, 60, 60]), cal);
    // 像素0: (110−10)×(1.25/2)=62.5；其余 (60−10)×1.25=62.5
    expect(out[0]).toBeCloseTo(62.5, 6);
    expect(out[1]).toBeCloseTo(62.5, 6);
  });
  it('坏像素邻域插值并返回坐标', () => {
    const { image, repaired } = repairBadPixels(new Float32Array([10, 0, 30, 40]), cal);
    expect(repaired).toEqual([[1, 0]]);
    expect(image[1]).toBeCloseTo((10 + 30 + 40) / 3, 4);
  });
  it('多帧平均', () => {
    const out = averageFrames([new Float32Array([2, 4]), new Float32Array([4, 8])]);
    expect(Array.from(out)).toEqual([3, 6]);
  });
});

describe('壁厚抽样与突变', () => {
  it('筒体抽样并识别突变', () => {
    const s = sampleCylinder(500, 30, 1000, 3, 4);
    expect(s).toHaveLength(12);
    const bumped = s.map((x, i) => (i === 0 ? { ...x, thickness: 45 } : x));
    const marked = detectAbrupt(bumped);
    expect(marked.some((x) => x.abrupt)).toBe(true);
    const sum = summarizeThickness({ thicknessSamples: marked });
    expect(sum.tMax).toBe(45);
    expect(sum.tMin).toBe(30);
    expect(sum.abruptCount).toBeGreaterThan(0);
  });
});
