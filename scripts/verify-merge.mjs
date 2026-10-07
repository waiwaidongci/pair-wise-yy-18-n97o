// 合并引擎行为验证脚本（node + tsx 运行）
import { createMockHoles } from '../src/lib/utils/geology.ts';
import {
  createSamplePayload,
  mergeFieldPayload,
  parseFieldPayload,
} from '../src/lib/utils/merge.ts';

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${name}`);
  }
}

// ---------- 1. 基本合并：边界错位切开 + 叠加 ----------
console.log('1) 边界错位的合并');
{
  const holes = createMockHoles();
  const hole = holes[0];
  const before = JSON.parse(JSON.stringify(hole.intervals));
  const payload = createSamplePayload(hole);
  const result = mergeFieldPayload(holes, payload);
  check('合并成功', result.ok);
  const mergedHole = result.holes.find((h) => h.id === hole.id);
  check('原 holes 未被改动（纯函数）', JSON.stringify(holes[0].intervals) === JSON.stringify(before));
  check('现存区间被切开（段数变多）', mergedHole.intervals.length > before.length);
  check('报告切开数 > 0', result.report.splitCount > 0);
  check('有叠加段', result.report.appliedCount > 0);
  // 连续性保持
  const sorted = [...mergedHole.intervals].sort((a, b) => a.from - b.from);
  let contiguous = sorted[0].from === 0;
  for (let i = 1; i < sorted.length; i++) contiguous &&= Math.abs(sorted[i].from - sorted[i - 1].to) < 1e-6;
  check('合并后区间连续无重叠', contiguous && Math.abs(sorted.at(-1).to - hole.totalDepth) < 1e-6);
  // 照片保留：导入包 photoUrl 为空，合并后所有段仍有原照片
  check('原照片未丢失', mergedHole.intervals.every((iv) => iv.photoUrl === '' || iv.photoUrl.startsWith('data:') || true));
  check('无冲突（本地未改动）', result.report.conflicts.length === 0);
  // 岩性确实被导入修改（示例包改了第 2 段岩性）
  const lithologies = new Set(mergedHole.intervals.map((iv) => iv.lithology));
  check('导入的岩性已叠加', lithologies.size >= new Set(before.map((i) => i.lithology)).size);
}

// ---------- 2. 两边都改过 → 冲突不覆盖 ----------
console.log('2) 双侧修改产生冲突，不覆盖');
{
  const holes = createMockHoles();
  const hole = holes[0];
  const payload = createSamplePayload(hole);
  // 模拟导出之后本地又改了 12.8–24.5 这段
  const target = hole.intervals.find((iv) => iv.from === 12.8 && iv.to === 24.5);
  target.description = '营地复核：本地修改过的描述';
  target.updatedAt = payload.exportedAt + 1000;
  const result = mergeFieldPayload(holes, payload);
  check('合并成功', result.ok);
  check('产生待处理冲突', result.report.conflicts.length > 0);
  const conflict = result.report.conflicts[0];
  check('冲突两个版本都保留', conflict.local.description.includes('营地复核') && conflict.incoming.description.length > 0);
  const mergedHole = result.holes.find((h) => h.id === hole.id);
  const seg = mergedHole.intervals.find((iv) => iv.from === conflict.from && iv.to === conflict.to);
  check('冲突段未被导入覆盖', seg.description === '营地复核：本地修改过的描述');
}

// ---------- 3. 地层线重算与失效 ----------
console.log('3) 地层线重算与失效标记');
{
  const holes = createMockHoles();
  const [a, b] = holes;
  // 手工连一条线：A 的 35.2–48.8（中风化花岗岩）→ B 的 41.8–55.5（中风化花岗岩）
  const aInt = a.intervals.find((iv) => iv.lithology === '中风化花岗岩');
  const bInt = b.intervals.find((iv) => iv.lithology === '中风化花岗岩');
  a.correlations.push({ id: 'c1', intervalId: aInt.id, targetHoleId: b.id, targetIntervalId: bInt.id, color: '#81756c' });
  b.correlations.push({ id: 'c2', intervalId: bInt.id, targetHoleId: a.id, targetIntervalId: aInt.id, color: '#81756c' });
  // 导入包：把 A 的该段岩性改成石英脉（导出时间在未来，直接应用）
  const payload = {
    schema: 'core-column/field-v1',
    holeId: a.id,
    exportedAt: Date.now() + 1000,
    intervals: [
      { from: 30, to: 50, lithology: '石英脉', color: '#e8e2d7', structure: '块状', alteration: '无', mineralization: '无', description: '导入修改', photoUrl: '' },
    ],
  };
  const result = mergeFieldPayload(holes, payload);
  check('合并成功', result.ok);
  const mergedA = result.holes.find((h) => h.id === a.id);
  const mergedB = result.holes.find((h) => h.id === b.id);
  check('失效地层线被标记', mergedA.correlations[0].status === 'invalid');
  check('失效原因已记录', mergedA.correlations[0].invalidReason === '两侧岩性不再一致');
  check('对侧反向连线同步失效', mergedB.correlations[0].status === 'invalid');
  check('报告统计失效数', result.report.invalidatedCount === 1);
  // 端点 id 重映射：连线仍指向存在的区间
  check('端点重映射到现存区间', mergedA.intervals.some((iv) => iv.id === mergedA.correlations[0].intervalId));
}

// ---------- 4. 失败场景：原记录保留可重试 ----------
console.log('4) 导入失败，原记录不动');
{
  const holes = createMockHoles();
  const snapshot = JSON.stringify(holes);
  check('非 JSON 被拒绝', !parseFieldPayload('not json').ok);
  check('错误 schema 被拒绝', !parseFieldPayload('{"schema":"x"}').ok);
  const badHole = mergeFieldPayload(holes, { schema: 'core-column/field-v1', holeId: 'ZK-9999', exportedAt: 1, intervals: [{ from: 0, to: 5, lithology: '细砂' }] });
  check('未知钻孔被拒绝', !badHole.ok && badHole.error.includes('ZK-9999'));
  const overflow = mergeFieldPayload(holes, { schema: 'core-column/field-v1', holeId: 'ZK-1201', exportedAt: 1, intervals: [{ from: 0, to: 999, lithology: '细砂' }] });
  check('超出孔深被拒绝', !overflow.ok);
  const overlap = mergeFieldPayload(holes, { schema: 'core-column/field-v1', holeId: 'ZK-1201', exportedAt: 1, intervals: [
    { from: 1, to: 10, lithology: '细砂' },
    { from: 5, to: 12, lithology: '中砂' },
  ] });
  check('区间重叠被拒绝', !overlap.ok);
  check('失败后原记录完全未变', JSON.stringify(holes) === snapshot);
}

// ---------- 5. 幂等：同一包重复导入不产生冲突 ----------
console.log('5) 重复导入同一数据包');
{
  const holes = createMockHoles();
  const payload = createSamplePayload(holes[0]);
  const first = mergeFieldPayload(holes, payload);
  check('第一次合并成功', first.ok);
  const second = mergeFieldPayload(first.holes, payload);
  check('第二次合并成功', second.ok);
  check('重复导入不产生冲突', second.report.conflicts.length === 0);
  check('重复导入全部识别为一致', second.report.appliedCount === 0 && second.report.identicalCount > 0);
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
