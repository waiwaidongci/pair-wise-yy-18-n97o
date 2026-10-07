import type {
  DrillHole,
  FieldPayload,
  Interval,
  IntervalSnapshot,
  MergeConflict,
  MergeReport,
} from '../types/geology';
import { LITHOLOGY_OPTIONS, createId, roundDepth, sortIntervals } from './geology';

const EPS = 0.001;

export type ParseResult = { ok: true; payload: FieldPayload } | { ok: false; error: string };
export type MergeResult =
  | { ok: true; holes: DrillHole[]; report: MergeReport }
  | { ok: false; error: string };

type ContentSource = Pick<
  Interval,
  'lithology' | 'color' | 'structure' | 'alteration' | 'mineralization' | 'description' | 'photoUrl'
>;

const CONTENT_KEYS = ['lithology', 'color', 'structure', 'alteration', 'mineralization', 'description'] as const;

export function snapshotOf(source: ContentSource, from: number, to: number): IntervalSnapshot {
  return {
    from,
    to,
    lithology: source.lithology,
    color: source.color,
    structure: source.structure,
    alteration: source.alteration,
    mineralization: source.mineralization,
    description: source.description,
    photoUrl: source.photoUrl,
  };
}

/** 内容是否一致：导入方没带照片时忽略照片字段，避免把已有照片误判成差异 */
function sameContent(local: Interval, incoming: IntervalSnapshot) {
  if (!CONTENT_KEYS.every((key) => local[key] === incoming[key])) return false;
  return !incoming.photoUrl || local.photoUrl === incoming.photoUrl;
}

export function parseFieldPayload(json: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: '文件不是有效的 JSON' };
  }
  const payload = raw as Partial<FieldPayload> | null;
  if (!payload || typeof payload !== 'object') return { ok: false, error: '导入包内容为空' };
  if (payload.schema !== 'core-column/field-v1') {
    return { ok: false, error: '导入包格式不受支持（需要 core-column/field-v1）' };
  }
  if (typeof payload.holeId !== 'string' || !payload.holeId) {
    return { ok: false, error: '导入包缺少钻孔编号' };
  }
  if (typeof payload.exportedAt !== 'number' || !Number.isFinite(payload.exportedAt)) {
    return { ok: false, error: '导入包缺少导出时间' };
  }
  if (!Array.isArray(payload.intervals) || payload.intervals.length === 0) {
    return { ok: false, error: '导入包不包含任何编录区间' };
  }
  for (let index = 0; index < payload.intervals.length; index += 1) {
    const item = payload.intervals[index];
    if (!item || typeof item.from !== 'number' || typeof item.to !== 'number' || !(item.from < item.to)) {
      return { ok: false, error: `第 ${index + 1} 个区间深度无效` };
    }
    if (typeof item.lithology !== 'string' || !item.lithology) {
      return { ok: false, error: `第 ${index + 1} 个区间缺少岩性` };
    }
  }
  return { ok: true, payload: payload as FieldPayload };
}

export interface SplitResult {
  intervals: Interval[];
  /** 原区间 id → 切分后的切片，用于地层线端点重映射 */
  idMap: Map<string, { original: Interval; pieces: Interval[] }>;
  splitCount: number;
}

/**
 * 按给定边界把现存区间切开。切片完整继承岩性、描述、照片等属性；
 * 第一段保留原 id，保证指向它的地层线尽量不断开。
 */
export function splitIntervalsAt(intervals: Interval[], boundaries: number[]): SplitResult {
  const cuts = [...new Set(boundaries)].sort((a, b) => a - b);
  const idMap: SplitResult['idMap'] = new Map();
  const result: Interval[] = [];
  let splitCount = 0;
  for (const interval of intervals) {
    const inner = cuts.filter((cut) => cut > interval.from + EPS && cut < interval.to - EPS);
    if (!inner.length) {
      result.push(interval);
      idMap.set(interval.id, { original: interval, pieces: [interval] });
      continue;
    }
    splitCount += 1;
    const points = [interval.from, ...inner, interval.to];
    const pieces = points.slice(0, -1).map((from, index) => ({
      ...interval,
      id: index === 0 ? interval.id : createId('int'),
      from,
      to: points[index + 1],
    }));
    result.push(...pieces);
    idMap.set(interval.id, { original: interval, pieces });
  }
  return { intervals: result, idMap, splitCount };
}

