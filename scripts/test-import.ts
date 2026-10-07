import { mergeHole, parseImportPayload, remapCorrelations, isAuthored, attributesEqual } from '../src/lib/utils/importMerge';
import { sortIntervals } from '../src/lib/utils/geology';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { passed += 1; console.log('  ✓', msg); }
  else { failed += 1; console.error('  ✗', msg); }
}

function iv(from: number, to: number, lithology: string, extra: Record<string, unknown> = {}) {
  return {
    id: `int-${from}-${to}-${Math.random().toString(36).slice(2, 6)}`,
    from, to, lithology,
    color: '#888', structure: '块状', alteration: '无', mineralization: '无',
    description: '', photoUrl: '', ...extra,
  };
}

function hole(id: string, intervals: any[], totalDepth?: number) {
  return {
    id, name: id, project: '测试', coordinates: '0', collarElevation: 0,
    totalDepth: totalDepth ?? intervals[intervals.length - 1].to,
    intervals, correlations: [],
  };
}

console.log('\n[1] 边界不对齐：按导入边界切分现存区间，不一致处不覆盖、列待处理');
{
  const existing = hole('ZK-1', [iv(0, 10, '腐殖土'), iv(10, 20, '粉质黏土')]);
  const imported = hole('ZK-1', [iv(0, 5, '腐殖土'), iv(5, 15, '细砂'), iv(15, 20, '粉质黏土')]);
  const result = mergeHole(existing, imported);
  const sorted = sortIntervals(result.hole.intervals);
  assert(sorted.length === 4, `现存区间被切成 4 段（实际 ${sorted.length}）`);
  assert(sorted.every((v, i) => i === 0 || Math.abs(v.from - sorted[i - 1].to) < 0.001), '各段连续无重叠');
  assert(Math.abs(sorted[0].from - 0) < 0.001 && Math.abs(sorted[sorted.length - 1].to - 20) < 0.001, '深度范围保持 0–20');
  assert(sorted[0].lithology === '腐殖土' && sorted[0].from === 0 && sorted[0].to === 5, '0–5 段两边一致，保留腐殖土');
  assert(sorted[1].lithology === '腐殖土' && sorted[1].from === 5 && sorted[1].to === 10, '5–10 段保留现存腐殖土（不覆盖）');
  assert(sorted[2].lithology === '粉质黏土' && sorted[2].from === 10 && sorted[2].to === 15, '10–15 段保留现存粉质黏土（不覆盖）');
  assert(sorted[3].lithology === '粉质黏土' && sorted[3].from === 15 && sorted[3].to === 20, '15–20 段两边一致，保留粉质黏土');
  assert(result.conflicts.length === 2, `5–10 与 10–15 两处不一致各记 1 条待处理（实际 ${result.conflicts.length}）`);
  assert(result.conflicts.every((c) => c.status === 'pending'), '冲突均为待处理状态');
}

console.log('\n[2] 两边都改过且不一致：不覆盖，列待处理，双份都保留');
{
  const existing = hole('ZK-2', [iv(0, 10, '腐殖土', { description: '现有描述', photoUrl: 'photo-A' })]);
  const imported = hole('ZK-2', [iv(0, 10, '腐殖土', { description: '导入描述', photoUrl: 'photo-B' })]);
  const result = mergeHole(existing, imported);
  assert(result.conflicts.length === 1, '产生 1 处待处理冲突');
  assert(result.conflicts[0].existing.description === '现有描述', '冲突保留现有版本描述');
  assert(result.conflicts[0].imported.description === '导入描述', '冲突保留导入版本描述');
  assert(result.conflicts[0].existing.photoUrl === 'photo-A', '原有照片未丢');
  assert(result.conflicts[0].imported.photoUrl === 'photo-B', '导入照片保留');
  assert(result.hole.intervals[0].description === '现有描述', '生效段保持现有版本（不覆盖）');
  assert(result.conflicts[0].status === 'pending', '冲突状态为待处理');
}

