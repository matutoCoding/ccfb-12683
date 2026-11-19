import { useMemo, useRef, useState, useEffect } from 'react';
import { useStore, store, useActiveStandard } from '@/data/store';
import { lookupMu } from '@/core/attenuation';
import { runSimulation, densityProfile, type SimOptions } from '@/core/simulation';
import { renderGrayImage, renderProfile } from '@/components/canvas';
import { Metric, Tag, KvLine, Modal } from '@/components/ui';
import { ugLimit } from '@/core/standards';
import type { SimulationResult } from '@/types';

type SimWithImage = SimulationResult & { image: Float32Array; densityMap: Float32Array; thicknessMap: Float32Array };

const W = 320;
const H = 240;

export function SimulationPage() {
  const { processes, machines, detectors, workpieces, attenuation } = useStore();
  const standard = useActiveStandard();
  const [procId, setProcId] = useState(processes[0]?.id ?? '');
  const proc = processes.find((p) => p.id === procId);
  const machine = machines.find((m) => m.id === proc?.machineId);
  const detector = detectors.find((d) => d.id === proc?.detectorId);
  const imgRef = useRef<HTMLCanvasElement>(null);
  const profRef = useRef<HTMLCanvasElement>(null);
  const [result, setResult] = useState<SimWithImage | null>(null);
  const [probe, setProbe] = useState<{ x: number; y: number } | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [showCalibCompare, setShowCalibCompare] = useState(false);

  const [opts, setOpts] = useState<SimOptions>({
    width: W, height: H, mode: 'dr', weldCenterX: 0.5, weldWidthFrac: 0.18,
    weldReinforcement: 3, frames: 4, seed: 7,
    defects: [{ x: 0.42, y: 0.45, diameterMm: 6, densityLoss: 8 }, { x: 0.58, y: 0.6, diameterMm: 4, densityLoss: 6 }],
  });

  const mu = useMemo(() => (proc ? lookupMu(attenuation, proc.material, proc.kv) : null), [attenuation, proc]);

  const run = () => {
    if (!proc || !machine || !detector || !mu) {
      alert('工艺单关联的射线机/探测器已被删除或缺失，请在工艺参数页重新选择设备');
      return;
    }
    const wp = workpieces.find((w) => w.id === proc.workpieceId);
    if (!wp) {
      alert('关联工件台账缺失');
      return;
    }
    const r = runSimulation(proc, wp, machine, detector, standard, mu, opts);
    setResult(r as SimWithImage);
    setProbe(null);
  };

  // 渲染仿真图
  useEffect(() => {
    if (!result || !imgRef.current || !detector) return;
    const oor: boolean[] = [];
    for (let i = 0; i < result.densityMap.length; i++) {
      const d = result.densityMap[i];
      oor.push(d < standard.densityRange.min || d > standard.densityRange.max);
    }
    renderGrayImage(imgRef.current, result.image, result.width, result.height, {
      badPixels: detector.badPixels,
      defects: opts.defects.map((d) => ({ x: d.x, y: d.y, r: d.diameterMm / 2 })),
      outOfRange: oor,
    });
  }, [result, detector, opts.defects, standard]);

  // 剖面曲线（沿焊缝中部拉线）
  const profile = useMemo(() => (result ? densityProfile(result, 0.5) : []), [result]);
  useEffect(() => {
    if (profRef.current && profile.length) {
      renderProfile(profRef.current, profile, standard.weldDensityRange, probe?.x);
    }
  }, [profile, probe, standard]);

  const probeDensity = probe && result ? result.densityMap[Math.round(probe.y * (H - 1)) * W + Math.round(probe.x * (W - 1))] : null;

  if (!proc) return <div className="card">请先在「工艺参数」页建立工艺单。</div>;

  return (
    <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
      <div className="card">
        <h3>仿真成像（指数衰减 + 分档散射 + 焦点半影 + 探测器噪声）</h3>
        <div className="row" style={{ marginBottom: 10 }}>
          <select value={procId} onChange={(e) => setProcId(e.target.value)}>
            {processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="btn small" onClick={run}>▶ 运行仿真</button>
          <button className="btn ghost small" onClick={() => setShowCalibCompare(true)}>校正前后对比</button>
          <div className="spacer" />
          {mu && <Tag tone={mu.extrapolated ? 'warn' : 'ok'}>μ={mu.mu.toFixed(3)} /cm {mu.extrapolated ? '外推' : `HVL ${mu.hvlMm.toFixed(1)}mm`}</Tag>}
        </div>
        <div className="canvas-wrap" style={{ maxWidth: 640 }}>
          <canvas ref={imgRef} style={{ aspectRatio: `${W}/${H}`, cursor: 'crosshair' }}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setProbe({ x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height });
            }} />
        </div>
        <div className="legend" style={{ marginTop: 8 }}>
          <span><i style={{ background: '#ff3dd0' }} />坏像素（邻域插值修补，非缺陷）</span>
          <span><i style={{ background: '#37e6ff' }} />缺陷（气孔/夹渣）</span>
          <span><i style={{ background: '#f0a848' }} />黑度超限区段</span>
        </div>
        {probe && probeDensity !== null && (
          <div className="metric" style={{ marginTop: 10, maxWidth: 320 }}>
            <div className="k">黑度计探头 @ ({(probe.x * 100).toFixed(0)}%, {(probe.y * 100).toFixed(0)}%)</div>
            <div className="v">{probeDensity.toFixed(3)} <span className="u">D</span></div>
            <div style={{ marginTop: 4 }}>
              {probeDensity >= standard.densityRange.min && probeDensity <= standard.densityRange.max
                ? <Tag tone="ok">在标准黑度区间内</Tag> : <Tag tone="danger">超出黑度限值</Tag>}
            </div>
          </div>
        )}
      </div>

      <div>
        <div className="card">
          <h3>仿真参数</h3>
          <div className="grid grid-2">
            <label className="field">成像模式
              <select value={opts.mode} onChange={(e) => setOpts({ ...opts, mode: e.target.value as SimOptions['mode'] })}>
                <option value="dr">DR 数字平板</option><option value="film">胶片（H&D 曲线）</option>
              </select>
            </label>
            <label className="field">叠帧帧数（压噪声）<input type="number" min={1} value={opts.frames} onChange={(e) => setOpts({ ...opts, frames: +e.target.value })} /></label>
            <label className="field">焊缝增厚 mm<input type="number" value={opts.weldReinforcement} onChange={(e) => setOpts({ ...opts, weldReinforcement: +e.target.value })} /></label>
            <label className="field">焊缝宽度（归一化）<input type="number" step="0.02" value={opts.weldWidthFrac} onChange={(e) => setOpts({ ...opts, weldWidthFrac: +e.target.value })} /></label>
            <label className="field">随机种子<input type="number" value={opts.seed} onChange={(e) => setOpts({ ...opts, seed: +e.target.value })} /></label>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>透照厚度自动取工件最厚处 {proc.thickness}mm；管电压 {proc.kv}kV 升高时 μ 下降、对比度降低，可在寻优页扫参验证趋势。</p>
        </div>

        {result && (
          <>
            <div className="card">
              <h3>仿真结果统计</h3>
              <div className="grid grid-2">
                <Metric k="黑度 D 范围" v={`${result.densityMin.toFixed(2)}~${result.densityMax.toFixed(2)}`} />
                <Metric k="平均黑度" v={result.densityMean.toFixed(2)} />
                <Metric k="信噪比 SNR" v={result.snr.toFixed(1)} tone="good" />
                <Metric k="主因对比度 C" v={result.contrast.toFixed(4)} />
                <Metric k="几何模糊" v={result.geometricBlurPx.toFixed(2)} unit="px" />
                <Metric k="运动模糊" v={result.motionBlurPx.toFixed(2)} unit="px" />
              </div>
              <div style={{ marginTop: 10 }}>
                {result.densityMin >= standard.densityRange.min && result.densityMax <= standard.densityRange.max
                  ? <Tag tone="ok">黑度整体在 {standard.densityRange.min}~{standard.densityRange.max} 内</Tag>
                  : <Tag tone="warn">存在黑度超限区段（图中橙色染色）</Tag>}
              </div>
              <button className="btn ghost small" style={{ marginTop: 12 }} onClick={() => setShowEvidence(true)}>查看仿真依据留底</button>
            </div>
          </>
        )}
      </div>

      {result && (
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h3>黑度剖面曲线（沿焊缝拉线，绿色带=标准黑度区间，橙线=探头位置）</h3>
          <div className="canvas-wrap"><canvas ref={profRef} style={{ height: 220 }} /></div>
        </div>
      )}

      {showEvidence && result && <EvidenceModal result={result} onClose={() => setShowEvidence(false)} limit={ugLimit(standard, proc.thickness)} />}
      {showCalibCompare && <CalibCompareModal opts={opts} proc={proc} standard={standard} onClose={() => setShowCalibCompare(false)}
        run={(o) => { if (!machine || !detector || !mu) return null; return runSimulation(proc, workpieces.find((w) => w.id === proc.workpieceId)!, machine, detector, standard, mu, o) as SimWithImage; }} />}
    </div>
  );
}

