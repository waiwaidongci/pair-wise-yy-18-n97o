export interface Interval {
  id: string;
  from: number;
  to: number;
  lithology: string;
  color: string;
  structure: string;
  alteration: string;
  mineralization: string;
  description: string;
  photoUrl: string;
  /** 最近一次本地编辑的毫秒时间戳，合并导入时用于判定该段是否被改动过 */
  updatedAt?: number;
}

export interface Correlation {
  id: string;
  intervalId: string;
  targetHoleId: string;
  targetIntervalId: string;
  color: string;
  /** 区间合并/拆分后重算：接不上的地层线标记为 invalid，保留不删除 */
  status?: 'active' | 'invalid';
  invalidReason?: string;
}

/** 一段区间的编录内容快照（不含 id 与时间戳） */
export interface IntervalSnapshot {
  from: number;
  to: number;
  lithology: string;
  color: string;
  structure: string;
  alteration: string;
  mineralization: string;
  description: string;
  photoUrl: string;
}

/** 野外平板离线导出的数据包 */
export interface FieldPayload {
  schema: 'core-column/field-v1';
  holeId: string;
  /** 平板导出时刻的毫秒时间戳，是判定“本地是否在导出后又改过”的基准 */
  exportedAt: number;
  device?: string;
  intervals: IntervalSnapshot[];
}

/** 同一深度段两侧都改过时生成的待处理冲突，两个版本都保留 */
export interface MergeConflict {
  id: string;
  holeId: string;
  from: number;
  to: number;
  local: IntervalSnapshot;
  incoming: IntervalSnapshot;
  reason: string;
}

export interface MergeReport {
  holeId: string;
  holeName: string;
  mergedAt: number;
  /** 直接叠加导入内容的段数 */
  appliedCount: number;
  /** 内容一致、无需改动的段数 */
  identicalCount: number;
  /** 因导入边界不对齐而被切开的现存区间数 */
  splitCount: number;
  /** 本次合并后新失效的地层线数 */
  invalidatedCount: number;
  conflicts: MergeConflict[];
}

export interface DrillHole {
  id: string;
  name: string;
  project: string;
  coordinates: string;
  collarElevation: number;
  totalDepth: number;
  intervals: Interval[];
  correlations: Correlation[];
}

export interface LithologyOption {
  name: string;
  color: string;
}

export interface DepthWindow {
  top: number;
  bottom: number;
  zoom: number;
}

