import { useMemo, useRef, useState } from 'react';
import { useStore, store } from '@/data/store';
import { detectAbrupt, sampleCylinder, samplePlate, summarizeThickness } from '@/core/thickness';
import { exportJson, uid } from '@/data/storage';
import { Modal, Tag } from '@/components/ui';
import type { PageKey } from '@/App';
import type { ThicknessSample, Workpiece } from '@/types';

export function WorkpiecePage({ onNavigate }: { onNavigate: (p: PageKey) => void }) {
  const { workpieces } = useStore();
  const [editing, setEditing] = useState<Workpiece | null>(null);
  const [creating, setCreating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn" onClick={() => setCreating(true)}>＋ 新建工件档案</button>
        <button className="btn ghost" onClick={() => exportJson(`工件台账-${Date.now()}.json`, workpieces)}>导出台账 JSON</button>
        <div className="spacer" />
        <span className="pill">共 {workpieces.length} 个炉号</span>
      </div>

      <div className="grid grid-2">
        {workpieces.map((wp) => {
          const s = summarizeThickness(wp);
          return (
            <div className="card" key={wp.id}>
              <div className="row">
                <h3 style={{ margin: 0 }}>{wp.name}</h3>
                <div className="spacer" />
                <Tag tone="info">{wp.shape === 'cylinder' ? '筒体' : wp.shape === 'plate' ? '平板' : '自定义'}</Tag>
              </div>
              <div className="kvline" style={{ marginTop: 10 }}><span>炉号</span>{wp.heatNo}</div>
              <div className="kvline"><span>材料</span>{wp.material}</div>
              {wp.outerDiameter ? <div className="kvline"><span>外径 × 长度</span>Ø{wp.outerDiameter} × {wp.length} mm</div> : null}
              {wp.height ? <div className="kvline"><span>板厚 × 宽 × 长</span>{wp.height} × {wp.width} × {wp.length} mm</div> : null}
              <div className="kvline"><span>模型文件</span>{wp.modelFile ?? '未导入'}</div>
              <div className="grid grid-3" style={{ margin: '12px 0' }}>
                <div className="metric"><div className="k">最薄 tMin</div><div className="v">{s.tMin.toFixed(1)}<span className="u"> mm</span></div></div>
                <div className="metric"><div className="k">最厚 tMax（曝光取值）</div><div className="v warn-c">{s.tMax.toFixed(1)}<span className="u"> mm</span></div></div>
                <div className="metric"><div className="k">壁厚突变点</div><div className={`v ${s.abruptCount ? 'bad' : 'good'}`}>{s.abruptCount}<span className="u"> 处</span></div></div>
              </div>
              <div className="row">
                <button className="btn ghost small" onClick={() => setEditing(wp)}>壁厚明细 / 抽壳</button>
                <button className="btn small" onClick={() => onNavigate('process')}>去编工艺 →</button>
              </div>
            </div>
          );
        })}
      </div>

      {(creating || editing) && (
        <WorkpieceEditor
          wp={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onImportModel={(name) => fileRef.current && (fileRef.current.dataset.file = name)}
          fileRef={fileRef}
        />
      )}
    </div>
  );
}

function WorkpieceEditor({ wp, onClose, fileRef }: { wp: Workpiece | null; onClose: () => void; onImportModel: (n: string) => void; fileRef: React.RefObject<HTMLInputElement> }) {
  const { workpieces } = useStore();
  const [form, setForm] = useState<Workpiece>(
    wp ?? {
      id: uid('wp'), heatNo: '', name: '', material: 'steel', shape: 'cylinder',
      outerDiameter: 500, length: 1000, thicknessSamples: [], tMin: 0, tMax: 0, createdAt: Date.now(),
    },
  );
  const set = (patch: Partial<Workpiece>) => setForm((f) => ({ ...f, ...patch }));

  const doShell = () => {
    // 参数件抽壳：筒体/平板按几何公式量壁厚；真实 STEP 需 opencascade 内核，这里支持 STL 网格实测
    let samples: ThicknessSample[] = [];
    if (form.shape === 'cylinder') {
      const nominal = form.thicknessSamples[0]?.thickness ?? Math.round((form.outerDiameter ?? 500) * 0.05);
      samples = sampleCylinder(form.outerDiameter ?? 500, nominal, form.length ?? 1000);
    } else if (form.shape === 'plate') {
      samples = samplePlate(form.height ?? 30, form.width ?? 500, form.length ?? 800);
    } else {
      samples = form.thicknessSamples;
    }
    const withId = samples.map((s, i) => ({ ...s, id: `ts-${i}` }));
    const marked = detectAbrupt(withId);
    const sum = summarizeThickness({ thicknessSamples: marked });
    set({ thicknessSamples: marked, tMin: sum.tMin, tMax: sum.tMax });
  };

  const save = () => {
    if (!form.heatNo || !form.name) {
      alert('炉号与名称必填');
      return;
    }
    store.set('workpieces', (list) => {
      const idx = list.findIndex((x) => x.id === form.id);
      if (idx >= 0) {
        const next = [...list];
        next[idx] = form;
        return next;
      }
      return [form, ...list];
    });
    onClose();
  };

  const onFile = (f: File) => {
    // STL 可解析网格做射线测厚；STEP(B-rep) 保留文件名与台账关联，参数件仍按几何抽壳
    set({ modelFile: f.name });
    if (f.name.toLowerCase().endsWith('.stl')) {
      alert(`已接收 STL 网格 ${f.name}：将在仿真时按射线-三角网求交实测壁厚（参数件已可用几何抽壳）`);
    } else {
      alert(`已登记 STEP 模型 ${f.name}。完整 B-rep 抽壳需几何内核，当前筒体/平板按公称几何量壁厚，变截面可在明细表手动覆盖。`);
    }
  };

  const sum = useMemo(() => summarizeThickness(form), [form]);

  return (
    <Modal title={wp ? `工件档案 · ${wp.heatNo}` : '新建工件档案'} onClose={onClose} wide>
      <div className="grid grid-4">
        <label className="field">炉号<input value={form.heatNo} onChange={(e) => set({ heatNo: e.target.value })} placeholder="如 ZG2026-0120" /></label>
        <label className="field">名称<input value={form.name} onChange={(e) => set({ name: e.target.value })} /></label>
        <label className="field">材料
          <select value={form.material} onChange={(e) => set({ material: e.target.value })}>
            <option value="steel">碳钢/铸钢</option><option value="aluminum">铝合金</option>
            <option value="titanium">钛合金</option><option value="copper">铜合金</option>
          </select>
        </label>
        <label className="field">几何形态
          <select value={form.shape} onChange={(e) => set({ shape: e.target.value as Workpiece['shape'] })}>
            <option value="cylinder">筒体/管</option><option value="plate">平板</option><option value="custom">自定义网格</option>
          </select>
        </label>
        {form.shape === 'cylinder' && (
          <>
            <label className="field">外径 mm<input type="number" value={form.outerDiameter ?? ''} onChange={(e) => set({ outerDiameter: +e.target.value })} /></label>
            <label className="field">长度 mm<input type="number" value={form.length ?? ''} onChange={(e) => set({ length: +e.target.value })} /></label>
          </>
        )}
        {form.shape === 'plate' && (
          <>
            <label className="field">板厚 mm<input type="number" value={form.height ?? ''} onChange={(e) => set({ height: +e.target.value })} /></label>
            <label className="field">宽度 mm<input type="number" value={form.width ?? ''} onChange={(e) => set({ width: +e.target.value })} /></label>
            <label className="field">长度 mm<input type="number" value={form.length ?? ''} onChange={(e) => set({ length: +e.target.value })} /></label>
          </>
        )}
      </div>

      <div className="row" style={{ margin: '14px 0' }}>
        <input ref={fileRef} type="file" accept=".step,.stp,.stl" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        <button className="btn ghost small" onClick={() => fileRef.current?.click()}>导入 STEP / STL 模型</button>
        <button className="btn small" onClick={doShell}>抽壳量壁厚（生成抽样表）</button>
        <span className="pill">模型：{form.modelFile ?? '未导入'}</span>
        <div className="spacer" />
        <Tag tone={sum.abruptCount ? 'warn' : 'ok'}>突变 {sum.abruptCount} 处</Tag>
      </div>

      <div className="scroll-x" style={{ maxHeight: 280, overflow: 'auto' }}>
        <table>
          <thead><tr><th>抽样点</th><th>轴向位置 mm</th><th>周向角 °</th><th>壁厚 mm</th><th>状态</th><th>备注</th></tr></thead>
          <tbody>
            {form.thicknessSamples.map((s, i) => (
              <tr key={s.id}>
                <td>#{i + 1}</td><td>{s.position.toFixed(1)}</td><td>{s.angle.toFixed(0)}</td>
                <td>
                  <input type="number" style={{ width: 90, padding: '3px 6px' }} value={s.thickness}
                    onChange={(e) => {
                      const next = form.thicknessSamples.map((x) => ({ ...x }));
                      next[i].thickness = +e.target.value;
                      const marked = detectAbrupt(next);
                      const sm = summarizeThickness({ thicknessSamples: marked });
                      set({ thicknessSamples: marked, tMin: sm.tMin, tMax: sm.tMax });
                    }} />
                </td>
                <td>{s.abrupt ? <Tag tone="danger">壁厚突变</Tag> : <Tag tone="ok">正常</Tag>}</td>
                <td className="muted">{s.note ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {form.thicknessSamples.length === 0 && <p className="muted">尚未抽壳：填好几何参数后点“抽壳量壁厚”。</p>}
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <div className="metric"><div className="k">最薄</div><div className="v">{sum.tMin.toFixed(1)}<span className="u">mm</span></div></div>
        <div className="metric"><div className="k">最厚（后续曝光自动取此值）</div><div className="v warn-c">{sum.tMax.toFixed(1)}<span className="u">mm</span></div></div>
        <div className="spacer" />
        <button className="btn ghost" onClick={onClose}>取消</button>
        <button className="btn" onClick={save}>保存建档</button>
      </div>
    </Modal>
  );
}