function EvidenceModal({ result, onClose, limit }: { result: SimWithImage; onClose: () => void; limit: number }) {
  const e = result.evidence;
  return (
    <Modal title="仿真计算依据留底（客户审片可逐项核对）" onClose={onClose} wide>
      <div className="formula-box" style={{ marginBottom: 12 }}>{e.formula}</div>
      <div className="grid grid-3">
        <KvLine k="执行标准">{e.standard}</KvLine>
        <KvLine k="管电压">{e.kv} kV</KvLine>
        <KvLine k="线衰减系数 μ">{e.muPerCm.toFixed(4)} /cm</KvLine>
        <KvLine k="半值层 HVL">{e.halfValueLayerMm.toFixed(2)} mm</KvLine>
        <KvLine k="十分之一值层 TVL">{e.tenthValueLayerMm.toFixed(2)} mm</KvLine>
        <KvLine k="散射比 n（厚度分档）">{e.scatterRatio}</KvLine>
        <KvLine k="透照厚度 T">{e.thicknessMm} mm</KvLine>
        <KvLine k="焦点 d">{e.focalSpot} mm</KvLine>
        <KvLine k="焦距 F / L1 / L2">{`${e.focalDistance}/${e.l1}/${e.l2}`}</KvLine>
        <KvLine k="几何不清晰度 Ug">{e.ug.toFixed(3)} mm</KvLine>
        <KvLine k="Ug 限值">{e.ugLimit} mm</KvLine>
        <KvLine k="放大倍数 M">{e.magnification.toFixed(3)}</KvLine>
        <KvLine k="直接辐射 Id">{e.directIntensity.toExponential(3)}</KvLine>
        <KvLine k="总辐射 I=(1+n)Id">{e.totalIntensity.toExponential(3)}</KvLine>
        <KvLine k="响应曲线">{e.characteristicCurve}</KvLine>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>Ug 限值对照：{e.ug.toFixed(3)} {e.ug <= limit ? '≤' : '>'} {limit}mm，{e.ug <= limit ? '合规' : '不合规'}。本留底随工艺单与报告一并归档，参数任何修改都会产生新版本且不覆盖旧记录。</p>
    </Modal>
  );
}

