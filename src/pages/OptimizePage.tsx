import { useMemo, useRef, useState, useEffect } from 'react';
import { useStore, useActiveStandard } from '@/data/store';
import { lookupMu } from '@/core/attenuation';
import { runSimulation, type SimOptions } from '@/core/simulation';
import { renderGrayImage, renderLineChart } from '@/components/canvas';
import { Metric, Tag } from '@/components/ui';
import type { ProcessParams, SimulationResult } from '@/types';

type SimWithImage = SimulationResult & { image: Float32Array; densityMap: Float32Array };
const W = 200;
const H = 150;

const BASE_OPTS: SimOptions = {
  width: W, height: H, mode: 'dr', weldCenterX: 0.5, weldWidthFrac: 0.18,
  weldReinforcement: 3, frames: 4, seed: 5,
  defects: [{ x: 0.42, y: 0.45, diameterMm: 5, densityLoss: 7 }],
};

export function OptimizePage() {
  const { processes, machines, detectors, workpieces, attenuation } = useStore();
  const standard = useActiveStandard();
  const [procId, setProcId] = useState(processes[0]?.id ?? '');
  const proc = processes.find((p) => p.id === procId);
  const machine = machines.find((m) => m.id === proc?.machineId);
  const detector = detectors.find((d) => d.id === proc?.detectorId);
  const [scanKey, setScanKey] = useState<'kv' | 'exposureTime'>('kv');
  const [range, setRange] = useState<[number, number]>([140, 300]);
  const [steps, setSteps] = useState(6);
  const chartRef = useRef<HTMLCanvasElement>(null);

  const scan = useMemo(() => {
    if (!proc || !machine || !detector) return [];
    const wp = workpieces.find((w) => w.id === proc.workpieceId)!;
    const out: { value: number; result: SimWithImage; inRange: boolean }[] = [];
    for (let i = 0; i < steps; i++) {
      const value = range[0] + ((range[1] - range[0]) * i) / Math.max(1, steps - 1);
      const varied: ProcessParams = {
        ...proc,
        kv: scanKey === 'kv' ? value : proc.kv,
        exposureTime: scanKey === 'exposureTime' ? value : proc.exposureTime,
      };
      const mu = lookupMu(attenuation, proc.material, varied.kv);
      const r = runSimulation(varied, wp, machine, detector, standard, mu, BASE_OPTS) as SimWithImage;
      const inRange = r.densityMin >= standard.densityRange.min && r.densityMax <= standard.densityRange.max;
      out.push({ value, result: r, inRange });
    }
    return out;
  }, [proc, machine, detector, workpieces, attenuation, standard, scanKey, range, steps]);

  // 最优区间：黑度落在标准区间且 SNR 最高的连续参数段
  const optimal = useMemo(() => {
    const valid = scan.filter((s) => s.inRange);
    if (!valid.length) return null;
    const best = valid.reduce((a, b) => (b.result.snr > a.result.snr ? b : a));
    return { lo: valid[0].value, hi: valid[valid.length - 1].value, best: best.value };
  }, [scan]);

  useEffect(() => {
    if (chartRef.current && scan.length) {
      renderLineChart(
        chartRef.current,
        [
          { name: '平均黑度 D', color: '#4da3ff', points: scan.map((s) => ({ x: s.value, y: s.result.densityMean })) },
          { name: '信噪比 SNR', color: '#36c6a0', points: scan.map((s) => ({ x: s.value, y: s.result.snr / 50 })) },
          { name: '对比度 C×100', color: '#f0a848', points: scan.map((s) => ({ x: s.value, y: s.result.contrast * 100 })) },
        ],
        { xLabel: scanKey === 'kv' ? '管电压 kV' : '曝光时间 min', yLabel: '指标', highlight: optimal ? [optimal.lo, optimal.hi] : undefined },
      );
    }
  }, [scan, optimal, scanKey]);

  if (!proc) return <div className="card">请先建立工艺单。</div>;

  return (
    <div>
      <div className="card">
        <div className="row">
          <select value={procId} onChange={(e) => setProcId(e.target.value)}>
            {processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <label className="field" style={{ minWidth: 160 }}>扫描变量
            <select value={scanKey} onChange={(e) => {
              const k = e.target.value as typeof scanKey;
              setScanKey(k);
              setRange(k === 'kv' ? [140, 300] : [0.5, 4]);
            }}>
              <option value="kv">管电压 kV（固定其他）</option><option value="exposureTime">曝光时间 min</option>
            </select>
          </label>
          <label className="field">下限<input type="number" value={range[0]} onChange={(e) => setRange([+e.target.value, range[1]])} /></label>
          <label className="field">上限<input type="number" value={range[1]} onChange={(e) => setRange([range[0], +e.target.value])} /></label>
          <label className="field">步数<input type="number" min={3} max={10} value={steps} onChange={(e) => setSteps(+e.target.value)} /></label>
          {optimal && <Tag tone="ok">最优区间 {optimal.lo.toFixed(0)}~{optimal.hi.toFixed(0)}（最佳 {optimal.best.toFixed(0)}）</Tag>}
        </div>
      </div>

      <div className="card">
        <h3>指标随参数变化曲线（绿色带=黑度达标最优区间）</h3>
        <div className="canvas-wrap"><canvas ref={chartRef} style={{ height: 260 }} /></div>
        <p className="muted" style={{ fontSize: 12 }}>管电压扫描时 μ 随 kV 下降，对比度曲线（橙）应呈下降趋势——这是“管电压调高对比度变差”的物理验证。</p>
      </div>

      <div className="card">
        <h3>仿真片矩阵（{scanKey === 'kv' ? 'kV' : 'min'} 从 {range[0]} 到 {range[1]}）</h3>
        <div className="grid" style={{ gridTemplateColumns: `repeat(${Math.min(steps, 5)}, 1fr)` }}>
          {scan.map((s) => <Thumb key={s.value} value={s.value} result={s.result} inRange={s.inRange} unit={scanKey === 'kv' ? 'kV' : 'min'} />)}
        </div>
      </div>

      <ComparePanel proc={proc} />
    </div>
  );
}

function Thumb({ value, result, inRange, unit }: { value: number; result: SimWithImage; inRange: boolean; unit: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) renderGrayImage(ref.current, result.image, result.width, result.height);
  }, [result]);
  return (
    <div style={{ border: `2px solid ${inRange ? '#36c6a0' : '#f0625d'}`, borderRadius: 6, padding: 6 }}>
      <div className="canvas-wrap"><canvas ref={ref} style={{ aspectRatio: '4/3' }} /></div>
      <div className="row" style={{ marginTop: 4, justifyContent: 'space-between' }}>
        <strong className="mono">{value.toFixed(0)} {unit}</strong>
        {inRange ? <Tag tone="ok">达标</Tag> : <Tag tone="danger">超限</Tag>}
      </div>
      <div className="muted mono" style={{ fontSize: 11 }}>D {result.densityMin.toFixed(2)}~{result.densityMax.toFixed(2)} · SNR {result.snr.toFixed(0)}</div>
    </div>
  );
}