/** 按当前区间状态校验所有地层线：端点缺失或岩性不再对应的标成失效 */
export function refreshCorrelations(holes: DrillHole[]) {
  for (const hole of holes) {
    for (const correlation of hole.correlations) {
      const source = hole.intervals.find((item) => item.id === correlation.intervalId);
      const targetHole = holes.find((item) => item.id === correlation.targetHoleId);
      const target = targetHole?.intervals.find((item) => item.id === correlation.targetIntervalId);
      if (!source || !target) {
        correlation.status = 'invalid';
        correlation.invalidReason = '对应区间已不存在';
      } else if (source.lithology !== target.lithology) {
        correlation.status = 'invalid';
        correlation.invalidReason = '两侧岩性不再一致';
      } else {
        correlation.status = 'active';
        correlation.invalidReason = undefined;
      }
    }
  }
}

/** 合并后重算地层线：先把端点 id 映射到切分后的新区间，再做连通性校验 */
function recomputeCorrelations(
  holes: DrillHole[],
  mergedHoleId: string,
  idMap: SplitResult['idMap'],
) {
  const remap = (oldId: string): string | null => {
    const entry = idMap.get(oldId);
    if (!entry) return null;
    const mid = (entry.original.from + entry.original.to) / 2;
    const piece = entry.pieces.find((item) => mid >= item.from - EPS && mid <= item.to + EPS);
    return (piece ?? entry.pieces[0]).id;
  };
  for (const hole of holes) {
    for (const correlation of hole.correlations) {
      if (hole.id === mergedHoleId) {
        correlation.intervalId = remap(correlation.intervalId) ?? correlation.intervalId;
      }
      if (correlation.targetHoleId === mergedHoleId) {
        correlation.targetIntervalId = remap(correlation.targetIntervalId) ?? correlation.targetIntervalId;
      }
    }
  }
  refreshCorrelations(holes);
}

/**
 * 把野外平板导出的数据包合并进现有钻孔记录。
 * 纯函数：任何一步失败都直接返回错误，传入的 holes 不会被改动，可修正后重试。
 */
