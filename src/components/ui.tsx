import type { ReactNode } from 'react';

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={wide ? { width: 'min(1040px,95vw)' } : undefined} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <div className="spacer" />
          <button className="btn ghost small" onClick={onClose}>关闭</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Tag({ tone, children }: { tone: 'ok' | 'warn' | 'danger' | 'info'; children: ReactNode }) {
  return <span className={`tag ${tone}`}>{children}</span>;
}

export function Metric({ k, v, unit, tone }: { k: string; v: string | number; unit?: string; tone?: string }) {
  return (
    <div className="metric">
      <div className="k">{k}</div>
      <div className={`v ${tone ?? ''}`}>
        {v} {unit && <span className="u">{unit}</span>}
      </div>
    </div>
  );
}

export function KvLine({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="kvline">
      <span>{k}</span>
      <span className="mono">{children}</span>
    </div>
  );
}