/** 校正前后并排：同一参数生成未校正（含暗场/增益偏差/坏点/单帧噪声）与完整校正图 */
function CalibCompareModal({ opts, proc, standard, onClose, run }: {
  opts: SimOptions; proc: import('@/types').ProcessParams; standard: ReturnType<typeof useActiveStandard>;
  onClose: () => void; run: (o: SimOptions) => SimWithImage | null;
}) {
  const beforeRef = useRef<HTMLCanvasElement>(null);
  const afterRef = useRef<HTMLCanvasElement>(null);
  const [pair, setPair] = useState<{ before: SimWithImage; after: SimWithImage } | null>(null);

  useEffect(() => {
    // 构造一套含暗场偏置、增益不均、坏点的校正集
    const cal: import('@/core/detector').CalibrationSet = {
      width: W, height: H,
      dark: new Float32Array(W * H).fill(0.02),
      gain: Float32Array.from({ length: W * H }, (_, i) => 0.9 + 0.2 * ((i * 7) % 10) / 10),
      bad: new Uint8Array(W * H),
    };
    const badList: [number, number][] = [[60, 80], [200, 150], [260, 60]];
    badList.forEach(([x, y]) => (cal.bad[y * W + x] = 1));
    const before = run({ ...opts, frames: 1, calibration: undefined, seed: 11 });
    const after = run({ ...opts, frames: opts.frames, calibration: cal, seed: 11 });
    if (before && after) {
      setPair({ before, after });
      setTimeout(() => {
        if (beforeRef.current) renderGrayImage(beforeRef.current, before.image, W, H);
        if (afterRef.current) {
          const oor: boolean[] = [];
          for (let i = 0; i < after.densityMap.length; i++) {
            const d = after.densityMap[i];
            oor.push(d < standard.densityRange.min || d > standard.densityRange.max);
          }
          renderGrayImage(afterRef.current, after.image, W, H, { badPixels: badList, outOfRange: oor });
        }
      }, 50);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal title="探测器校正前后对比（暗场+增益+坏点插值+多帧平均）" onClose={onClose} wide>
      <div className="grid grid-2">
        <div>
          <Tag tone="danger">校正前：单帧、含暗场偏置/增益不均/坏点</Tag>
          <div className="canvas-wrap" style={{ marginTop: 8 }}><canvas ref={beforeRef} style={{ aspectRatio: `${W}/${H}` }} /></div>
          {pair && <p className="mono muted" style={{ fontSize: 12 }}>SNR {pair.before.snr.toFixed(1)} · D {pair.before.densityMin.toFixed(2)}~{pair.before.densityMax.toFixed(2)}</p>}
        </div>
        <div>
          <Tag tone="ok">校正后：暗场扣除+增益归一+坏点邻域插值+{opts.frames}帧平均</Tag>
          <div className="canvas-wrap" style={{ marginTop: 8 }}><canvas ref={afterRef} style={{ aspectRatio: `${W}/${H}` }} /></div>
          {pair && <p className="mono muted" style={{ fontSize: 12 }}>SNR {pair.after.snr.toFixed(1)}（提升 {((pair.after.snr / pair.before.snr - 1) * 100).toFixed(0)}%）· D {pair.after.densityMin.toFixed(2)}~{pair.after.densityMax.toFixed(2)}</p>}
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>坏点用品红框单独标识，按 3×3 有效邻域均值修补，不会与真实缺陷（青圈）混淆。</p>
    </Modal>
  );
}
