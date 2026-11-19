import { useMemo, useState } from 'react';
import { useStore, store, useActiveStandard } from '@/data/store';
import { lookupMu, invertMuFromBlocks } from '@/core/attenuation';
import { planExposure } from '@/core/exposure';
import { ugLimit } from '@/core/standards';
import { exportCsv, uid } from '@/data/storage';
import { Modal, Tag, Metric, KvLine } from '@/components/ui';
import type {
  AttenuationTable,
  CalibrationRecord,
  Detector,
  ProcessParams,
  XRayMachine,
} from '@/types';

type Tab = 'device' | 'attenuation' | 'count' | 'process';

export function ProcessPage() {
  const [tab, setTab] = useState<Tab>('device');
  return (
    <div>
      <div className="row" style={{ marginBottom: 14 }}>
        {([
          ['device', '设备卡（射线机/探测器）'],
          ['attenuation', '衰减系数库与试块反推'],
          ['count', '透照次数与布片'],
          ['process', '工艺参数单'],
        ] as [Tab, string][]).map(([k, label]) => (
          <button key={k} className={`btn ${tab === k ? '' : 'ghost'} small`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab === 'device' && <DeviceTab />}
      {tab === 'attenuation' && <AttenuationTab />}
      {tab === 'count' && <CountTab />}
      {tab === 'process' && <ProcessTab />}
    </div>
  );
}

// ============ 设备卡 ============
function DeviceTab() {
  const { machines, detectors } = useStore();
  const [editM, setEditM] = useState<XRayMachine | null>(null);
  const [editD, setEditD] = useState<Detector | null>(null);

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>X 射线机</h3>
        <div className="spacer" />
        <button className="btn small" onClick={() => setEditM({ id: uid('xm'), model: '', kvMin: 80, kvMax: 350, maMin: 2, maMax: 5, focalSpot: 3 })}>＋ 新增射线机</button>
      </div>
      <div className="grid grid-3">
        {machines.map((m) => (
          <div className="card" key={m.id}>
            <h3>{m.model || '未命名'}</h3>
            <KvLine k="管电压范围">{m.kvMin}–{m.kvMax} kV</KvLine>
            <KvLine k="管电流范围">{m.maMin}–{m.maMax} mA</KvLine>
            <KvLine k="焦点尺寸 d">{m.focalSpot} mm{m.focalSpotSmall ? ` / 小焦点 ${m.focalSpotSmall}` : ''}</KvLine>
            <KvLine k="额定功率">{m.power ? `${m.power} W` : '—'}</KvLine>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn ghost small" onClick={() => setEditM(m)}>编辑</button>
              <button className="btn danger small" onClick={() => store.set('machines', (l) => l.filter((x) => x.id !== m.id))}>删除</button>
            </div>
          </div>
        ))}
      </div>

      <div className="row" style={{ margin: '18px 0 12px' }}>
        <h3 style={{ margin: 0 }}>数字探测器（含坏像素）</h3>
        <div className="spacer" />
        <button className="btn small" onClick={() => setEditD({ id: uid('dt'), model: '', pixelSize: 0.2, cols: 1024, rows: 1024, bitDepth: 16, badPixels: [] })}>＋ 新增探测器</button>
      </div>
      <div className="grid grid-3">
        {detectors.map((d) => (
          <div className="card" key={d.id}>
            <h3>{d.model || '未命名'}</h3>
            <KvLine k="像元尺寸">{d.pixelSize} mm</KvLine>
            <KvLine k="分辨率">{d.cols} × {d.rows}</KvLine>
            <KvLine k="位深 / 固有不清晰度">{d.bitDepth} bit / {d.inherentUnsharpness ?? (2 * d.pixelSize).toFixed(2)} mm</KvLine>
            <KvLine k="坏像素"><span className="bad">{d.badPixels?.length ?? 0} 个（仿真中品红标记）</span></KvLine>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn ghost small" onClick={() => setEditD(d)}>编辑/导入坏点图</button>
              <button className="btn danger small" onClick={() => store.set('detectors', (l) => l.filter((x) => x.id !== d.id))}>删除</button>
            </div>
          </div>
        ))}
      </div>

      {editM && (
        <Modal title="射线机设备卡" onClose={() => setEditM(null)}>
          <div className="grid grid-2">
            <label className="field">型号<input value={editM.model} onChange={(e) => setEditM({ ...editM, model: e.target.value })} /></label>
            <label className="field">焦点尺寸 mm<input type="number" step="0.1" value={editM.focalSpot} onChange={(e) => setEditM({ ...editM, focalSpot: +e.target.value })} /></label>
            <label className="field">最小管电压 kV<input type="number" value={editM.kvMin} onChange={(e) => setEditM({ ...editM, kvMin: +e.target.value })} /></label>
            <label className="field">最大管电压 kV<input type="number" value={editM.kvMax} onChange={(e) => setEditM({ ...editM, kvMax: +e.target.value })} /></label>
            <label className="field">最小管电流 mA<input type="number" value={editM.maMin} onChange={(e) => setEditM({ ...editM, maMin: +e.target.value })} /></label>
            <label className="field">最大管电流 mA<input type="number" value={editM.maMax} onChange={(e) => setEditM({ ...editM, maMax: +e.target.value })} /></label>
            <label className="field">小焦点 mm（可选）<input type="number" step="0.1" value={editM.focalSpotSmall ?? ''} onChange={(e) => setEditM({ ...editM, focalSpotSmall: e.target.value ? +e.target.value : undefined })} /></label>
            <label className="field">额定功率 W<input type="number" value={editM.power ?? ''} onChange={(e) => setEditM({ ...editM, power: e.target.value ? +e.target.value : undefined })} /></label>
          </div>
          <div className="row" style={{ marginTop: 16 }}><div className="spacer" />
            <button className="btn" onClick={() => {
              store.set('machines', (l) => {
                const i = l.findIndex((x) => x.id === editM.id);
                return i < 0 ? [...l, editM] : l.map((x) => (x.id === editM.id ? editM : x));
              });
              setEditM(null);
            }}>保存设备卡</button>
          </div>
        </Modal>
      )}

      {editD && <DetectorEditor d={editD} onClose={() => setEditD(null)} />}
    </div>
  );
}

function DetectorEditor({ d, onClose }: { d: Detector; onClose: () => void }) {
  const [badText, setBadText] = useState((d.badPixels ?? []).map((p) => p.join(',')).join('\n'));
  return (
    <Modal title="探测器设备卡" onClose={onClose}>
      <div className="grid grid-2">
        <label className="field">型号<input value={d.model} onChange={(e) => (d.model = e.target.value)} /></label>
        <label className="field">像元尺寸 mm<input type="number" step="0.01" value={d.pixelSize} onChange={(e) => (d.pixelSize = +e.target.value)} /></label>
        <label className="field">列数 cols<input type="number" value={d.cols} onChange={(e) => (d.cols = +e.target.value)} /></label>
        <label className="field">行数 rows<input type="number" value={d.rows} onChange={(e) => (d.rows = +e.target.value)} /></label>
        <label className="field">位深 bit<input type="number" value={d.bitDepth} onChange={(e) => (d.bitDepth = +e.target.value)} /></label>
        <label className="field">固有不清晰度 mm<input type="number" step="0.01" value={d.inherentUnsharpness ?? ''} onChange={(e) => (d.inherentUnsharpness = e.target.value ? +e.target.value : undefined)} /></label>
      </div>
      <label className="field" style={{ marginTop: 12 }}>坏像素坐标（每行一个 “行,列”，也可由坏点分布图导入）
        <textarea rows={4} value={badText} onChange={(e) => setBadText(e.target.value)} />
      </label>
      <input type="file" accept=".csv,.png" style={{ marginTop: 8 }} onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) { d.badPixelMap = f.name; alert(`已关联坏点图 ${f.name}（坐标仍以手动表/CSV 为准）`); }
      }} />
      <div className="row" style={{ marginTop: 16 }}><div className="spacer" />
        <button className="btn" onClick={() => {
          d.badPixels = badText.split('\n').map((s) => s.trim()).filter(Boolean).map((s) => s.split(/[,\s]+/).map(Number) as [number, number]);
          store.set('detectors', (l) => {
            const i = l.findIndex((x) => x.id === d.id);
            return i < 0 ? [...l, d] : l.map((x) => (x.id === d.id ? d : x));
          });
          onClose();
        }}>保存探测器</button>
      </div>
    </Modal>
  );
}

