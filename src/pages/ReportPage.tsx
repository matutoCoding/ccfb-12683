import { useMemo, useState } from 'react';
import { useStore, store } from '@/data/store';
import { Tag, Modal, KvLine } from '@/components/ui';
import { uid } from '@/data/storage';
import type { InspectionReport, ProcessSnapshot, ReportStatus } from '@/types';

const STATUS_LABEL: Record<ReportStatus, { text: string; tone: 'info' | 'warn' | 'ok' | 'danger' }> = {
  draft: { text: '草稿', tone: 'info' },
  submitted: { text: '待审核', tone: 'warn' },
  approved: { text: '已审核通过', tone: 'ok' },
  rejected: { text: '审核驳回', tone: 'danger' },
};

export function ReportPage() {
  const { reports, processes, workpieces } = useStore();
  const [editing, setEditing] = useState<InspectionReport | null>(null);
  const [part, setPart] = useState('环缝W1');

  // 报告号 = 炉号-部位-序号，同炉同部位序号自增
  const nextNo = useMemo(() => {
    const wp = workpieces[0];
    if (!wp) return '';
    const seq = reports.filter((r) => r.heatNo === wp.heatNo && r.part === part).length + 1;
    return `${wp.heatNo}-${part}-${String(seq).padStart(2, '0')}`;
  }, [reports, workpieces, part]);

  const create = () => {
    const proc = processes[0];
    const wp = workpieces[0];
    if (!proc || !wp) {
      alert('请先建立工件与工艺参数');
      return;
    }
    const snapshot: ProcessSnapshot = {
      at: Date.now(), kv: proc.kv, ma: proc.ma, exposureTime: proc.exposureTime,
      thickness: proc.thickness, layout: proc.layout, note: '报告生成时工艺快照',
    };
    const report: InspectionReport = {
      id: uid('rpt'), reportNo: nextNo, heatNo: wp.heatNo, part, processId: proc.id,
      status: 'draft', processSnapshot: snapshot,
      densityReadings: [
        { pos: [0.5, 0.5], density: 2.6, zone: 'weld' },
        { pos: [0.2, 0.5], density: 2.1, zone: 'base' },
        { pos: [0.8, 0.5], density: 2.2, zone: 'base' },
      ],
      createdAt: Date.now(), updatedAt: Date.now(),
      versions: [{ version: 1, at: Date.now(), editor: '工艺员', changeNote: '初版生成', snapshot: {} }],
    };
    store.set('reports', (l) => [report, ...l]);
    setEditing(report);
  };

  return (
    <div>
      <div className="card">
        <div className="row">
          <label className="field" style={{ minWidth: 200 }}>检测部位
            <select value={part} onChange={(e) => setPart(e.target.value)}>
              <option>环缝W1</option><option>环缝W2</option><option>纵缝Z1</option><option>法兰角缝</option>
            </select>
          </label>
          <div className="metric"><div className="k">自动报告号</div><div className="v" style={{ fontSize: 16 }}>{nextNo || '—'}</div></div>
          <div className="spacer" />
          <button className="btn" onClick={create}>生成检测报告</button>
        </div>
      </div>

      <div className="card">
        <table>
          <thead><tr><th>报告号</th><th>炉号</th><th>部位</th><th>状态</th><th>版本</th><th>更新时间</th><th>审核意见</th><th></th></tr></thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.reportNo}</td><td>{r.heatNo}</td><td>{r.part}</td>
                <td><Tag tone={STATUS_LABEL[r.status].tone}>{STATUS_LABEL[r.status].text}</Tag></td>
                <td>v{r.versions.length}</td>
                <td>{new Date(r.updatedAt).toLocaleString()}</td>
                <td className="muted">{r.review?.comment ?? '—'}</td>
                <td><button className="btn ghost small" onClick={() => setEditing(r)}>打开</button></td>
              </tr>
            ))}
            {reports.length === 0 && <tr><td colSpan={8} className="muted">暂无报告。</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && <ReportEditor report={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ReportEditor({ report, onClose }: { report: InspectionReport; onClose: () => void }) {
  const { processes } = useStore();
  const [r, setR] = useState<InspectionReport>(report);
  const [comment, setComment] = useState('');
  const proc = processes.find((p) => p.id === r.processId);

  // 修改参数 → 新增版本，旧版本保留不覆盖
  const revise = (patch: Partial<ProcessSnapshot>) => {
    const snap: ProcessSnapshot = { ...r.processSnapshot, ...patch, at: Date.now(), note: '报告修订' };
    const next: InspectionReport = {
      ...r,
      processSnapshot: snap,
      status: 'draft',
      review: undefined,
      updatedAt: Date.now(),
      versions: [...r.versions, { version: r.versions.length + 1, at: Date.now(), editor: '工艺员', changeNote: `修改 ${Object.keys(patch).join(',')}`, snapshot: snap }],
    };
    setR(next);
    store.set('reports', (l) => l.map((x) => (x.id === r.id ? next : x)));
  };

  const submit = () => {
    const next = { ...r, status: 'submitted' as ReportStatus, updatedAt: Date.now() };
    setR(next);
    store.set('reports', (l) => l.map((x) => (x.id === r.id ? next : x)));
  };
  const review = (action: 'approve' | 'reject') => {
    if (action === 'reject' && !comment.trim()) {
      alert('驳回必须填写驳回意见');
      return;
    }
    const next: InspectionReport = {
      ...r,
      status: action === 'approve' ? 'approved' : 'rejected',
      review: { reviewer: '审核人', at: Date.now(), comment: comment || '同意', action },
      updatedAt: Date.now(),
    };
    setR(next);
    store.set('reports', (l) => l.map((x) => (x.id === r.id ? next : x)));
  };

  return (
    <Modal title={`检测报告 ${r.reportNo}`} onClose={onClose} wide>
      <div className="row" style={{ marginBottom: 14 }}>
        <Tag tone={STATUS_LABEL[r.status].tone}>{STATUS_LABEL[r.status].text}</Tag>
        <span className="pill">版本 v{r.versions.length}（旧版本只读留痕）</span>
        <div className="spacer" />
        {r.status === 'draft' && <button className="btn small" onClick={submit}>提交审核</button>}
        {r.status === 'submitted' && (
          <div className="row">
            <input placeholder="审核意见（驳回必填）" value={comment} onChange={(e) => setComment(e.target.value)} style={{ minWidth: 240 }} />
            <button className="btn small" onClick={() => review('approve')}>审核通过</button>
            <button className="btn danger small" onClick={() => review('reject')}>驳回退回</button>
          </div>
        )}
        {r.status === 'rejected' && <Tag tone="danger">已退回：{r.review?.comment}，请修订后重新提交</Tag>}
      </div>

      <div className="grid grid-2">
        <div className="card" style={{ margin: 0 }}>
          <h3>工艺参数（报告快照）</h3>
          <KvLine k="关联工艺单">{proc?.name ?? r.processId}</KvLine>
          <KvLine k="管电压 / 电流 / 时间">{`${r.processSnapshot.kv}kV / ${r.processSnapshot.ma}mA / ${r.processSnapshot.exposureTime}min`}</KvLine>
          <KvLine k="透照厚度">{r.processSnapshot.thickness} mm</KvLine>
          <KvLine k="焦距 / L1 / L2">{`${r.processSnapshot.layout.focalDistance} / ${r.processSnapshot.layout.sourceToObject} / ${r.processSnapshot.layout.objectToDetector} mm`}</KvLine>
          <KvLine k="透照方式">{r.processSnapshot.layout.sourceSide === 'outside' ? '源在外' : '源在内'}</KvLine>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn ghost small" disabled={r.status === 'submitted'} onClick={() => revise({ kv: r.processSnapshot.kv + 10 })}>模拟修订：kV+10（生成新版本）</button>
            <button className="btn ghost small" disabled={r.status === 'submitted'} onClick={() => revise({ exposureTime: +(r.processSnapshot.exposureTime + 0.5).toFixed(1) })}>曝光时间+0.5min</button>
          </div>
        </div>

        <div className="card" style={{ margin: 0 }}>
          <h3>黑度测量记录</h3>
          <table>
            <thead><tr><th>测点</th><th>区域</th><th>坐标</th><th>光学密度 D</th></tr></thead>
            <tbody>
              {r.densityReadings.map((d, i) => (
                <tr key={i}>
                  <td>#{i + 1}</td>
                  <td>{d.zone === 'weld' ? <Tag tone="info">焊缝区</Tag> : <Tag tone="ok">母材区</Tag>}</td>
                  <td className="mono">({d.pos[0].toFixed(2)},{d.pos[1].toFixed(2)})</td>
                  <td className="mono">{d.density.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>透照布置截图与仿真黑度图在「成像仿真」页生成后随报告归档；报告号与炉号、部位绑定，不可手工篡改。</p>
        </div>
      </div>

      <details className="card" style={{ marginTop: 14 }}>
        <summary>版本留痕链（{r.versions.length} 个版本，全程不可覆盖）</summary>
        <table style={{ marginTop: 10 }}>
          <thead><tr><th>版本</th><th>时间</th><th>编辑人</th><th>变更说明</th></tr></thead>
          <tbody>
            {r.versions.map((v) => (
              <tr key={v.version}><td>v{v.version}</td><td>{new Date(v.at).toLocaleString()}</td><td>{v.editor}</td><td>{v.changeNote}</td></tr>
            ))}
          </tbody>
        </table>
        {r.review && (
          <div className="formula-box" style={{ marginTop: 10 }}>
            审核记录：{r.review.action === 'approve' ? '通过' : '驳回'}｜{r.review.reviewer}｜{new Date(r.review.at).toLocaleString()}｜意见：{r.review.comment}
          </div>
        )}
      </details>
    </Modal>
  );
}