console.log('\n[3] 仅一边编录过：自动叠加该边');
{
  const existing = hole('ZK-3', [iv(0, 10, '待编录')]);
  const imported = hole('ZK-3', [iv(0, 10, '细砂', { description: '新录' })]);
  const result = mergeHole(existing, imported);
  assert(result.conflicts.length === 0, '无冲突');
  assert(result.hole.intervals[0].lithology === '细砂', '空白段自动采用导入数据');
}

console.log('\n[4] 两边一致：无冲突，保留现有');
{
  const existing = hole('ZK-4', [iv(0, 10, '腐殖土', { description: '相同' })]);
  const imported = hole('ZK-4', [iv(0, 10, '腐殖土', { description: '相同' })]);
  const result = mergeHole(existing, imported);
  assert(result.conflicts.length === 0, '两边一致不产生冲突');
  assert(result.hole.intervals[0].lithology === '腐殖土', '保留现有段');
}

console.log('\n[5] 导入更深：延伸终孔深度');
{
  const existing = hole('ZK-5', [iv(0, 10, '腐殖土')], 10);
  const imported = hole('ZK-5', [iv(0, 15, '腐殖土')], 15);
  const result = mergeHole(existing, imported);
  assert(result.hole.totalDepth === 15, `终孔深度延伸到 15（实际 ${result.hole.totalDepth}）`);
  assert(sortIntervals(result.hole.intervals).at(-1)!.to === 15, '末段到底 15 m');
}

console.log('\n[6] 地层线重算：区间切开后连线跟到新段；接不上标失效');
{
  const src = iv(0, 10, '腐殖土');
  const existing = hole('ZK-6', [src]);
  const imported = hole('ZK-6', [iv(0, 4, '腐殖土'), iv(4, 10, '腐殖土')]);
  // 一条指向现存区间的地层线
  existing.correlations = [{
    id: 'c1', intervalId: src.id, targetHoleId: 'ZK-7', targetIntervalId: 'gone', color: '#f00',
  }];
  const result = mergeHole(existing, imported);
  const idMap = new Map<string, string>();
  result.oldToNew.forEach((v, k) => idMap.set(k, v));
  // 目标孔不存在 -> 失效
  const { holes, invalidCount } = remapCorrelations([result.hole], idMap);
  assert(invalidCount === 1, `目标端点不存在时标记 1 条失效（实际 ${invalidCount}）`);
  assert(holes[0].correlations[0].invalid === true, '连线带 invalid 标记');
  assert(holes[0].correlations[0].intervalId !== src.id, '源区间 id 已重映射到新段');
}

console.log('\n[7] 解析校验：坏 JSON / 缺 holes / 区间不连续 -> 明确失败');
{
  const bad1 = parseImportPayload('{not json');
  assert(!bad1.ok && bad1.error.includes('JSON 解析失败'), '坏 JSON 返回解析失败');
  const bad2 = parseImportPayload(JSON.stringify({ foo: 1 }));
  assert(!bad2.ok && bad2.error.includes('holes'), '缺 holes 返回失败');
  const bad3 = parseImportPayload(JSON.stringify({ holes: [hole('X', [iv(0, 5, 'a'), iv(6, 10, 'b')])] }));
  assert(!bad3.ok && bad3.error.includes('不连续'), '区间不连续返回失败');
  const good = parseImportPayload(JSON.stringify({ holes: [hole('X', [iv(0, 10, 'a')])] }));
  assert(good.ok, '正常数据解析成功');
}

console.log('\n[8] isAuthored / attributesEqual 判定');
{
  assert(isAuthored(iv(0, 1, '腐殖土')) === true, '有岩性即已编录');
  assert(isAuthored(iv(0, 1, '待编录')) === false, '待编录视为未编录');
  assert(isAuthored(iv(0, 1, '待编录', { description: '有描述' })) === true, '有描述即已编录');
  assert(isAuthored(null) === false, 'null 未编录');
  assert(attributesEqual(iv(0, 1, 'a'), iv(2, 3, 'a')) === true, '同岩性属性相等（深度无关）');
  assert(attributesEqual(iv(0, 1, 'a'), iv(0, 1, 'b')) === false, '不同岩性属性不等');
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed) process.exit(1);
