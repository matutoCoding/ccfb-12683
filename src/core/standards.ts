import type { StandardLimits } from '@/types';

/**
 * 标准限值表（可在“工艺参数/标准”界面编辑、另存为厂内标准）。
 * 几何不清晰度限值 Ug 取自 NB/T 47013.2-2015 / GB/T 3323 AB 级常用表，
 * A 级可放宽约 1.33 倍、B 级收紧约 0.75 倍（在编辑器里调）。
 */
export const DEFAULT_STANDARDS: StandardLimits[] = [
  {
    id: 'std-nb47013-ab',
    name: 'NB/T 47013.2-2015 AB级（默认）',
    standardCode: 'NB/T 47013.2-2015 AB',
    kValue: 1.03,
    ugLimits: [
      { tMax: 25, ug: 0.2 },
      { tMax: 50, ug: 0.4 },
      { tMax: 75, ug: 0.6 },
      { tMax: 100, ug: 0.8 },
      { tMax: 200, ug: 1.0 },
      { tMax: Infinity, ug: 1.2 },
    ],
    densityRange: { min: 1.8, max: 4.0 },
    weldDensityRange: { min: 2.0, max: 4.0 },
  },
  {
    id: 'std-nb47013-a',
    name: 'NB/T 47013.2-2015 A级',
    standardCode: 'NB/T 47013.2-2015 A',
    kValue: 1.03,
    ugLimits: [
      { tMax: 25, ug: 0.27 },
      { tMax: 50, ug: 0.53 },
      { tMax: 75, ug: 0.8 },
      { tMax: 100, ug: 1.07 },
      { tMax: 200, ug: 1.33 },
      { tMax: Infinity, ug: 1.6 },
    ],
    densityRange: { min: 1.8, max: 4.0 },
    weldDensityRange: { min: 2.0, max: 4.0 },
  },
  {
    id: 'std-nb47013-b',
    name: 'NB/T 47013.2-2015 B级',
    standardCode: 'NB/T 47013.2-2015 B',
    kValue: 1.01,
    ugLimits: [
      { tMax: 25, ug: 0.15 },
      { tMax: 50, ug: 0.3 },
      { tMax: 75, ug: 0.45 },
      { tMax: 100, ug: 0.6 },
      { tMax: 200, ug: 0.75 },
      { tMax: Infinity, ug: 0.9 },
    ],
    densityRange: { min: 2.0, max: 4.0 },
    weldDensityRange: { min: 2.3, max: 4.0 },
  },
];

/** 按透照厚度 T(mm) 查几何不清晰度限值 */
export function ugLimit(std: StandardLimits, thicknessMm: number): number {
  for (const row of std.ugLimits) {
    if (thicknessMm <= row.tMax) return row.ug;
  }
  return std.ugLimits[std.ugLimits.length - 1].ug;
}
