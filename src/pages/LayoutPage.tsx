import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, store, useActiveStandard } from '@/data/store';
import { GLViewer } from '@/gl/viewer';
import { computeGeometry, ellipticalGap } from '@/core/geometry';
import { planExposure } from '@/core/exposure';
import { ugLimit } from '@/core/standards';
import { renderUnrolledLayout } from '@/components/canvas';
import { Metric, Tag } from '@/components/ui';
import type { ProcessParams } from '@/types';

export function LayoutPage() {
  const { processes, machines, detectors, workpieces } = useStore();
  const standard = useActiveStandard();
  const [procId, setProcId] = useState(processes[0]?.id ?? '');
  const proc = processes.find((p) => p.id === procId);
  const machine = machines.find((m) => m.id === proc?.machineId);
  const detector = detectors.find((d) => d.id === proc?.detectorId);
  const wp = workpieces.find((w) => w.id === proc?.workpieceId);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const unrollRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<GLViewer | null>(null);
  const [doubleWall, setDoubleWall] = useState(false);
  const [offsetMm, setOffsetMm] = useState(8);
  const [blocked, setBlocked] = useState(false);

  // 初始化 3D 场景
  useEffect(() => {
    if (!canvasRef.current || !proc || !detector) return;
    const detW = detector.cols * detector.pixelSize;
    const detH = detector.rows * detector.pixelSize;
    const scene = {
      source: [0, 0, proc.layout.sourceToObject] as [number, number, number],
      detector: [0, 0, -proc.layout.objectToDetector] as [number, number, number],
      detectorSize: [detW * 0.4, detH * 0.4] as [number, number],
      cylinder: wp?.shape === 'cylinder' ? { radius: wp.outerDiameter! / 2, length: wp.length ?? 600 } : undefined,
      plate: wp?.shape === 'plate' ? { sx: wp.width ?? 400, sy: 40, sz: wp.height ?? 30 } : undefined,
    };
    const viewer = new GLViewer(canvasRef.current, scene);
    viewerRef.current = viewer;
    viewer.onDrag = (which, z) => {
      if (!proc) return;
      const lay = { ...proc.layout };
      if (which === 'source') lay.sourceToObject = Math.max(50, z);
      else lay.objectToDetector = Math.max(0, -z);
      lay.focalDistance = lay.sourceToObject + lay.objectToDetector;
      store.set('processes', (l) => l.map((p) => (p.id === proc.id ? { ...p, layout: lay } : p)));
    };
    let raf = 0;
    const loop = () => {
      // 每帧把工艺单的 L1/L2 同步到 3D 坐标，保证拖拽与表单双向一致、焦距显示正确
      viewer.scene.source = [0, 0, proc.layout.sourceToObject];
      viewer.scene.detector = [0, 0, -proc.layout.objectToDetector];
      viewer.render();
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [procId, detector, wp, proc]);

  const geo = useMemo(() => {
    if (!proc || !machine || !detector) return null;
    return computeGeometry(machine.focalSpot, proc.layout, detector.pixelSize);
  }, [proc, machine, detector]);

  const limit = proc ? ugLimit(standard, proc.thickness) : 0;
  const ugOk = geo ? geo.ug <= limit : true;
  useEffect(() => setBlocked(!ugOk), [ugOk]);

  const angle = proc?.layout.offsetAngle ?? 0;

  const ellipse = useMemo(() => {
    if (!geo || !doubleWall) return null;
    return ellipticalGap(offsetMm, geo.magnification, 12, geo.ug);
  }, [geo, doubleWall, offsetMm]);

  const plan = useMemo(() => {
    if (!wp?.outerDiameter || !proc) return null;
    try {
      return planExposure({
        outerDiameter: wp.outerDiameter,
        innerDiameter: wp.outerDiameter - 2 * proc.thickness,
        sourceSide: proc.layout.sourceSide,
        focalDistance: proc.layout.focalDistance,
        k: standard.kValue,
        seamType: proc.seamType,
        seamLength: wp.length,
        effectiveLengthPerShot: 300,
      });
    } catch {
      return null;
    }
  }, [wp, proc, standard]);

  useEffect(() => {
    if (unrollRef.current && plan && wp) {
      renderUnrolledLayout(unrollRef.current, plan.layoutMarks, Math.PI * wp.outerDiameter!, wp.length ?? 0);
    }
  }, [plan, wp]);

  if (!proc) return <div className="card">暂无工艺参数，请先到「工艺参数」页新建工艺单。</div>;

  return (
    <div className="grid" style={{ gridTemplateColumns: '1.5fr 1fr' }}>
      <div className="card">
        <h3>三维透照布置（拖拽橙球=源、绿框=探测器；空白处旋转，滚轮缩放）</h3>
        <div className="canvas-wrap" style={{ height: 460 }}>
          <canvas ref={canvasRef} style={{ height: '100%' }} />
        </div>
        <div className="legend" style={{ marginTop: 8 }}>
          <span><i style={{ background: '#f0a848' }} />射线源</span>
          <span><i style={{ background: '#36c6a0' }} />探测器</span>
          <span><i style={{ background: '#4da3ff' }} />束锥/主束</span>
          <span><i style={{ background: '#8ca6c7' }} />工件线框</span>
        </div>
      </div>

      <div>
        <div className="card">
          <h3>工艺选择与实时几何量</h3>
          <select style={{ width: '100%', marginBottom: 12 }} value={procId} onChange={(e) => setProcId(e.target.value)}>
            {processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {geo && (
            <div className="grid grid-2">
              <Metric k="焦距 F（实时）" v={geo.f} unit="mm" />
              <Metric k="L1 / L2" v={`${geo.l1.toFixed(0)}/${geo.l2.toFixed(0)}`} unit="mm" />
              <Metric k="放大倍数 M" v={geo.magnification.toFixed(3)} />
              <Metric k="偏透角" v={angle.toFixed(2)} unit="°" />
              <Metric k="几何不清晰度 Ug" v={geo.ug.toFixed(3)} unit="mm" tone={ugOk ? 'good' : 'bad'} />
              <Metric k="标准限值" v={limit} unit="mm" tone={ugOk ? 'good' : 'bad'} />
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            {ugOk ? <Tag tone="ok">✓ Ug 符合 {standard.standardCode}，可以保存布置</Tag>
              : <Tag tone="danger">✕ Ug 超标，该摆法标红禁止保存</Tag>}
          </div>
          <button className="btn danger small" style={{ marginTop: 12, width: '100%' }} disabled={ugOk}
            onClick={() => alert('超标布置已被系统拦截：请增大 L1（源远离工件）或减小 L2（探测器贴紧工件）')}>
            {ugOk ? '布置合规，可在工艺单保存' : '不合规布置 — 已禁止保存'}
          </button>
        </div>

        <div className="card">
          <h3>双壁双影椭圆开口校验</h3>
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={doubleWall} onChange={(e) => setDoubleWall(e.target.checked)} /> 启用双壁双影工艺
          </label>
          {doubleWall && (
            <>
              <label className="field" style={{ marginTop: 10 }}>源横向偏移 mm<input type="number" value={offsetMm} onChange={(e) => setOffsetMm(+e.target.value)} /></label>
              {ellipse && (
                <div style={{ marginTop: 10 }}>
                  <Kv k="椭圆开口间距 g">{ellipse.gapMm.toFixed(2)} mm</Kv>
                  <Kv k="标准最小要求">≥ {ellipse.requiredMin} mm</Kv>
                  <div style={{ marginTop: 8 }}>{ellipse.ok ? <Tag tone="ok">✓ 开口间距足够，上下焊缝影像可分辨</Tag> : <Tag tone="danger">✕ 开口不足，增大源偏移</Tag>}</div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h3>筒体展开布片方案{plan ? `（${plan.method}，N=${plan.shotCount} 次）` : ''}</h3>
        <div className="canvas-wrap"><canvas ref={unrollRef} style={{ height: 260 }} /></div>
        {plan && <div className="formula-box" style={{ marginTop: 10 }}>{plan.derivation.join('\n')}</div>}
      </div>
    </div>
  );
}

function Kv({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="kvline"><span>{k}</span><span className="mono">{children}</span></div>;
}