export function mergeFieldPayload(holes: DrillHole[], payload: FieldPayload): MergeResult {
  const hole = holes.find((item) => item.id === payload.holeId);
  if (!hole) {
    return { ok: false, error: `项目中不存在钻孔「${payload.holeId}」，请先建立该钻孔再导入` };
  }

  const incoming = [...payload.intervals].sort((a, b) => a.from - b.from || a.to - b.to);
  for (let index = 0; index < incoming.length; index += 1) {
    const item = incoming[index];
    if (item.from < -EPS || item.to > hole.totalDepth + EPS) {
      return {
        ok: false,
        error: `导入区间 ${item.from}–${item.to} m 超出 ${hole.name} 的孔深范围 0–${hole.totalDepth} m`,
      };
    }
    if (index > 0 && item.from < incoming[index - 1].to - EPS) {
      return {
        ok: false,
        error: `导入区间 ${item.from}–${item.to} m 与上一段 ${incoming[index - 1].from}–${incoming[index - 1].to} m 重叠`,
      };
    }
  }

  // 1) 按导入边界把现存区间切开，切片完整继承原有岩性、描述和照片
  const boundaries = incoming.flatMap((item) => [item.from, item.to]);
  const { intervals: splitList, idMap, splitCount } = splitIntervalsAt(sortIntervals(hole.intervals), boundaries);
  const merged = splitList.map((item) => ({ ...item }));

  // 2) 逐段叠加：内容一致跳过；本地在导出后未改过的直接应用；两边都改过的不覆盖，记入待处理冲突
  const conflicts: MergeConflict[] = [];
  let appliedCount = 0;
  let identicalCount = 0;
  for (const inc of incoming) {
    for (const segment of merged) {
      if (segment.to <= inc.from + EPS || segment.from >= inc.to - EPS) continue;
      const incomingSnap = snapshotOf(inc, segment.from, segment.to);
      if (sameContent(segment, incomingSnap)) {
        identicalCount += 1;
        continue;
      }
      if ((segment.updatedAt ?? 0) > payload.exportedAt) {
        conflicts.push({
          id: createId('cfl'),
          holeId: hole.id,
          from: segment.from,
          to: segment.to,
          local: snapshotOf(segment, segment.from, segment.to),
          incoming: incomingSnap,
          reason: '平板导出后两侧都修改过该深度段',
        });
      } else {
        segment.lithology = inc.lithology;
        segment.color = inc.color;
        segment.structure = inc.structure;
        segment.alteration = inc.alteration;
        segment.mineralization = inc.mineralization;
        segment.description = inc.description;
        segment.photoUrl = inc.photoUrl || segment.photoUrl; // 导入方无照片时保留原照片
        segment.updatedAt = payload.exportedAt;
        appliedCount += 1;
      }
    }
  }

  // 3) 组装新数据并重算地层线，接不上的标成失效
  const nextHoles = holes.map((item) => ({
    ...item,
    intervals: item.id === hole.id ? merged : item.intervals,
    correlations: item.correlations.map((correlation) => ({ ...correlation })),
  }));
  const wasInvalid = new Set(
    hole.correlations.filter((item) => item.status === 'invalid').map((item) => item.id),
  );
  recomputeCorrelations(nextHoles, hole.id, idMap);
  const mergedHole = nextHoles.find((item) => item.id === hole.id)!;
  const invalidatedCount = mergedHole.correlations.filter(
    (item) => item.status === 'invalid' && !wasInvalid.has(item.id),
  ).length;

  return {
    ok: true,
    holes: nextHoles,
    report: {
      holeId: hole.id,
      holeName: hole.name,
      mergedAt: Date.now(),
      appliedCount,
      identicalCount,
      splitCount,
      invalidatedCount,
      conflicts,
    },
  };
}

/**
 * 生成一份模拟平板离线导出的数据包：边界故意与现存区间错位，
 * 并改动个别段的岩性、矿化和描述，用于演示与联调合并流程。
 */
export function createSamplePayload(hole: DrillHole): FieldPayload {
  const sorted = sortIntervals(hole.intervals);
  const internal = sorted.slice(0, -1).map((item, index) => item.to + (index % 2 === 0 ? 0.4 : -0.4));
  const bounds: number[] = [0];
  internal.forEach((raw, index) => {
    const min = bounds[bounds.length - 1] + 0.5;
    const max = hole.totalDepth - (internal.length - index) * 0.5;
    bounds.push(roundDepth(Math.min(Math.max(raw, min), max)));
  });
  bounds.push(hole.totalDepth);

  const intervals = bounds.slice(0, -1).map((from, index) => {
    const to = bounds[index + 1];
    const mid = (from + to) / 2;
    const base = sorted.find((item) => mid >= item.from && mid <= item.to) ?? sorted[0];
    const snap = snapshotOf(base, roundDepth(from), roundDepth(to));
    snap.photoUrl = ''; // 平板照片尚未回传，合并时保留原照片
    if (index === 1 || (sorted.length === 1 && index === 0)) {
      const current = LITHOLOGY_OPTIONS.findIndex((item) => item.name === snap.lithology);
      const next = LITHOLOGY_OPTIONS[(current + 1 + LITHOLOGY_OPTIONS.length) % LITHOLOGY_OPTIONS.length];
      snap.lithology = next.name;
      snap.color = next.color;
      snap.description = `${snap.description}（野外复测后调整岩性）`.trim();
    }
    if (index === 2) {
      snap.mineralization = snap.mineralization === '无' ? '黄铁矿化' : snap.mineralization;
      snap.description = `${snap.description}（野外补录：裂隙面见薄膜状矿化）`.trim();
    }
    return snap;
  });

  return {
    schema: 'core-column/field-v1',
    holeId: hole.id,
    exportedAt: Date.now(),
    device: '野外平板（示例）',
    intervals,
  };
}
