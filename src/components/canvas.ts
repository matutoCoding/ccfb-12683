/** Canvas 绘制工具：灰度图、黑度剖面曲线、筒体展开布片、坏点/缺陷标记 */

export function renderGrayImage(
  canvas: HTMLCanvasElement,
  image: Float32Array,
  w: number,
  h: number,
  opts: { badPixels?: [number, number][]; defects?: { x: number; y: number; r: number }[]; outOfRange?: boolean[] } = {},
) {
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < image.length; i++) {
    const v = Math.round(clamp255(image[i] * 255));
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // 超黑度范围区段染色（红=超上限，蓝=低于下限，这里按标记叠黄）
  if (opts.outOfRange) {
    for (let i = 0; i < opts.outOfRange.length; i++) {
      if (!opts.outOfRange[i]) continue;
      const x = i % w;
      const y = Math.floor(i / w);
      ctx.fillStyle = 'rgba(240,168,72,0.45)';
      ctx.fillRect(x, y, 1, 1);
    }
  }
  // 坏像素：品红描边，区别于缺陷
  if (opts.badPixels) {
    ctx.strokeStyle = '#ff3dd0';
    ctx.lineWidth = 1;
    for (const [x, y] of opts.badPixels) {
      ctx.strokeRect(Math.max(0, x - 2), Math.max(0, y - 2), 4, 4);
    }
  }
  // 缺陷：青色圈
  if (opts.defects) {
    ctx.strokeStyle = '#37e6ff';
    ctx.lineWidth = 1.5;
    for (const d of opts.defects) {
      ctx.beginPath();
      ctx.arc(d.x * w, d.y * h, d.r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function clamp255(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** 黑度剖面曲线 */
export function renderProfile(
  canvas: HTMLCanvasElement,
  profile: number[],
  limits: { min: number; max: number },
  marker?: number,
) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 600;
  const H = 220;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#06090e';
  ctx.fillRect(0, 0, W, H);
  const pad = { l: 46, r: 14, t: 14, b: 28 };
  const dMax = Math.max(...profile, limits.max) * 1.1;
  const px = (i: number) => pad.l + (i / (profile.length - 1)) * (W - pad.l - pad.r);
  const py = (d: number) => H - pad.b - (d / dMax) * (H - pad.t - pad.b);

  // 限值带
  ctx.fillStyle = 'rgba(76,195,138,0.12)';
  ctx.fillRect(pad.l, py(limits.max), W - pad.l - pad.r, py(limits.min) - py(limits.max));
  ctx.strokeStyle = 'rgba(76,195,138,0.7)';
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(pad.l, py(limits.max));
  ctx.lineTo(W - pad.r, py(limits.max));
  ctx.moveTo(pad.l, py(limits.min));
  ctx.lineTo(W - pad.r, py(limits.min));
  ctx.stroke();
  ctx.setLineDash([]);

  // 轴
  ctx.strokeStyle = '#2e3d52';
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t);
  ctx.lineTo(pad.l, H - pad.b);
  ctx.lineTo(W - pad.r, H - pad.b);
  ctx.stroke();
  ctx.fillStyle = '#8494a8';
  ctx.font = '11px Consolas';
  for (let d = 0; d <= dMax; d += Math.max(0.5, dMax / 6)) {
    ctx.fillText(d.toFixed(1), 8, py(d) + 4);
  }
  ctx.fillText('像素位置 →', W - 80, H - 8);
  ctx.save();
  ctx.translate(14, H / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('光学密度 D', -30, 0);
  ctx.restore();

  // 曲线
  ctx.strokeStyle = '#4da3ff';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  profile.forEach((d, i) => (i === 0 ? ctx.moveTo(px(i), py(d)) : ctx.lineTo(px(i), py(d))));
  ctx.stroke();

  if (marker !== undefined) {
    ctx.strokeStyle = '#f0a848';
    ctx.beginPath();
    ctx.moveTo(px(marker), pad.t);
    ctx.lineTo(px(marker), H - pad.b);
    ctx.stroke();
  }
}

/** 筒体展开布片图 */
export function renderUnrolledLayout(
  canvas: HTMLCanvasElement,
  marks: { start: number; end: number; center: number }[],
  circumferenceMm: number,
  lengthMm: number,
) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 720;
  const H = 260;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#0c1118';
  ctx.fillRect(0, 0, W, H);
  const pad = { l: 50, r: 16, t: 20, b: 30 };
  const ax = (deg: number) => pad.l + (((deg + 360) % 360) / 360) * (W - pad.l - pad.r);
  const seamY = H / 2;

  ctx.strokeStyle = '#2e3d52';
  ctx.strokeRect(pad.l, seamY - 40, W - pad.l - pad.r, 80);
  ctx.fillStyle = '#8494a8';
  ctx.font = '11px Microsoft YaHei';
  ctx.fillText(`筒体展开（周长 ${circumferenceMm.toFixed(0)}mm × 长 ${lengthMm}mm）`, pad.l, 12);

  marks.forEach((m, i) => {
    const x0 = ax(m.start);
    const x1 = ax(m.end);
    const xc = ax(m.center);
    ctx.fillStyle = i % 2 ? 'rgba(77,163,255,0.22)' : 'rgba(54,198,160,0.22)';
    if (x1 >= x0) ctx.fillRect(x0, seamY - 40, x1 - x0, 80);
    else {
      ctx.fillRect(x0, seamY - 40, W - pad.r - x0, 80);
      ctx.fillRect(pad.l, seamY - 40, x1 - pad.l, 80);
    }
    ctx.strokeStyle = '#f0a848';
    ctx.lineWidth = 1.4;
    [x0, x1].forEach((x) => {
      ctx.beginPath();
      ctx.moveTo(x, seamY - 46);
      ctx.lineTo(x, seamY + 46);
      ctx.stroke();
    });
    ctx.fillStyle = '#dce4ee';
    ctx.font = '11px Consolas';
    ctx.fillText(`#${i + 1}`, xc - 8, seamY + 4);
  });
  // 搭接标记图例
  ctx.fillStyle = '#f0a848';
  ctx.fillText('橙线=搭接标记位置', pad.l, H - 8);
}

/** 通用折线图（寻优曲线/对比曲线） */
export function renderLineChart(
  canvas: HTMLCanvasElement,
  series: { name: string; color: string; points: { x: number; y: number }[] }[],
  axis: { xLabel: string; yLabel: string; highlight?: [number, number] },
) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 640;
  const H = 260;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#06090e';
  ctx.fillRect(0, 0, W, H);
  const pad = { l: 52, r: 16, t: 16, b: 34 };
  const allX = series.flatMap((s) => s.points.map((p) => p.x));
  const allY = series.flatMap((s) => s.points.map((p) => p.y));
  const xMin = Math.min(...allX);
  const xMax = Math.max(...allX);
  const yMin = Math.min(...allY, 0);
  const yMax = Math.max(...allY) * 1.1;
  const px = (x: number) => pad.l + ((x - xMin) / (xMax - xMin || 1)) * (W - pad.l - pad.r);
  const py = (y: number) => H - pad.b - ((y - yMin) / (yMax - yMin || 1)) * (H - pad.t - pad.b);

  ctx.strokeStyle = '#2e3d52';
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t);
  ctx.lineTo(pad.l, H - pad.b);
  ctx.lineTo(W - pad.r, H - pad.b);
  ctx.stroke();
  ctx.fillStyle = '#8494a8';
  ctx.font = '11px Consolas';
  ctx.fillText(axis.yLabel, 8, pad.t + 4);
  ctx.fillText(axis.xLabel, W - 90, H - 10);

  if (axis.highlight) {
    const [hx0, hx1] = axis.highlight;
    ctx.fillStyle = 'rgba(76,195,138,0.14)';
    ctx.fillRect(px(hx0), pad.t, px(hx1) - px(hx0), H - pad.t - pad.b);
  }

  series.forEach((s) => {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    s.points.forEach((p, i) => (i === 0 ? ctx.moveTo(px(p.x), py(p.y)) : ctx.lineTo(px(p.x), py(p.y))));
    ctx.stroke();
    s.points.forEach((p) => {
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(px(p.x), py(p.y), 2.5, 0, Math.PI * 2);
      ctx.fill();
    });
  });
  // 图例
  series.forEach((s, i) => {
    ctx.fillStyle = s.color;
    ctx.fillRect(pad.l + i * 130, pad.t - 4, 10, 10);
    ctx.fillStyle = '#dce4ee';
    ctx.fillText(s.name, pad.l + i * 130 + 14, pad.t + 5);
  });
}
