import { useState } from 'react';
import { StoreContext, store } from './data/store';
import { WorkpiecePage } from './pages/WorkpiecePage';
import { ProcessPage } from './pages/ProcessPage';
import { LayoutPage } from './pages/LayoutPage';
import { SimulationPage } from './pages/SimulationPage';
import { OptimizePage } from './pages/OptimizePage';
import { ReportPage } from './pages/ReportPage';

export type PageKey = 'workpiece' | 'process' | 'layout' | 'simulation' | 'optimize' | 'report';

const NAV: { key: PageKey; label: string; icon: string; desc: string }[] = [
  { key: 'workpiece', label: '工件台账', icon: '📋', desc: '炉号建档·抽壳量壁厚' },
  { key: 'process', label: '工艺参数', icon: '⚙️', desc: '设备卡·衰减库·透照次数' },
  { key: 'layout', label: '透照布置', icon: '📐', desc: '三维拖拽·Ug 校验' },
  { key: 'simulation', label: '成像仿真', icon: '🩻', desc: 'DR 成像·黑度测量·校正' },
  { key: 'optimize', label: '工艺寻优', icon: '📈', desc: '参数扫描·方案对比' },
  { key: 'report', label: '检测报告', icon: '📄', desc: '自动编号·版本留痕·审核' },
];

export function App() {
  const [page, setPage] = useState<PageKey>('workpiece');
  const current = NAV.find((n) => n.key === page)!;
  return (
    <StoreContext.Provider value={store}>
      <div className="app">
        <nav className="sidebar">
          <h1>射线检测成像仿真<br />与工艺校验系统</h1>
          {NAV.map((n) => (
            <button key={n.key} className={`nav-item ${page === n.key ? 'active' : ''}`} onClick={() => setPage(n.key)}>
              <span className="nav-icon">{n.icon}</span>
              {n.label}
            </button>
          ))}
          <div className="foot">
            标准依据：NB/T 47013.2<br />
            公式引擎 26 项手算对账测试<br />
            数据本地留底，可导出归档
          </div>
        </nav>
        <main className="main">
          <div className="page-head">
            <h2>
              {current.icon} {current.label}
            </h2>
            <p>{current.desc}</p>
          </div>
          {page === 'workpiece' && <WorkpiecePage onNavigate={setPage} />}
          {page === 'process' && <ProcessPage />}
          {page === 'layout' && <LayoutPage />}
          {page === 'simulation' && <SimulationPage />}
          {page === 'optimize' && <OptimizePage />}
          {page === 'report' && <ReportPage />}
        </main>
      </div>
    </StoreContext.Provider>
  );
}
