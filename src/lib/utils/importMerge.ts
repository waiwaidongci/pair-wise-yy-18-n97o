import type {
  Correlation,
  DrillHole,
  ImportPayload,
  Interval,
  PendingConflict,
} from '../types/geology';
import { createId, roundDepth, sortIntervals } from './geology';

export const DEPTH_TOLERANCE = 0.001;

const MERGE_FIELDS = [
  'lithology',
  'color',
  'structure',
  'alteration',
  'mineralization',
  'description',
  'photoUrl',
] as const;

export interface ImportFailure {
  ok: false;
  error: string;
}

export interface ImportSuccess {
  ok: true;
  payload: ImportPayload;
}

export type ParseResult = ImportFailure | ImportSuccess;

export interface HoleMergeResult {
  hole: DrillHole;
  conflicts: PendingConflict[];
  /** 合并前旧区间 id -> 合并后新区间 id，供地层线重算 */
  oldToNew: Map<string, string>;
}

function defaultInterval(from: number, to: number): Interval {
  return {
    id: createId('int'),
    from,
    to,
    lithology: '待编录',
    color: '#b8b1a5',
    structure: '块状',
    alteration: '无',
    mineralization: '无',
    description: '',
    photoUrl: '',
  };
}

/** 判断区间是否被真正编录过（有岩性 / 描述 / 照片），而非空白默认段 */
export function isAuthored(interval: Interval | null | undefined): boolean {
  if (!interval) return false;
  if (interval.lithology && interval.lithology !== '待编录') return true;
  if (interval.description && interval.description.trim().length > 0) return true;
  if (interval.photoUrl && interval.photoUrl.length > 0) return true;
  return false;
}

export function attributesEqual(a: Interval, b: Interval): boolean {
  return MERGE_FIELDS.every((field) => (a[field] ?? '') === (b[field] ?? ''));
}

export function differingFields(a: Interval, b: Interval): string[] {
  return MERGE_FIELDS.filter((field) => (a[field] ?? '') !== (b[field] ?? ''));
}

function checkContinuity(intervals: Interval[], totalDepth: number): string | null {
  const sorted = sortIntervals(intervals);
  if (sorted.length === 0) return '没有区间数据';
  if (Math.abs(sorted[0].from) > DEPTH_TOLERANCE) return '区间未从 0 m 开始';
  if (Math.abs(sorted[sorted.length - 1].to - totalDepth) > DEPTH_TOLERANCE) {
    return '区间未延伸至终孔深度';
  }
  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i];
    if (current.to <= current.from) return `区间 ${current.from}–${current.to} m 深度无效`;
    if (i > 0 && Math.abs(current.from - sorted[i - 1].to) > DEPTH_TOLERANCE) {
      return `区间在 ${sorted[i - 1].to}–${current.from} m 处不连续`;
    }
  }
  return null;
}

/** 解析并校验导入 JSON，任何结构问题都返回明确错误，不产生副作用 */
export function parseImportPayload(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      error: 'JSON 解析失败：' + (err instanceof Error ? err.message : '文件不是有效的 JSON'),
    };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: '导入文件格式不正确：顶层必须是对象' };
  }
  const candidate = parsed as Record<string, unknown>;
  if (!Array.isArray(candidate.holes) || candidate.holes.length === 0) {
    return { ok: false, error: '导入文件缺少 holes 钻孔数据' };
  }
  for (let i = 0; i < candidate.holes.length; i += 1) {
    const hole = candidate.holes[i] as Partial<DrillHole> | null;
    if (!hole || typeof hole !== 'object') {
      return { ok: false, error: `第 ${i + 1} 个钻孔数据无效` };
    }
    if (typeof hole.id !== 'string' || !hole.id) {
      return { ok: false, error: `第 ${i + 1} 个钻孔缺少 id` };
    }
    if (typeof hole.name !== 'string' || !hole.name) {
      return { ok: false, error: `钻孔 ${hole.id} 缺少名称` };
    }
    if (typeof hole.totalDepth !== 'number' || hole.totalDepth <= 0) {
      return { ok: false, error: `钻孔 ${hole.id} 终孔深度无效` };
    }
    if (!Array.isArray(hole.intervals)) {
      return { ok: false, error: `钻孔 ${hole.id} 缺少区间数据` };
    }
    const continuityError = checkContinuity(hole.intervals as Interval[], hole.totalDepth);
    if (continuityError) {
      return { ok: false, error: `钻孔 ${hole.id}：${continuityError}` };
    }
  }
  return { ok: true, payload: candidate as unknown as ImportPayload };
}

/**
 * 按导入边界切分现存区间后叠加。
 * 取双方边界的并集做“共同加密切分”，使每一段都同时落在现存与导入的区间内。
 * 同一深度段两边都编录过且内容不一致时，保留现存版本作为生效段，
 * 同时把两次改动完整记入 pendingConflicts，不覆盖任何一方。
 */
