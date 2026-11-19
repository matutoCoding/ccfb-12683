// 本地持久化：localStorage 封装，带命名空间与版本留痕。
// 车间内网无后端也能单机留底；键名按实体分表，报告/工艺历史只追加不覆盖。

const NS = 'dr-sim/v1/';

export function loadTable<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(NS + key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch (e) {
    console.warn('读取本地数据失败', key, e);
    return fallback;
  }
}

export function saveTable<T>(key: string, value: T): void {
  try {
    localStorage.setItem(NS + key, JSON.stringify(value));
  } catch (e) {
    // 配额超限时提示（仿真图较大时可能触发）
    console.error('本地存储写入失败（可能超出配额）', key, e);
    throw new Error('本地存储写入失败：请导出留底后清理旧仿真图');
  }
}

export function uid(prefix = 'id'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 导出全量台账为 JSON 文件（给工艺员核对/归档） */
export function exportJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 导出衰减系数表为 CSV */
export function exportCsv(filename: string, header: string[], rows: (string | number)[][]): void {
  const lines = [header.join(','), ...rows.map((r) => r.join(','))];
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
