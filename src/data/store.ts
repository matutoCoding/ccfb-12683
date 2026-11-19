import { createContext, useContext, useSyncExternalStore } from 'react';
import type {
  AttenuationTable,
  Detector,
  InspectionReport,
  ProcessParams,
  StandardLimits,
  Workpiece,
  XRayMachine,
} from '@/types';
import { loadTable, saveTable, uid } from './storage';
import {
  seedAttenuation,
  seedDetectors,
  seedMachines,
  seedStandards,
  seedWorkpieces,
} from './seed';

interface AppState {
  workpieces: Workpiece[];
  machines: XRayMachine[];
  detectors: Detector[];
  attenuation: AttenuationTable[];
  standards: StandardLimits[];
  processes: ProcessParams[];
  reports: InspectionReport[];
  activeStandardId: string;
}

const KEYS: Record<keyof AppState, string> = {
  workpieces: 'workpieces',
  machines: 'machines',
  detectors: 'detectors',
  attenuation: 'attenuation',
  standards: 'standards',
  processes: 'processes',
  reports: 'reports',
  activeStandardId: 'activeStandardId',
};

function initialState(): AppState {
  const base: AppState = {
    workpieces: loadTable(KEYS.workpieces, seedWorkpieces()),
    machines: loadTable(KEYS.machines, seedMachines()),
    detectors: loadTable(KEYS.detectors, seedDetectors()),
    attenuation: loadTable(KEYS.attenuation, seedAttenuation()),
    standards: loadTable(KEYS.standards, seedStandards()),
    processes: loadTable(KEYS.processes, []),
    reports: loadTable(KEYS.reports, []),
    activeStandardId: loadTable(KEYS.activeStandardId, 'std-nb47013-ab'),
  };
  // 修复悬空外键：种子设备 ID 固定后，旧版本存下的工艺单可能指向已不存在的设备卡
  const machineIds = new Set(base.machines.map((m) => m.id));
  const detectorIds = new Set(base.detectors.map((d) => d.id));
  const wpIds = new Set(base.workpieces.map((w) => w.id));
  let repaired = false;
  for (const p of base.processes) {
    if (!machineIds.has(p.machineId) && base.machines[0]) { p.machineId = base.machines[0].id; repaired = true; }
    if (!detectorIds.has(p.detectorId) && base.detectors[0]) { p.detectorId = base.detectors[0].id; repaired = true; }
    if (!wpIds.has(p.workpieceId) && base.workpieces[0]) { p.workpieceId = base.workpieces[0].id; repaired = true; }
  }
  if (repaired) saveTable(KEYS.processes, base.processes);
  return base;
}

let state: AppState = initialState();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function persist<K extends keyof AppState>(key: K, value: AppState[K]) {
  saveTable(KEYS[key], value);
}

export const store = {
  getState: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  set<K extends keyof AppState>(key: K, updater: (cur: AppState[K]) => AppState[K]) {
    const next = updater(state[key]);
    state = { ...state, [key]: next };
    persist(key, next);
    emit();
  },
  uid,
};

export function useStore(): AppState {
  return useSyncExternalStore(store.subscribe, store.getState);
}

export const StoreContext = createContext<typeof store | null>(null);
export function useStoreActions() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('StoreContext missing');
  return ctx;
}

/** 当前生效标准 */
export function useActiveStandard(): StandardLimits {
  const s = useStore();
  return s.standards.find((x) => x.id === s.activeStandardId) ?? s.standards[0];
}
