import type { AttenuationTable, Detector, StandardLimits, Workpiece, XRayMachine } from '@/types';
import { ATTENUATION_DB } from '@/core/attenuation';
import { DEFAULT_STANDARDS } from '@/core/standards';
import { sampleCylinder, samplePlate, summarizeThickness } from '@/core/thickness';

/** 首次启动的种子台账（铸钢承压件典型场景） */
export function seedWorkpieces(): Workpiece[] {
  const cylSamples = sampleCylinder(508, 26, 1200, 6, 8);
  const cyl: Workpiece = {
    id: 'wp-seed-cyl',
    heatNo: 'ZG2026-0117',
    name: '铸钢筒体 DN500×26',
    material: 'steel',
    shape: 'cylinder',
    outerDiameter: 508,
    length: 1200,
    modelFile: '筒体DN500.stp',
    thicknessSamples: cylSamples,
    ...pick(summarizeThickness({ thicknessSamples: cylSamples })),
    createdAt: Date.now(),
    remark: '环缝+纵缝承压筒节，最厚 26mm 取为透照厚度',
  };
  const plateSamples = samplePlate(40, 600, 900, 8);
  const plate: Workpiece = {
    id: 'wp-seed-plate',
    heatNo: 'ZG2026-0118',
    name: '铸钢平法兰盖 t40',
    material: 'steel',
    shape: 'plate',
    length: 900,
    width: 600,
    height: 40,
    thicknessSamples: plateSamples,
    ...pick(summarizeThickness({ thicknessSamples: plateSamples })),
    createdAt: Date.now(),
  };
  return [cyl, plate];
}

function pick(s: ReturnType<typeof summarizeThickness>) {
  return { tMin: s.tMin, tMax: s.tMax };
}

export function seedMachines(): XRayMachine[] {
  return [
    {
      id: 'xm-seed-3505',
      model: 'XXG-3505 周向X射线机',
      kvMin: 100,
      kvMax: 350,
      maMin: 2,
      maMax: 5,
      focalSpot: 3.0,
      focalSpotSmall: 1.5,
      power: 1750,
      remark: '双焦点，环缝周向透照',
    },
    {
      id: 'xm-seed-4010',
      model: 'XY-4010 定向X射线机',
      kvMin: 80,
      kvMax: 400,
      maMin: 2,
      maMax: 10,
      focalSpot: 4.0,
      power: 4000,
    },
  ];
}

export function seedDetectors(): Detector[] {
  return [
    {
      id: 'dt-seed-2520',
      model: 'DDA-2520 数字平板',
      pixelSize: 0.2,
      cols: 1280,
      rows: 1024,
      bitDepth: 16,
      badPixels: [
        [120, 340],
        [121, 340],
        [512, 700],
      ],
      inherentUnsharpness: 0.4,
      remark: '坏像素 3 个已在坏点图标注',
    },
  ];
}

export function seedAttenuation(): AttenuationTable[] {
  return Object.values(ATTENUATION_DB).map((t) => ({ ...t, points: t.points.map((p) => ({ ...p })) }));
}

export function seedStandards(): StandardLimits[] {
  return DEFAULT_STANDARDS.map((s) => ({ ...s, ugLimits: s.ugLimits.map((u) => ({ ...u })) }));
}
