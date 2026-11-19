import type { ThicknessSample, Workpiece } from '@/types';

/**
 * 壁厚抽样与突变识别。
 * 完整 STEP B-rep 抽壳需几何内核（opencascade.js，数十 MB WASM），
 * 本模块采用两条可落地路径：
 *  - 筒体/平板参数件：按几何公式直接量壁厚（出厂主用，铸钢承压件多为筒节/管/板）；
 *  - 网格件(STL/STEP 三角化后的 mesh)：沿采样方向射线与三角网求交取穿越长度。
 * 突变判定：相邻抽样壁厚差 > 阈值（默认壁厚的 15% 或 3mm 取大）。
 */

export interface TriMesh {
  positions: Float32Array; // xyz 交错
  indices: Uint32Array;
}

export function detectAbrupt(samples: ThicknessSample[], relThreshold = 0.15, absThresholdMm = 3): ThicknessSample[] {
  const out = samples.map((s) => ({ ...s, abrupt: false }));
  for (let i = 0; i < out.length; i++) {
    const neighbors = [out[i - 1], out[i + 1]].filter(Boolean) as ThicknessSample[];
    for (const nb of neighbors) {
      const diff = Math.abs(out[i].thickness - nb.thickness);
      const base = Math.max(absThresholdMm, relThreshold * nb.thickness);
      if (diff > base) {
        out[i].abrupt = true;
        out[i].note = `壁厚突变：与相邻点差 ${diff.toFixed(1)}mm`;
      }
    }
  }
  return out;
}

/** 筒体沿轴向×周向抽样（公称壁厚，变截面可在导入表中覆盖） */
export function sampleCylinder(
  outerDiameter: number,
  nominalWall: number,
  length: number,
  axialSteps = 8,
  angularSteps = 8,
): ThicknessSample[] {
  const samples: ThicknessSample[] = [];
  let k = 0;
  for (let a = 0; a < axialSteps; a++) {
    const z = (length * (a + 0.5)) / axialSteps;
    for (let b = 0; b < angularSteps; b++) {
      const ang = (360 * b) / angularSteps;
      samples.push({
        id: `ts-${k++}`,
        position: z,
        angle: ang,
        thickness: nominalWall,
        abrupt: false,
      });
    }
  }
  return detectAbrupt(samples);
}

/** 平板厚度抽样（厚度方向为 height） */
export function samplePlate(thickness: number, width: number, length: number, steps = 10): ThicknessSample[] {
  const samples: ThicknessSample[] = [];
  for (let i = 0; i < steps; i++) {
    samples.push({
      id: `ts-${i}`,
      position: (length * (i + 0.5)) / steps,
      angle: 0,
      thickness,
      abrupt: false,
      note: width ? `板宽 ${width}mm` : undefined,
    });
  }
  return detectAbrupt(samples);
}

/** 汇总最薄/最厚，并把最厚处作为后续曝光计算默认透照厚度 */
export function summarizeThickness(wp: Pick<Workpiece, 'thicknessSamples'>): {
  tMin: number;
  tMax: number;
  tMaxAt: ThicknessSample | undefined;
  abruptCount: number;
} {
  if (wp.thicknessSamples.length === 0) return { tMin: 0, tMax: 0, tMaxAt: undefined, abruptCount: 0 };
  let tMin = Infinity;
  let tMax = -Infinity;
  let tMaxAt: ThicknessSample | undefined;
  let abruptCount = 0;
  for (const s of wp.thicknessSamples) {
    if (s.thickness < tMin) tMin = s.thickness;
    if (s.thickness > tMax) {
      tMax = s.thickness;
      tMaxAt = s;
    }
    if (s.abrupt) abruptCount++;
  }
  return { tMin, tMax, tMaxAt, abruptCount };
}

/**
 * 网格射线穿越长度（Möller–Trumbore 三角求交，取射线进出壁面的配对距离）。
 * 用于 STL/三角化 STEP 模型的壁厚实测，方向取 ±X 的多条平行射线。
 */
export function rayMeshThickness(mesh: TriMesh, origin: [number, number, number], dir: [number, number, number]): number {
  const [dx, dy, dz] = normalize(dir);
  const hits: number[] = [];
  const ind = mesh.indices;
  const p = mesh.positions;
  for (let i = 0; i < ind.length; i += 3) {
    const t = rayTriangle(origin, [dx, dy, dz], p, ind[i], ind[i + 1], ind[i + 2]);
    if (t !== null) hits.push(t);
  }
  hits.sort((a, b) => a - b);
  // 配对相邻交点：进-出 为一段壁厚，全部相加（多层壁场景）
  let total = 0;
  for (let i = 0; i + 1 < hits.length; i += 2) total += hits[i + 1] - hits[i];
  return total;
}

function rayTriangle(
  o: number[],
  d: number[],
  p: Float32Array,
  ia: number,
  ib: number,
  ic: number,
): number | null {
  const ax = p[ia * 3];
  const ay = p[ia * 3 + 1];
  const az = p[ia * 3 + 2];
  const bx = p[ib * 3];
  const by = p[ib * 3 + 1];
  const bz = p[ib * 3 + 2];
  const cx = p[ic * 3];
  const cy = p[ic * 3 + 1];
  const cz = p[ic * 3 + 2];
  const e1x = bx - ax;
  const e1y = by - ay;
  const e1z = bz - az;
  const e2x = cx - ax;
  const e2y = cy - ay;
  const e2z = cz - az;
  const hx = d[1] * e2z - d[2] * e2y;
  const hy = d[2] * e2x - d[0] * e2z;
  const hz = d[0] * e2y - d[1] * e2x;
  const det = e1x * hx + e1y * hy + e1z * hz;
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  const sx = o[0] - ax;
  const sy = o[1] - ay;
  const sz = o[2] - az;
  const u = inv * (sx * hx + sy * hy + sz * hz);
  if (u < 0 || u > 1) return null;
  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;
  const v = inv * (d[0] * qx + d[1] * qy + d[2] * qz);
  if (v < 0 || u + v > 1) return null;
  const t = inv * (e2x * qx + e2y * qy + e2z * qz);
  return t > 1e-9 ? t : null;
}

function normalize(v: number[]): number[] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
