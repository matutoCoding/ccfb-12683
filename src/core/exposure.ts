import { ceilCount, RAD } from './math';
import type { SeamType, SourceSide } from '@/types';

/**
 * 环缝最少透照次数 —— 标准闭式公式定案（NB/T 47013.2 / GB/T 3323 体系）。
 *
 * 几何约定：Do 外径，Di 内径，T=(Do−Di)/2，F 源到胶片距离 mm，K 透照厚度比。
 * 一次透照两端搭接区斜射线的穿透厚度比受 K 约束，据此求单次覆盖半张角，
 * 整圈 360°、每次覆盖 2β：N=ceil(180/β)。
 *
 * ── 内透中心法（源置圆心，F=Do/2）──
 *   边缘斜射线与壁厚方向夹角即覆盖半角 θ，K=1/cosθ ⇒ θ=arccos(1/K)，β=θ
 *
 * ── 外透法（源在外，F>Do，胶片贴内壁）──
 *   θ=arccos[(1/K² − 1 + F/Do)/(F/Do)]   （工件侧半张角）
 *   η=arcsin[(Do/2F)·sinθ]                （胶片侧覆盖半张角，决定布片），β=η
 *
 * ── 内透偏心法（源在腔内偏置，F<Do/2，源到近侧壁距离为 F）──
 *   β=arccos[(Di/Do)·(1/K)]
 *   中心位置 F=Do/2 时该式退化为 arccos(1/K)，与中心法连续互校。
 */

export interface ExposureCountInput {
  outerDiameter: number;
  innerDiameter: number;
  sourceSide: SourceSide;
  focalDistance: number;
  k: number;
  seamType: SeamType;
  seamLength?: number;
  effectiveLengthPerShot?: number;
}

export interface ExposurePlan {
  shotCount: number;
  effectiveLength: number;
  overlap: number;
  centerAngles: number[];
  halfAngleDeg: number;
  layoutMarks: { start: number; end: number; center: number }[];
  method: string;
  derivation: string[];
}

export function planExposure(inp: ExposureCountInput): ExposurePlan {
  const derivation: string[] = [];

  if (inp.seamType === 'longitudinal') {
    const L = inp.seamLength ?? 0;
    const le = inp.effectiveLengthPerShot ?? 0;
    if (!(le > 0)) throw new Error('纵缝布片需要每次有效评定长度');
    const n = L > 0 ? ceilCount(L / le) : 1;
    const overlap = 20; // 搭接标记每端 20mm（标准常用值，工艺单可调）
    const marks = Array.from({ length: n }, (_, i) => ({
      start: i * le,
      end: Math.min((i + 1) * le, L || le),
      center: (i + 0.5) * le,
    }));
    derivation.push(`纵缝：N=ceil(L/Le)=ceil(${L}/${le})=${n}，搭接标记每端 ${overlap}mm`);
    return {
      shotCount: n,
      effectiveLength: le,
      overlap,
      centerAngles: [],
      halfAngleDeg: 0,
      layoutMarks: marks,
      method: '纵缝直线布片',
      derivation,
    };
  }

  const Do = inp.outerDiameter;
  const Di = inp.innerDiameter;
  const F = inp.focalDistance;
  const Ro = Do / 2;
  const k = inp.k;
  if (!(Di > 0 && Do > Di)) throw new Error('内径必须为正且小于外径');
  if (!(k > 1)) throw new Error('透照厚度比 K 必须大于 1');

  let beta: number;
  let method: string;

  if (inp.sourceSide === 'outside') {
    if (!(F > Do)) throw new Error('外透法要求源到胶片距离 F > 外径 Do');
    const ratio = F / Do;
    const cosTheta = (1 / (k * k) - 1 + ratio) / ratio;
    if (cosTheta < -1 || cosTheta > 1) {
      throw new Error('外透法几何无解：检查 K 值与 F/Do（K 越接近 1、F 越小，要求越严）');
    }
    const theta = Math.acos(cosTheta);
    const sinEta = (Do / (2 * F)) * Math.sin(theta);
    const eta = Math.asin(Math.min(1, sinEta));
    beta = (eta * 180) / Math.PI;
    method = '外透法（源在外单壁透照）';
    derivation.push(`θ=arccos[(1/K²−1+F/Do)/(F/Do)]=arccos(${cosTheta.toFixed(4)})=${((theta * 180) / Math.PI).toFixed(2)}°`);
    derivation.push(`η=arcsin[(Do/2F)·sinθ]=${beta.toFixed(2)}°，取胶片侧半张角 β=η`);
  } else {
    const t = Ro - Di / 2;
    const offset = Ro - F; // 源偏离圆心距离
    // 近中心（偏移量小于 2 倍壁厚）近似式不适用，按中心法处理，避免薄壁区公式不连续
    const isCenter = offset < 2 * t;
    if (isCenter) {
      beta = (Math.acos(1 / k) * 180) / Math.PI;
      method = '内透中心法（源置圆心或近中心，偏移<2T 按中心法）';
      derivation.push(`源偏圆心 a=${offset.toFixed(1)}mm < 2T=${(2 * t).toFixed(1)}mm，按中心法`);
      derivation.push(`θ=arccos(1/K)=arccos(${(1 / k).toFixed(4)})=${beta.toFixed(2)}°，β=θ`);
    } else {
      // 偏心内透标准式：cosβ=(F+T)/(F+K·T)，适用 a≥2T 的真实偏心布置；
      // F 越小 cosβ 越小、β 越小、次数越多，符合偏心几何。
      const cosBeta = (F + t) / (F + k * t);
      if (cosBeta >= 1 || cosBeta <= 0) throw new Error('偏心法几何无解：检查 F 与 K');
      beta = (Math.acos(cosBeta) * 180) / Math.PI;
      method = '内透偏心法（源在腔内偏置，a≥2T）';
      derivation.push(`源偏圆心 a=${offset.toFixed(1)}mm ≥ 2T，按偏心法`);
      derivation.push(`cosβ=(F+T)/(F+KT)=${cosBeta.toFixed(4)} ⇒ β=${beta.toFixed(2)}°`);
    }
  }

  const n = ceilCount(180 / beta);
  const step = 360 / n;
  // 有效评定弧长取胶片所在壁面：外透胶片在内壁(Ri)，内透在远侧外壁(Ro)
  const filmRadius = inp.sourceSide === 'outside' ? Di / 2 : Ro;
  const effectiveLength = (2 * Math.PI * filmRadius * beta) / 360;
  const coveredArc = 2 * effectiveLength;
  const perShotArc = (2 * Math.PI * filmRadius) / n;
  const overlap = Math.max(0, coveredArc - perShotArc);

  const centerAngles = Array.from({ length: n }, (_, i) => i * step);
  const layoutMarks = centerAngles.map((c) => ({ start: c - beta, end: c + beta, center: c }));
  derivation.push(`N=ceil(180/β)=ceil(180/${beta.toFixed(2)})=${n}`);
  derivation.push(`每次有效评定弧长 Le≈${effectiveLength.toFixed(1)}mm，相邻片搭接≈${overlap.toFixed(1)}mm`);

  return {
    shotCount: n,
    effectiveLength,
    overlap,
    centerAngles,
    halfAngleDeg: beta,
    layoutMarks,
    method,
    derivation,
  };
}
