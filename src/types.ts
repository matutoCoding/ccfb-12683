// 领域模型类型定义

export type ID = string;

/** 材料键名（内置库） */
export type MaterialKey = 'steel' | 'aluminum' | 'titanium' | 'copper';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// ============ 工件台账 ============

/** 壁厚抽样点（抽壳/量壁厚结果） */
export interface ThicknessSample {
  id: ID;
  /** 沿轴向位置 mm（筒体）或坐标 */
  position: number;
  /** 周向角度 度（筒体），平板为 0 */
  angle: number;
  thickness: number;
  /** 是否壁厚突变点（与相邻抽样差超阈值） */
  abrupt: boolean;
  note?: string;
}

export interface Workpiece {
  id: ID;
  /** 炉号（建档主键） */
  heatNo: string;
  name: string;
  material: MaterialKey | string;
  /** 几何形态 */
  shape: 'plate' | 'cylinder' | 'custom';
  /** 外径 mm（筒体） */
  outerDiameter?: number;
  /** 长度 mm */
  length?: number;
  width?: number;
  height?: number;
  /** 源 STEP/STL 文件名 */
  modelFile?: string;
  /** 壁厚抽样 */
  thicknessSamples: ThicknessSample[];
  tMin: number;
  tMax: number;
  createdAt: number;
  remark?: string;
}

// ============ 设备卡 ============

export interface XRayMachine {
  id: ID;
  model: string;
  /** 管电压范围 kV */
  kvMin: number;
  kvMax: number;
  /** 管电流范围 mA */
  maMin: number;
  maMax: number;
  /** 焦点尺寸 mm（等效焦点 d） */
  focalSpot: number;
  /** 可选双焦点 */
  focalSpotSmall?: number;
  /** 额定功率 W */
  power?: number;
  remark?: string;
}

export interface Detector {
  id: ID;
  model: string;
  /** 像元尺寸 mm */
  pixelSize: number;
  /** 像素列 × 行 */
  cols: number;
  rows: number;
  /** A/D 位深 */
  bitDepth: number;
  /** 坏像素坐标（行,列）列表，或导入坏像素图的文件名 */
  badPixels?: [number, number][];
  badPixelMap?: string;
  /** 固有不清晰度 mm（可空，按 2×像元估） */
  inherentUnsharpness?: number;
  remark?: string;
}

// ============ 衰减系数库 ============

/** 单材料在若干管电压下的线衰减系数表 */
export interface AttenuationTable {
  material: MaterialKey | string;
  materialName: string;
  /** 密度 g/cm³ */
  density: number;
  /** 数据点：管电压 kV（多色等效单能） → 线衰减系数 1/cm */
  points: { kv: number; mu: number }[];
  /** 数据来源说明（标准/手册/试块反推） */
  source: string;
  /** 试块反推记录 */
  calibration?: CalibrationRecord;
}

export interface CalibrationRecord {
  date: number;
  /** 两块试块厚度 mm */
  t1: number;
  t2: number;
  /** 实测光学密度（胶片）或归一化灰度（DR） */
  d1: number;
  d2: number;
  /** 反推用管电压 kV */
  kv: number;
  /** 散射比取值 */
  scatterRatio: number;
  mu: number;
  note?: string;
}

// ============ 透照布置与工艺 ============

export type SourceSide = 'outside' | 'inside';
export type SeamType = 'circumferential' | 'longitudinal';

export interface ExposureLayout {
  /** 焦距 F：源到探测器/胶片距离 mm */
  focalDistance: number;
  /** 源到工件表面距离 L1 */
  sourceToObject: number;
  /** 工件表面到探测器距离 L2（贴不紧的间隙） */
  objectToDetector: number;
  sourceSide: SourceSide;
  /** 双壁双影椭圆开口间距 mm（投影在探测器上） */
  ellipticalGap?: number;
  /** 偏透角 度 */
  offsetAngle: number;
  /** 源位置（3D 交互用） */
  sourcePos: Vec3;
  detectorPos: Vec3;
}

export interface ProcessParams {
  id: ID;
  name: string;
  workpieceId: ID;
  machineId: ID;
  detectorId: ID;
  seamType: SeamType;
  /** 透照厚度 T mm（默认取最厚处） */
  thickness: number;
  kv: number;
  ma: number;
  /** 曝光时间 min */
  exposureTime: number;
  layout: ExposureLayout;
  /** 材料键（取系数用） */
  material: string;
  /** 双壁双影标记 */
  doubleWall: boolean;
  /** 透照次数（环缝） */
  shotCount?: number;
  /** 有效评定长度 mm/次 */
  effectiveLength?: number;
  createdAt: number;
  updatedAt: number;
  /** 版本留痕 */
  history: ProcessSnapshot[];
}

export interface ProcessSnapshot {
  at: number;
  kv: number;
  ma: number;
  exposureTime: number;
  thickness: number;
  layout: ExposureLayout;
  note: string;
}

// ============ 成像仿真结果 ============

export interface SimulationResult {
  id: ID;
  processId: ID;
  at: number;
  /** 探测器上的灰度图（Float32，0..1 归一化入射剂量后） */
  width: number;
  height: number;
  /** 关键统计 */
  densityMin: number;
  densityMax: number;
  densityMean: number;
  snr: number;
  contrast: number;
  /** 几何不清晰度 mm */
  ug: number;
  /** 几何模糊（像素） */
  geometricBlurPx: number;
  /** 运动模糊（像素） */
  motionBlurPx: number;
  /** 依据留底：本次计算用到的全部中间量 */
  evidence: SimulationEvidence;
}

export interface SimulationEvidence {
  formula: string;
  kv: number;
  muPerCm: number;
  halfValueLayerMm: number;
  tenthValueLayerMm: number;
  scatterRatio: number;
  thicknessMm: number;
  focalSpot: number;
  focalDistance: number;
  l1: number;
  l2: number;
  ug: number;
  ugLimit: number;
  magnification: number;
  directIntensity: number;
  totalIntensity: number;
  characteristicCurve: string;
  standard: string;
}

// ============ 报告 ============

export type ReportStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export interface InspectionReport {
  id: ID;
  /** 报告号：炉号-部位-序号 */
  reportNo: string;
  heatNo: string;
  part: string;
  processId: ID;
  simulationId?: ID;
  status: ReportStatus;
  /** 工艺参数快照 */
  processSnapshot: ProcessSnapshot;
  /** 测量记录（黑度探头点） */
  densityReadings: { pos: [number, number]; density: number; zone: 'weld' | 'base' }[];
  layoutSnapshot?: string;
  createdAt: number;
  updatedAt: number;
  /** 版本链（旧版本不覆盖） */
  versions: ReportVersion[];
  review?: { reviewer: string; at: number; comment: string; action: 'approve' | 'reject' };
}

export interface ReportVersion {
  version: number;
  at: number;
  editor: string;
  changeNote: string;
  snapshot: unknown;
}

// ============ 标准限值 ============

export interface StandardLimits {
  id: ID;
  name: string;
  /** 几何不清晰度限值，按透照厚度 T mm 分档 */
  ugLimits: { tMax: number; ug: number }[];
  /** 黑度（光学密度）允许区间 */
  densityRange: { min: number; max: number };
  /** 焊缝区黑度区间（可同表） */
  weldDensityRange: { min: number; max: number };
  /** 横向裂纹检出角 K 值（厚度比） */
  kValue: number;
  /** 环缝最少透照次数表参数：一次透照长度对应的 θ 由 K 推 */
  standardCode: string;
}