// ============ 衰减系数库 ============
function AttenuationTab() {
  const { attenuation } = useStore();
  const [sel, setSel] = useState(attenuation[0]?.material ?? 'steel');
  const [kv, setKv] = useState(180);
  const table = attenuation.find((t) => t.material === sel)!;
  const lookup = useMemo(() => lookupMu(attenuation, sel, kv), [attenuation, sel, kv]);

  // 试块反推
  const [cal, setCal] = useState({ t1: 20, t2: 30, d1: 3.2, d2: 2.4, kv: 180, gradient: 2.4, scatterRatio: 1.5 });
  const muInv = useMemo(() => {
    try {
      return invertMuFromBlocks({ date: Date.now(), ...cal });
    } catch {
      return NaN;
    }
  }, [cal]);

  return (
    <div className="grid" style={{ gridTemplateColumns: '1.2fr 1fr' }}>
      <div className="card">
        <div className="row">
          <h3 style={{ margin: 0 }}>线衰减系数 μ（1/cm）</h3>
          <select value={sel} onChange={(e) => setSel(e.target.value)}>
            {attenuation.map((t) => <option key={t.material} value={t.material}>{t.materialName}</option>)}
          </select>
          <div className="spacer" />
          <button className="btn ghost small" onClick={() => exportCsv(`衰减系数-${table.materialName}.csv`, ['管电压kV', '线衰减系数1/cm'], table.points.map((p) => [p.kv, p.mu]))}>导出 CSV 核对</button>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>来源：{table.source}；密度 {table.density} g/cm³</p>
        <table>
          <thead><tr><th>管电压 kV</th><th>μ (1/cm)</th><th>HVL mm</th><th>TVL mm</th></tr></thead>
          <tbody>
            {table.points.map((p) => (
              <tr key={p.kv}>
                <td>{p.kv}</td><td className="mono">{p.mu.toFixed(3)}</td>
                <td className="mono">{((10 * Math.LN2) / p.mu).toFixed(2)}</td>
                <td className="mono">{((10 * Math.LN10) / p.mu).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <div className="card">
          <h3>随查随用（log-log 插值）</h3>
          <label className="field">管电压 kV<input type="number" value={kv} onChange={(e) => setKv(+e.target.value)} /></label>
          <div className="grid grid-3" style={{ marginTop: 12 }}>
            <Metric k="μ" v={lookup.mu.toFixed(3)} unit="1/cm" />
            <Metric k="半值层 HVL" v={lookup.hvlMm.toFixed(2)} unit="mm" />
            <Metric k="十分之一值层" v={lookup.tvlMm.toFixed(2)} unit="mm" />
          </div>
          {lookup.extrapolated && <p className="warn-c" style={{ fontSize: 12 }}>⚠ 当前 kV 超出表范围，结果为外推值，请用试块复核</p>}
        </div>

        <div className="card">
          <h3>两试块反推等效 μ（库中查不到的材料）</h3>
          <div className="grid grid-3">
            <label className="field">试块1厚 mm<input type="number" value={cal.t1} onChange={(e) => setCal({ ...cal, t1: +e.target.value })} /></label>
            <label className="field">试块2厚 mm<input type="number" value={cal.t2} onChange={(e) => setCal({ ...cal, t2: +e.target.value })} /></label>
            <label className="field">管电压 kV<input type="number" value={cal.kv} onChange={(e) => setCal({ ...cal, kv: +e.target.value })} /></label>
            <label className="field">D1 黑度/灰度<input type="number" step="0.1" value={cal.d1} onChange={(e) => setCal({ ...cal, d1: +e.target.value })} /></label>
            <label className="field">D2 黑度/灰度<input type="number" step="0.1" value={cal.d2} onChange={(e) => setCal({ ...cal, d2: +e.target.value })} /></label>
            <label className="field">胶片梯度 G<input type="number" step="0.1" value={cal.gradient} onChange={(e) => setCal({ ...cal, gradient: +e.target.value })} /></label>
          </div>
          <div className="formula-box" style={{ margin: '10px 0' }}>μ = 10·ln10·(D1−D2) / [G·(t2−t1)]</div>
          <div className="row">
            <Metric k="反推 μ" v={Number.isFinite(muInv) ? muInv.toFixed(3) : '参数非法'} unit="1/cm" tone="good" />
            <div className="spacer" />
            <button className="btn small" disabled={!Number.isFinite(muInv)} onClick={() => {
              const rec: CalibrationRecord = { date: Date.now(), ...cal, mu: muInv };
              store.set('attenuation', (list) => list.map((t) =>
                t.material === sel
                  ? { ...t, points: [...t.points.filter((p) => p.kv !== cal.kv), { kv: cal.kv, mu: muInv }].sort((a, b) => a.kv - b.kv), calibration: rec, source: t.source + '；已叠加试块反推值' }
                  : t));
              alert('反推值已写入该材料系数表并留底');
            }}>写入系数表并留底</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ 透照次数 ============
function CountTab() {
  const { workpieces } = useStore();
  const standard = useActiveStandard();
  const [wpId, setWpId] = useState(workpieces[0]?.id ?? '');
  const wp = workpieces.find((w) => w.id === wpId);
  const [side, setSide] = useState<'outside' | 'inside'>('outside');
  const [f, setF] = useState(1200);
  const [seam, setSeam] = useState<'circumferential' | 'longitudinal'>('circumferential');
  const [le, setLe] = useState(300);

  const plan = useMemo(() => {
    if (!wp?.outerDiameter) return null;
    try {
      return planExposure({
        outerDiameter: wp.outerDiameter,
        innerDiameter: wp.outerDiameter - 2 * wp.tMax,
        sourceSide: side,
        focalDistance: f,
        k: standard.kValue,
        seamType: seam,
        seamLength: wp.length,
        effectiveLengthPerShot: le,
      });
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [wp, side, f, seam, le, standard]);

  return (
    <div className="card">
      <div className="grid grid-4">
        <label className="field">工件
          <select value={wpId} onChange={(e) => setWpId(e.target.value)}>
            {workpieces.map((w) => <option key={w.id} value={w.id}>{w.heatNo} {w.name}</option>)}
          </select>
        </label>
        <label className="field">焊缝类型
          <select value={seam} onChange={(e) => setSeam(e.target.value as typeof seam)}>
            <option value="circumferential">环缝</option><option value="longitudinal">纵缝</option>
          </select>
        </label>
        <label className="field">透照方式
          <select value={side} onChange={(e) => setSide(e.target.value as typeof side)}>
            <option value="outside">源在外（外透法）</option><option value="inside">源在内（中心/偏心）</option>
          </select>
        </label>
        <label className="field">焦距 F mm<input type="number" value={f} onChange={(e) => setF(+e.target.value)} /></label>
        {seam === 'longitudinal' && <label className="field">每次有效评定长度 mm<input type="number" value={le} onChange={(e) => setLe(+e.target.value)} /></label>}
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>横向裂纹检出角按 K={standard.kValue}（{standard.name}）控制</p>

      {plan && 'error' in plan ? <p className="bad">⚠ {plan.error}</p> : plan && (
        <>
          <div className="grid grid-4" style={{ margin: '14px 0' }}>
            <Metric k="最少透照次数 N" v={plan.shotCount} unit="次" tone="good" />
            <Metric k="单次有效评定长度" v={plan.effectiveLength.toFixed(1)} unit="mm" />
            <Metric k="搭接长度" v={plan.overlap.toFixed(1)} unit="mm" />
            <Metric k="覆盖半张角 β" v={plan.halfAngleDeg.toFixed(2)} unit="°" />
          </div>
          <Tag tone="info">{plan.method}</Tag>
          <div className="formula-box" style={{ marginTop: 10 }}>{plan.derivation.join('\n')}</div>
        </>
      )}
    </div>
  );
}

// ============ 工艺参数单 ============
function ProcessTab() {
  const { workpieces, machines, detectors, processes } = useStore();
  const standard = useActiveStandard();
  const [editing, setEditing] = useState<ProcessParams | null>(null);

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn small" onClick={() => workpieces[0] && setEditing(newProcess(workpieces[0], machines[0], detectors[0]))}>＋ 新建工艺参数</button>
        <span className="pill">Ug 限值标准：{standard.name}</span>
      </div>
      <div className="card">
        <table>
          <thead><tr><th>工艺名称</th><th>炉号</th><th>kV/mA/min</th><th>透照厚度</th><th>焦距/方式</th><th>Ug/限值</th><th>版本</th><th></th></tr></thead>
          <tbody>
            {processes.map((p) => {
              const m = machines.find((x) => x.id === p.machineId);
              const ug = m ? m.focalSpot * (p.layout.objectToDetector / p.layout.sourceToObject) : 0;
              const limit = ugLimit(standard, p.thickness);
              return (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{workpieces.find((w) => w.id === p.workpieceId)?.heatNo}</td>
                  <td className="mono">{p.kv}/{p.ma}/{p.exposureTime}</td>
                  <td>{p.thickness} mm</td>
                  <td>{p.layout.focalDistance}mm · {p.layout.sourceSide === 'outside' ? '外透' : '内透'}</td>
                  <td>{ug < limit ? <Tag tone="ok">{ug.toFixed(2)}≤{limit}</Tag> : <Tag tone="danger">{ug.toFixed(2)}&gt;{limit} 超标</Tag>}</td>
                  <td>v{p.history.length + 1}</td>
                  <td><button className="btn ghost small" onClick={() => setEditing(p)}>编辑</button></td>
                </tr>
              );
            })}
            {processes.length === 0 && <tr><td colSpan={8} className="muted">还没有工艺单，点上方“新建工艺参数”。</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && <ProcessEditor proc={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function newProcess(wp: import('@/types').Workpiece, m: XRayMachine | undefined, d: Detector | undefined): ProcessParams {
  return {
    id: uid('proc'), name: `${wp.heatNo}-环缝工艺`, workpieceId: wp.id, machineId: m?.id ?? '', detectorId: d?.id ?? '',
    seamType: 'circumferential', thickness: wp.tMax, kv: 200, ma: m?.maMax ?? 5, exposureTime: 2,
    material: wp.material, doubleWall: false,
    layout: { focalDistance: 700, sourceToObject: 600, objectToDetector: 100, sourceSide: 'outside', offsetAngle: 0,
      sourcePos: { x: 0, y: 0, z: 0 }, detectorPos: { x: 0, y: 0, z: 700 } },
    createdAt: Date.now(), updatedAt: Date.now(), history: [],
  };
}

function ProcessEditor({ proc, onClose }: { proc: ProcessParams; onClose: () => void }) {
  const { workpieces, machines, detectors, processes } = useStore();
  const standard = useActiveStandard();
  const [form, setForm] = useState<ProcessParams>(proc);
  const set = (patch: Partial<ProcessParams>) => setForm((f) => ({ ...f, ...patch }));
  const machine = machines.find((m) => m.id === form.machineId);
  const l2 = form.layout.focalDistance - form.layout.sourceToObject;
  const ug = machine ? machine.focalSpot * (l2 / form.layout.sourceToObject) : 0;
  const limit = ugLimit(standard, form.thickness);
  const ugOk = ug <= limit;

  const save = () => {
    if (!ugOk) {
      if (!confirm('几何不清晰度超过标准限值，规范不允许保存该布置。仍要强制保存吗？')) return;
    }
    const snapshot = { at: Date.now(), kv: form.kv, ma: form.ma, exposureTime: form.exposureTime, thickness: form.thickness, layout: form.layout, note: '参数修改留痕' };
    const toSave: ProcessParams = { ...form, layout: { ...form.layout, objectToDetector: l2 }, updatedAt: Date.now(), history: proc.id === form.id && processes.some((p) => p.id === proc.id) ? [...proc.history, snapshot] : [] };
    store.set('processes', (l) => {
      const i = l.findIndex((x) => x.id === toSave.id);
      return i < 0 ? [...l, toSave] : l.map((x) => (x.id === toSave.id ? toSave : x));
    });
    onClose();
  };

  return (
    <Modal title="工艺参数单（修改自动留痕，旧版本不覆盖）" onClose={onClose} wide>
      <div className="grid grid-4">
        <label className="field">工艺名称<input value={form.name} onChange={(e) => set({ name: e.target.value })} /></label>
        <label className="field">工件
          <select value={form.workpieceId} onChange={(e) => {
            const wp = workpieces.find((w) => w.id === e.target.value)!;
            set({ workpieceId: wp.id, thickness: wp.tMax, material: wp.material });
          }}>{workpieces.map((w) => <option key={w.id} value={w.id}>{w.heatNo}</option>)}</select>
        </label>
        <label className="field">射线机
          <select value={form.machineId} onChange={(e) => set({ machineId: e.target.value })}>{machines.map((m) => <option key={m.id} value={m.id}>{m.model}</option>)}</select>
        </label>
        <label className="field">探测器
          <select value={form.detectorId} onChange={(e) => set({ detectorId: e.target.value })}>{detectors.map((d) => <option key={d.id} value={d.id}>{d.model}</option>)}</select>
        </label>
        <label className="field">管电压 kV<input type="number" value={form.kv} onChange={(e) => set({ kv: +e.target.value })} /></label>
        <label className="field">管电流 mA<input type="number" value={form.ma} onChange={(e) => set({ ma: +e.target.value })} /></label>
        <label className="field">曝光时间 min<input type="number" step="0.1" value={form.exposureTime} onChange={(e) => set({ exposureTime: +e.target.value })} /></label>
        <label className="field">透照厚度 mm（默认最厚处）<input type="number" value={form.thickness} onChange={(e) => set({ thickness: +e.target.value })} /></label>
        <label className="field">焦距 F mm<input type="number" value={form.layout.focalDistance} onChange={(e) => set({ layout: { ...form.layout, focalDistance: +e.target.value } })} /></label>
        <label className="field">源到工件 L1 mm<input type="number" value={form.layout.sourceToObject} onChange={(e) => set({ layout: { ...form.layout, sourceToObject: +e.target.value } })} /></label>
        <label className="field">透照方式
          <select value={form.layout.sourceSide} onChange={(e) => set({ layout: { ...form.layout, sourceSide: e.target.value as 'outside' | 'inside' } })}>
            <option value="outside">源在外</option><option value="inside">源在内</option>
          </select>
        </label>
        <label className="field">焊缝
          <select value={form.seamType} onChange={(e) => set({ seamType: e.target.value as ProcessParams['seamType'] })}>
            <option value="circumferential">环缝</option><option value="longitudinal">纵缝</option>
          </select>
        </label>
      </div>

      <div className="grid grid-4" style={{ margin: '14px 0' }}>
        <Metric k="L2=F−L1" v={l2.toFixed(1)} unit="mm" />
        <Metric k="放大倍数 M=F/L1" v={(form.layout.focalDistance / form.layout.sourceToObject).toFixed(3)} />
        <Metric k="几何不清晰度 Ug=d·L2/L1" v={ug.toFixed(3)} unit="mm" tone={ugOk ? 'good' : 'bad'} />
        <Metric k={`标准限值（T=${form.thickness}）`} v={limit} unit="mm" tone={ugOk ? 'good' : 'bad'} />
      </div>
      {!ugOk && <p className="bad">⚠ Ug 超过 {standard.standardCode} 限值 {limit}mm，该摆法不能保存（强制保存也会被标记为不合规）。</p>}

      {form.history.length > 0 && (
        <details>
          <summary className="muted">历史版本留痕（{form.history.length} 条，只读不可覆盖）</summary>
          <table><thead><tr><th>时间</th><th>kV/mA/min</th><th>厚度</th><th>焦距/L1</th></tr></thead>
            <tbody>{form.history.map((h, i) => (
              <tr key={i}><td>{new Date(h.at).toLocaleString()}</td><td className="mono">{h.kv}/{h.ma}/{h.exposureTime}</td><td>{h.thickness}</td><td>{h.layout.focalDistance}/{h.layout.sourceToObject}</td></tr>
            ))}</tbody></table>
        </details>
      )}

      <div className="row" style={{ marginTop: 16 }}><div className="spacer" />
        <button className="btn ghost" onClick={onClose}>取消</button>
        <button className="btn" onClick={save}>保存工艺（留痕）</button>
      </div>
    </Modal>
  );
}
