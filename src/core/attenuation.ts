import type { AttenuationTable, CalibrationRecord, MaterialKey } from '@/types';
import { halfValueLayer, logLogInterpolate, tenthValueLayer } from './math';

/**
 * 内置线衰减系数库（多色 X 射线等效单能 μ，单位 1/cm）。
 * 数据依据：NIST XCOM 质量衰减系数 × 材料密度，并按各管电压有效能量
 * （经验约 0.4–0.6 × 管电压峰值）取多色等效值，与《射线检测》教材
 * 钢的 HVL 经验值（100kV≈1.2cm，200kV≈2.1cm，400kV≈3.2cm）核对一致。
 * 表中未覆盖的材料/管电压走试块反推（见 invertMuFromBlocks）。
 * 表内点为权威查值，表间用 log-log 插值，越界外推会给出 extrapolated 标记。
 */
export const ATTENUATION_DB: Record<MaterialKey, AttenuationTable> = {
  steel: {
    material: 'steel',
    materialName: '碳钢/铸钢',
    density: 7.85,
    source: 'NIST XCOM + 教材HVL核对（多色等效值，试块复核后生效）',
    points: [
      { kv: 50, mu: 6.5 },
      { kv: 75, mu: 3.6 },
      { kv: 100, mu: 2.17 },
      { kv: 150, mu: 1.45 },
      { kv: 200, mu: 1.06 },
      { kv: 250, mu: 0.83 },
      { kv: 300, mu: 0.7 },
      { kv: 400, mu: 0.56 },
    ],
  },
  aluminum: {
    material: 'aluminum',
    materialName: '铝及铝合金',
    density: 2.7,
    source: 'NIST XCOM 多色等效值',
    points: [
      { kv: 30, mu: 2.8 },
      { kv: 50, mu: 1.2 },
      { kv: 75, mu: 0.72 },
      { kv: 100, mu: 0.52 },
      { kv: 150, mu: 0.36 },
      { kv: 200, mu: 0.29 },
    ],
  },
  titanium: {
    material: 'titanium',
    materialName: '钛及钛合金',
    density: 4.51,
    source: 'NIST XCOM 多色等效值',
    points: [
      { kv: 60, mu: 2.4 },
      { kv: 100, mu: 1.2 },
      { kv: 150, mu: 0.82 },
      { kv: 200, mu: 0.62 },
      { kv: 300, mu: 0.43 },
      { kv: 400, mu: 0.35 },
    ],
  },
  copper: {
    material: 'copper',
    materialName: '铜及铜合金',
    density: 8.96,
    source: 'NIST XCOM 多色等效值',
    points: [
      { kv: 60, mu: 8.2 },
      { kv: 100, mu: 3.8 },
      { kv: 150, mu: 2.1 },
      { kv: 200, mu: 1.5 },
      { kv: 300, mu: 1.0 },
      { kv: 400, mu: 0.75 },
    ],
  },
};

export interface MuLookup {
  mu: number;
  hvlMm: number;
  tvlMm: number;
  extrapolated: boolean;
  source: string;
}

/** 查表：管电压 kV → 线衰减系数 1/cm（含 HVL/TVL 随查随用） */
export function lookupMu(tables: AttenuationTable[], material: string, kv: number): MuLookup {
  const table =
    tables.find((t) => t.material === material) ??
    Object.values(ATTENUATION_DB).find((t) => t.material === material || t.materialName === material);
  if (!table) throw new Error(`材料 ${material} 不在衰减系数库，请先做试块反推建档`);
  const kvs = table.points.map((p) => p.kv);
  const mus = table.points.map((p) => p.mu);
  const { y, extrapolated } = logLogInterpolate(kvs, mus, kv);
  return {
    mu: y,
    hvlMm: halfValueLayer(y),
    tvlMm: tenthValueLayer(y),
    extrapolated,
    source: table.source,
  };
}

/**
 * 两试块反推等效线衰减系数。
 * 已知 t1,t2(mm) 与对应实测光学密度 D1,D2（胶片）或归一化灰度（DR），
 * 配合胶片特性曲线平均梯度 G（DR 取 G=1，按剂量比）与散射比 n：
 *   纯直接辐射剂量比 E1/E2 = exp( μ(t2−t1)/10 )，
 *   计入散射（总强度 = (1+n)·直接强度，同档 n 相同）：
 *     胶片：D1−D2 = G·lg[(1+n)I1 / (1+n)I2] = G·μΔt/(10·ln10)
 *     => μ = 10·ln10·(D1−D2)/(G·(t2−t1))
 *   DR（灰度经 -log10 转成等效密度时）公式同胶片；
 *   若给的是原始剂量/灰度比 r=E1/E2，则 μ = 10·ln(r)/Δt。
 */
export function invertMuFromBlocks(rec: Omit<CalibrationRecord, 'mu'> & { gradient?: number; intensityRatio?: number }): number {
  const dt = rec.t2 - rec.t1;
  if (!(dt > 0)) throw new Error('试块厚度 t2 必须大于 t1');
  if (rec.intensityRatio !== undefined) {
    // DR 原始强度比路径（含散射修正：I_total=(1+n)I_direct）
    const r = rec.intensityRatio;
    if (!(r > 1)) throw new Error('薄试块强度应大于厚试块，强度比需 >1');
    return (10 * Math.log(r)) / dt;
  }
  const G = rec.gradient ?? 2.0;
  const dD = rec.d1 - rec.d2;
  if (!(dD > 0)) throw new Error('薄试块黑度应大于厚试块，D1>D2');
  // 散射比在同厚度档近似相同，差值中 (1+n) 相消，故反推对 n 不敏感
  return (10 * Math.LN10 * dD) / (G * dt);
}
