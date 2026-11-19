import type { ExposureLayout } from '@/types';
import { clamp } from './math';

/**
 * 几何不清晰度（半影宽度）标准公式：
 *   Ug = d · L2 / L1 = d · (F−L1)/L1
 * d 焦点尺寸 mm，L1 源到工件源侧表面距离，L2 工件源侧表面到探测器距离，F=L1+L2 焦距。
 * 等效于 Ug = d·(M−1)，M=F/L1 为几何放大倍数。
 */
export interface GeometryResult {
  f: number;
  l1: number;
  l2: number;
  magnification: number;
  ug: number;
  /** 几何模糊折算到探测器像素 */
  geometricBlurPx: number;
  /** 运动模糊折算到探测器像素 */
  motionBlurPx: number;
}

export function computeGeometry(
  focalSpot: number,
  layout: ExposureLayout,
  pixelSizeMm: number,
  motionMm = 0,
): GeometryResult {
  const f = layout.focalDistance;
  const l1 = layout.sourceToObject;
  const l2 = f - l1;
  if (!(f > 0 && l1 > 0 && l2 >= 0)) throw new Error('焦距/距离不合法：需 F>L1>0，L2=F−L1≥0');
  const magnification = f / l1;
  const ug = focalSpot * (l2 / l1);
  const geometricBlurPx = ug / pixelSizeMm;
  // 运动模糊：工件相对探测器位移经放大后投影，运动模糊与几何模糊分开给出数值
  const projectedMotion = motionMm * magnification;
  const motionBlurPx = projectedMotion / pixelSizeMm;
  return { f, l1, l2, magnification, ug, geometricBlurPx, motionBlurPx };
}

/**
 * 双壁双影（椭圆透照）开口间距校验。
 * 源偏移使上下两条焊缝影像在探测器上分开，椭圆开口间距 g：
 *   g = 2·s·M − d_eff
 * s 为源相对焊缝中心面的横向偏移 mm，d_eff 为焊缝影像自身宽度（含半影）。
 * 标准一般要求开口间距约为焊缝宽度的 0.5~1 倍且不小于规定值（默认 10mm）。
 */
export function ellipticalGap(
  sourceOffsetMm: number,
  magnification: number,
  weldWidthMm: number,
  ug: number,
): { gapMm: number; ok: number; requiredMin: number } {
  const dEff = weldWidthMm + ug;
  const gapMm = 2 * sourceOffsetMm * magnification - dEff;
  const requiredMin = clamp(0.5 * weldWidthMm, 10, 30);
  return { gapMm, ok: gapMm >= requiredMin ? 1 : 0, requiredMin };
}

/** 由三维两点距离算焦距 */
export function distance3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** 偏透角：主束与工件表面法线夹角（度） */
export function beamAngle(
  source: { x: number; y: number; z: number },
  surfacePoint: { x: number; y: number; z: number },
  normal: { x: number; y: number; z: number },
): number {
  const bx = source.x - surfacePoint.x;
  const by = source.y - surfacePoint.y;
  const bz = source.z - surfacePoint.z;
  const bl = Math.hypot(bx, by, bz) || 1;
  const nl = Math.hypot(normal.x, normal.y, normal.z) || 1;
  const cos = Math.abs((bx * normal.x + by * normal.y + bz * normal.z) / (bl * nl));
  return (Math.acos(clamp(cos, -1, 1)) * 180) / Math.PI;
}
