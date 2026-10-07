<script lang="ts">
  import { logbook } from '$lib/stores/logbook.svelte';
  import type { IntervalSnapshot } from '$lib/types/geology';

  const FIELDS: { key: keyof IntervalSnapshot; label: string }[] = [
    { key: 'lithology', label: '岩性' },
    { key: 'structure', label: '结构' },
    { key: 'alteration', label: '蚀变' },
    { key: 'mineralization', label: '矿化' },
    { key: 'description', label: '描述' },
  ];

  function holeName(id: string) {
    return logbook.holes.find((hole) => hole.id === id)?.name ?? id;
  }
</script>

<section class="conflict-panel print-hide">
  <div class="section-head">
    <div>
      <span>合并冲突 · 待处理</span>
      <strong>{logbook.pendingConflicts.length} 个深度段两侧都修改过，未覆盖，需人工取舍</strong>
    </div>
    <span class="autosave">处理前现有记录保持不变</span>
  </div>

  <div class="conflict-list">
    {#each logbook.pendingConflicts as conflict (conflict.id)}
      <article class="conflict-card">
        <header>
          <strong>{holeName(conflict.holeId)} · {conflict.from.toFixed(1)}–{conflict.to.toFixed(1)} m</strong>
          <span>{conflict.reason}</span>
        </header>
        <div class="versions">
          <div class="version">
            <b>现有记录</b>
            {#each FIELDS as field}
              <div class:diff={conflict.local[field.key] !== conflict.incoming[field.key]}>
                <i>{field.label}</i>
                <span>{conflict.local[field.key] || '—'}</span>
              </div>
            {/each}
            <button class="btn btn-sm variant-soft" onclick={() => logbook.resolveConflict(conflict.id, 'local')}>
              保留现有
            </button>
          </div>
          <div class="version incoming">
            <b>导入数据</b>
            {#each FIELDS as field}
              <div class:diff={conflict.local[field.key] !== conflict.incoming[field.key]}>
                <i>{field.label}</i>
                <span>{conflict.incoming[field.key] || '—'}</span>
              </div>
            {/each}
            <button
              class="btn btn-sm variant-filled-primary"
              onclick={() => logbook.resolveConflict(conflict.id, 'incoming')}
            >
              采用导入
            </button>
          </div>
        </div>
      </article>
    {/each}
  </div>
</section>

<style>
  .conflict-panel {
    margin-bottom: 14px;
    padding: 12px;
    border: 1px solid #fcd34d;
    border-radius: 10px;
    background: #fffbeb;
  }
  .conflict-panel .section-head > div > span { color: #b45309; }
  .conflict-list { display: grid; gap: 10px; }
  .conflict-card {
    border: 1px solid #fde68a;
    border-radius: 8px;
    background: #fff;
    padding: 10px 12px;
  }
  .conflict-card header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 8px;
  }
  .conflict-card header strong { font-size: 12px; color: #172033; }
  .conflict-card header span { color: #b45309; font-size: 10px; }
  .versions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .version {
    display: grid;
    gap: 4px;
    align-content: start;
    border: 1px solid #e2e8f0;
    border-radius: 7px;
    padding: 8px;
  }
  .version.incoming { border-color: #99f6e4; background: #f0fdfa; }
  .version b { font-size: 10px; color: #475569; }
  .version div {
    display: grid;
    grid-template-columns: 34px 1fr;
    gap: 6px;
    padding: 3px 5px;
    border-radius: 4px;
    font-size: 10px;
  }
  .version div.diff { background: #fef3c7; }
  .version.incoming div.diff { background: #ccfbf1; }
  .version i { font-style: normal; color: #94a3b8; }
  .version span { color: #1e293b; word-break: break-all; }
  .version button { margin-top: 4px; justify-self: end; }
  @media (max-width: 760px) {
    .versions { grid-template-columns: 1fr; }
  }
</style>
