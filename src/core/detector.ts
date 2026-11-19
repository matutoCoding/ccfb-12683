/**
 * 探测器校正流水线（DR 原始灰度 → 校正图）：
 * 1) 暗场本底扣除：Gc = Graw − Gdark
 * 2) 增益校正：Gn = Gc · Ggain_ref / Ggain（归一化到平均增益）
 * 3) 坏像素邻域插值（3×3 有效邻域均值，坏点图单独标记，不与缺陷混淆）
 * 4) m 帧叠加平均：σ 降为 1/√m
 * 所有函数纯数值、无 DOM，WebWorker 与主线程都能跑。
 */

export interface CalibrationSet {
  width: number;
  height: number;
  dark: Float32Array;
  gain: Float32Array;
  bad: Uint8Array; // 1=坏像素
}

export function idx(x: number, y: number, w: number): number {
  return y * w + x;
}

/** 暗场+增益校正 */
export function applyDarkGain(raw: Float32Array, cal: CalibrationSet): Float32Array {
  const out = new Float32Array(raw.length);
  const gainMean = average(cal.gain);
  for (let i = 0; i < raw.length; i++) {
    const g = cal.gain[i] !== 0 ? cal.gain[i] : gainMean;
    out[i] = (raw[i] - cal.dark[i]) * (gainMean / g);
  }
  return out;
}

/** 坏像素 3×3 邻域插值修补，返回修补后的图与修补点清单 */
export function repairBadPixels(img: Float32Array, cal: CalibrationSet): {
  image: Float32Array;
  repaired: [number, number][];
} {
  const { width: w, height: h } = cal;
  const out = new Float32Array(img);
  const repaired: [number, number][] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(x, y, w);
      if (!cal.bad[i]) continue;
      let sum = 0;
      let cnt = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = idx(nx, ny, w);
          if (cal.bad[ni]) continue;
          sum += img[ni];
          cnt++;
        }
      }
      out[i] = cnt > 0 ? sum / cnt : average(img);
      repaired.push([x, y]);
    }
  }
  return { image: out, repaired };
}

/** 多帧叠加平均（压噪声） */
export function averageFrames(frames: Float32Array[]): Float32Array {
  if (frames.length === 0) throw new Error('无帧可叠加');
  const out = new Float32Array(frames[0].length);
  for (const f of frames) for (let i = 0; i < f.length; i++) out[i] += f[i];
  for (let i = 0; i < out.length; i++) out[i] /= frames.length;
  return out;
}

/** 生成一帧带噪声的仿真原始图（泊松-高斯近似），seed 保证可复现 */
export function addNoise(clean: Float32Array, signalGain: number, readNoise: number, seed = 1): Float32Array {
  const rng = mulberry32(seed);
  const out = new Float32Array(clean.length);
  for (let i = 0; i < clean.length; i++) {
    const electrons = Math.max(0, clean[i] * signalGain);
    // 泊松近似：方差=均值，正态抽样
    const shot = gaussian(rng) * Math.sqrt(electrons);
    const read = gaussian(rng) * readNoise;
    out[i] = (electrons + shot + read) / signalGain;
  }
  return out;
}

function average(a: Float32Array): number {
  let s = 0;
  for (const v of a) s += v;
  return s / a.length;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
