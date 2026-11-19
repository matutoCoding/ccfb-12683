// 通用数学工具：角度、插值、半值层

export const RAD = Math.PI / 180;
export const DEG = 180 / Math.PI;

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** 对数-对数线性插值（衰减系数随能量呈幂律变化，log-log 插值比线性更符合物理） */
export function logLogInterpolate(xs: number[], ys: number[], x: number): { y: number; extrapolated: boolean } {
  if (x <= xs[0]) return { y: ys[0], extrapolated: x < xs[0] };
  if (x >= xs[xs.length - 1]) return { y: ys[ys.length - 1], extrapolated: x > xs[xs.length - 1] };
  // 精确命中表点：直接返回表值，保证“查表一模一样”
  for (let i = 0; i < xs.length; i++) if (xs[i] === x) return { y: ys[i], extrapolated: false };
  let i = 0;
  while (xs[i + 1] < x) i++;
  const lx0 = Math.log(xs[i]);
  const lx1 = Math.log(xs[i + 1]);
  const ly0 = Math.log(ys[i]);
  const ly1 = Math.log(ys[i + 1]);
  const ly = ly0 + ((Math.log(x) - lx0) / (lx1 - lx0)) * (ly1 - ly0);
  return { y: Math.exp(ly), extrapolated: false };
}

export function linearInterpolate(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let i = 0;
  while (xs[i + 1] < x) i++;
  return ys[i] + ((x - xs[i]) / (xs[i + 1] - xs[i])) * (ys[i + 1] - ys[i]);
}

/** 半值层 HVL mm：μ 单位 1/cm */
export function halfValueLayer(muPerCm: number): number {
  return (10 * Math.LN2) / muPerCm;
}

/** 十分之一值层 TVL mm */
export function tenthValueLayer(muPerCm: number): number {
  return (10 * Math.LN10) / muPerCm;
}

export function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stddev(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

/** 向上取整为不小于 n 的最小整数（透照次数用，小数也要进 1） */
export function ceilCount(x: number): number {
  return Math.max(1, Math.ceil(x - 1e-9));
}
