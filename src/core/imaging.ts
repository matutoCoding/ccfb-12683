import type { SimulationEvidence } from '@/types';
import { clamp } from './math';

/**
 * 成像物理：单能等效指数衰减 + 分档散射比 + 探测器/胶片响应。
 * 路径厚度 t(mm)，μ(1/cm)：
 *   直接辐射 Id = I0 · exp(−μ·t/10)
 *   散射辐射 Is = n(t)·Id，总强度 I = (1+n)·Id
 * 胶片光学密度 D = Dmin + G·lg10(I/I_ref)（特性曲线线性段，G 平均梯度）
 * DR 等效光学密度 D = −lg10(I/I0)（统一黑度口径，便于同标准限值对照）
 */

/** 散射比分档表（钢，随透照厚度 n 上升；教材常用经验值，可编辑） */
export const SCATTER_TABLE_STEEL: { tMax: number; n: number }[] = [
  { tMax: 10, n: 0.6 },
  { tMax: 20, n: 1.0 },
  { tMax: 40, n: 1.5 },
  { tMax: 60, n: 2.0 },
  { tMax: 80, n: 2.5 },
  { tMax: 120, n: 3.0 },
  { tMax: Infinity, n: 3.6 },
];

export function scatterRatio(thicknessMm: number, table = SCATTER_TABLE_STEEL): number {
  for (const row of table) if (thicknessMm <= row.tMax) return row.n;
  return table[table.length - 1].n;
}

export interface BeamInput {
  muPerCm: number;
  thicknessMm: number;
  /** 入射相对强度，默认 1 */
  i0?: number;
  scatterTable?: { tMax: number; n: number }[];
}

export interface BeamOutput {
  direct: number;
  scatter: number;
  total: number;
  n: number;
  transmission: number;
}

export function transmitBeam(inp: BeamInput): BeamOutput {
  const i0 = inp.i0 ?? 1;
  const direct = i0 * Math.exp((-inp.muPerCm * inp.thicknessMm) / 10);
  const n = scatterRatio(inp.thicknessMm, inp.scatterTable);
  const scatter = n * direct;
  return { direct, scatter, total: direct + scatter, n, transmission: direct / i0 };
}

/**
 * 胶片特性曲线（H&D 曲线）线性段。
 * D = D0 + G·lg(E/E0)，E 为到达胶片的曝光量（与总强度×时间成正比）。
 * 给出参考点 (E_ref, D_ref) 与平均梯度 G 即可标定。
 */
export interface FilmCurve {
  g: number; // 平均梯度
  dMin: number; // 灰雾度+片基
  dMax: number; // 最大黑度
  eRef: number; // 参考曝光量（相对）
  dRef: number; // 参考点黑度
}

export const DEFAULT_FILM: FilmCurve = { g: 2.4, dMin: 0.25, dMax: 4.5, eRef: 1, dRef: 2.5 };

export function filmDensity(exposure: number, c: FilmCurve = DEFAULT_FILM): number {
  if (exposure <= 0) return c.dMin;
  const d = c.dRef + c.g * Math.log10(exposure / c.eRef);
  return clamp(d, c.dMin, c.dMax);
}

/**
 * DR 探测器：相对剂量 → 等效光学密度。
 * 以零厚度入射剂量 I0 为参考（不再用单图最大值，保证跨参数/跨方案口径一致）：
 *   D_dr = D0 − lg10(I/I0)，D0 为工作点基准黑度（默认 2.0，落在标准 1.8~4 区间内）。
 * 厚度增大 → I/I0 减小 → D 增大，与胶片黑度方向一致、量纲一致，可直接对标准限值。
 */
export function drEquivalentDensity(totalIntensity: number, i0 = 1, baseDensity = 2.0): number {
  const r = clamp(totalIntensity / i0, 1e-5, 1);
  return clamp(baseDensity - Math.log10(r), 0, 6);
}

/**
 * 主因对比度（厚度差 Δt 产生的黑度/信号对比度）。
 * 信号对比度 C = μ·Δt/[10·(1+n)]（散射使对比度下降 1/(1+n)）。
 * 管电压升高 → μ 下降 → 对比度下降，趋势由衰减库自然给出。
 */
export function subjectContrast(muPerCm: number, deltaTMm: number, n: number): number {
  return (muPerCm * deltaTMm) / (10 * (1 + n));
}

/** 黑度差（胶片）：ΔD = G·lg(I1/I2)，I 含散射 */
export function densityDifferenceFilm(
  muPerCm: number,
  t1Mm: number,
  t2Mm: number,
  n: number,
  g: number,
): number {
  // (1+n) 在同档相消
  return (g * muPerCm * Math.abs(t2Mm - t1Mm)) / (10 * Math.LN10);
}

/**
 * 信噪比估计：探测器信号电子数近似与总剂量成正比，
 * SNR = S/√(S+σ_read²)，叠帧 m 帧后噪声降为 1/√m。
 */
export function estimateSnr(signalElectrons: number, readNoiseE: number, frames = 1): number {
  const shot = signalElectrons;
  const noise = Math.sqrt(shot + readNoiseE * readNoiseE);
  return (signalElectrons / noise) * Math.sqrt(frames);
}

/** 汇总一次仿真的计算依据（留底备查，客户审片可逐项核对） */
export function buildEvidence(p: {
  kv: number;
  muPerCm: number;
  hvlMm: number;
  tvlMm: number;
  thicknessMm: number;
  focalSpot: number;
  f: number;
  l1: number;
  l2: number;
  ug: number;
  ugLimit: number;
  magnification: number;
  beam: BeamOutput;
  standard: string;
  curveName: string;
}): SimulationEvidence {
  return {
    formula: 'Id=I0·exp(−μt/10); I=(1+n)Id; Ug=d·L2/L1; D=Dref+G·lg(E/Eref)',
    kv: p.kv,
    muPerCm: p.muPerCm,
    halfValueLayerMm: p.hvlMm,
    tenthValueLayerMm: p.tvlMm,
    scatterRatio: p.beam.n,
    thicknessMm: p.thicknessMm,
    focalSpot: p.focalSpot,
    focalDistance: p.f,
    l1: p.l1,
    l2: p.l2,
    ug: p.ug,
    ugLimit: p.ugLimit,
    magnification: p.magnification,
    directIntensity: p.beam.direct,
    totalIntensity: p.beam.total,
    characteristicCurve: p.curveName,
    standard: p.standard,
  };
}