export function mergeHole(existing: DrillHole, imported: DrillHole): HoleMergeResult {
  const ex = sortIntervals(existing.intervals);
  const im = sortIntervals(imported.intervals);
  const maxDepth = Math.max(existing.totalDepth, imported.totalDepth);

  const boundSet = new Set<number>();
  boundSet.add(0);
  boundSet.add(roundDepth(maxDepth));
  for (const iv of ex) {
    boundSet.add(roundDepth(iv.from));
    boundSet.add(roundDepth(iv.to));
  }
  for (const iv of im) {
    boundSet.add(roundDepth(iv.from));
    boundSet.add(roundDepth(iv.to));
  }
  const sortedBounds = [...boundSet].sort((a, b) => a - b);
  const cleanBounds: number[] = [];
  for (const bound of sortedBounds) {
    if (
      cleanBounds.length === 0 ||
      bound - cleanBounds[cleanBounds.length - 1] > DEPTH_TOLERANCE
    ) {
      cleanBounds.push(bound);
    }
  }

  const merged: Interval[] = [];
  const conflicts: PendingConflict[] = [];
  const oldToNew = new Map<string, string>();

  for (let k = 0; k < cleanBounds.length - 1; k += 1) {
    const from = cleanBounds[k];
    const to = cleanBounds[k + 1];
    if (to - from <= DEPTH_TOLERANCE) continue;
    const exIv =
      ex.find((iv) => iv.from <= from + DEPTH_TOLERANCE && iv.to >= to - DEPTH_TOLERANCE) ?? null;
    const imIv =
      im.find((iv) => iv.from <= from + DEPTH_TOLERANCE && iv.to >= to - DEPTH_TOLERANCE) ?? null;

    let active: Interval;
    if (isAuthored(exIv) && isAuthored(imIv) && exIv && imIv) {
      if (attributesEqual(exIv, imIv)) {
        active = { ...exIv, id: createId('int'), from, to };
      } else {
        // 两边都改过且不一致：现存版本继续生效，导入版本完整留作待处理
        active = { ...exIv, id: createId('int'), from, to };
        conflicts.push({
          id: createId('conf'),
          holeId: existing.id,
          from,
          to,
          existing: { ...exIv, from, to },
          imported: { ...imIv, from, to },
          status: 'pending',
          createdAt: Date.now(),
        });
      }
    } else if (isAuthored(imIv) && imIv) {
      active = { ...imIv, id: createId('int'), from, to };
    } else {
      active = { ...(exIv ?? defaultInterval(from, to)), id: createId('int'), from, to };
    }
    merged.push(active);
  }

  // 现存旧区间按中点归属映射到合并后的新区间，供地层线重算
  for (const old of ex) {
    const mid = (old.from + old.to) / 2;
    const target = merged.find(
      (iv) => iv.from <= mid + DEPTH_TOLERANCE && iv.to >= mid - DEPTH_TOLERANCE,
    );
    if (target) oldToNew.set(old.id, target.id);
  }

  const hole: DrillHole = {
    ...existing,
    totalDepth: roundDepth(maxDepth),
    intervals: merged,
  };
  return { hole, conflicts, oldToNew };
}

/** 导入新增钻孔时生成干净的孔：丢弃离线项目带来的地层线，区间重新赋 id */
export function cleanImportedHole(imported: DrillHole): DrillHole {
  return {
    ...imported,
    correlations: [],
    intervals: sortIntervals(imported.intervals).map((iv) => ({ ...iv, id: createId('int') })),
  };
}

/**
 * 区间改动后重算地层线：把旧区间 id 映射到新区间，
 * 端点在合并后找不到归属（目标孔被删 / 区间消失）的连线标为失效。
 */
export function remapCorrelations(
  holes: DrillHole[],
  idMap: Map<string, string>,
): { holes: DrillHole[]; invalidCount: number } {
  let invalidCount = 0;
  const remapped = holes.map((hole) => {
    const correlations: Correlation[] = hole.correlations.map((corr) => {
      const sourceId = idMap.get(corr.intervalId) ?? corr.intervalId;
      const targetId = idMap.get(corr.targetIntervalId) ?? corr.targetIntervalId;
      const targetHole = holes.find((item) => item.id === corr.targetHoleId);
      const sourceExists = hole.intervals.some((iv) => iv.id === sourceId);
      const targetExists = targetHole?.intervals.some((iv) => iv.id === targetId) ?? false;
      const invalid = !sourceExists || !targetExists;
      if (invalid) invalidCount += 1;
      return { ...corr, intervalId: sourceId, targetIntervalId: targetId, invalid: invalid || undefined };
    });
    return { ...hole, correlations };
  });
  return { holes: remapped, invalidCount };
}