/** 两套工艺并排对比：同步缩放平移、黑度曲线叠图、SNR/曝光时间摆数据 */
function ComparePanel({ proc }: { proc: ProcessParams }) {
  const { processes, machines, detectors, workpieces, attenuation } = useStore();
  const standard = useActiveStandard();
  const [bId, setBId] = useState(processes.find((p) => p.id !== proc.id)?.id ?? '');
  const aRef = useRef<HTMLCanvasElement>(null);
  const bRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState(0);

  const pair = useMemo(() => {
    const mk = (p: ProcessParams): SimWithImage | null => {
      const m = machines.find((x) => x.id === p.machineId);
      const d = detectors.find((x) => x.id === p.detectorId);
      const wp = workpieces.find((x) => x.id === p.workpieceId);
      if (!m || !d || !wp) return null;
      const mu = lookupMu(attenuation, p.material, p.kv);
      return runSimulation(p, wp, m, d, standard, mu, { ...BASE_OPTS, seed: 3 }) as SimWithImage;
    };
    const a = mk(proc);
    const b = bId ? mk(processes.find((p) => p.id === bId)!) : null;
    return a && b ? { a, b } : null;
  }, [proc, bId, processes, machines, detectors, workpieces, attenuation, standard]);

  useEffect(() => {
    if (!pair) return;
    if (aRef.current) renderGrayImage(aRef.current, pair.a.image, W, H);
    if (bRef.current) renderGrayImage(bRef.current, pair.b.image, W, H);
    if (chartRef.current) {
      const pa = Array.from(pair.a.densityMap.slice(H * Math.floor(H / 2), H * Math.floor(H / 2) + W));
      const pb = Array.from(pair.b.densityMap.slice(H * Math.floor(H / 2), H * Math.floor(H / 2) + W));
      renderLineChart(chartRef.current, [
        { name: `方案A ${proc.kv}kV`, color: '#4da3ff', points: pa.map((d, i) => ({ x: i, y: d })) },
        { name: '方案B', color: '#f0a848', points: pb.map((d, i) => ({ x: i, y: d })) },
      ], { xLabel: '像素', yLabel: '黑度 D' });
    }
  }, [pair, proc]);

  return (
    <div className="card">
      <h3>两套工艺对比（数据说话）</h3>
      <div className="row" style={{ marginBottom: 10 }}>
        <span className="pill">方案 A：{proc.name}</span>
        <select value={bId} onChange={(e) => setBId(e.target.value)}>
          <option value="">选择方案 B…</option>
          {processes.filter((p) => p.id !== proc.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <label className="row">同步缩放 <input type="range" min={1} max={3} step={0.1} value={zoom} onChange={(e) => setZoom(+e.target.value)} /></label>
        <label className="row">平移 <input type="range" min={-40} max={40} value={pan} onChange={(e) => setPan(+e.target.value)} /></label>
      </div>
      {pair ? (
        <>
          <div className="grid grid-2">
            <div>
              <Tag tone="info">方案 A</Tag>
              <div className="canvas-wrap" style={{ overflow: 'hidden' }}>
                <canvas ref={aRef} style={{ aspectRatio: '4/3', transform: `scale(${zoom}) translateX(${pan}px)` }} />
              </div>
            </div>
            <div>
              <Tag tone="info">方案 B</Tag>
              <div className="canvas-wrap" style={{ overflow: 'hidden' }}>
                <canvas ref={bRef} style={{ aspectRatio: '4/3', transform: `scale(${zoom}) translateX(${pan}px)` }} />
              </div>
            </div>
          </div>
          <div className="grid grid-4" style={{ margin: '14px 0' }}>
            <Metric k="A 信噪比 / 曝光" v={`${pair.a.snr.toFixed(0)} / ${proc.exposureTime}min`} tone={pair.a.snr >= pair.b.snr ? 'good' : ''} />
            <Metric k="B 信噪比 / 曝光" v={`${pair.b.snr.toFixed(0)} / ${processes.find((p) => p.id === bId)?.exposureTime}min`} tone={pair.b.snr >= pair.a.snr ? 'good' : ''} />
            <Metric k="A 黑度范围" v={`${pair.a.densityMin.toFixed(2)}~${pair.a.densityMax.toFixed(2)}`} />
            <Metric k="B 黑度范围" v={`${pair.b.densityMin.toFixed(2)}~${pair.b.densityMax.toFixed(2)}`} />
          </div>
          <div className="canvas-wrap"><canvas ref={chartRef} style={{ height: 220 }} /></div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            结论建议：{pair.a.snr > pair.b.snr ? '方案 A 信噪比更高' : '方案 B 信噪比更高'}；
            {proc.exposureTime < (processes.find((p) => p.id === bId)?.exposureTime ?? 0) ? '方案 A 曝光时间更短' : '方案 B 曝光时间更短'}。
            信噪比与效率按验收优先级取舍。
          </p>
        </>
      ) : <p className="muted">选择方案 B 后自动出对比图。</p>}
    </div>
  );
}
