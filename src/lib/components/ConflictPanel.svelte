<script lang="ts">
  import { logbook } from '$lib/stores/logbook.svelte';
  import type { Interval, PendingConflict } from '$lib/types/geology';
  import { differingFields } from '$lib/utils/importMerge';

  const FIELD_LABELS: Record<string, string> = {
    lithology: '岩性',
    color: '颜色',
    structure: '结构',
    alteration: '蚀变',
    mineralization: '矿化',
    description: '描述',
    photoUrl: '照片',
  };

  const FIELD_ORDER = [
    'lithology',
    'color',
    'structure',
    'alteration',
    'mineralization',
    'description',
    'photoUrl',
  ];

  function holeName(holeId: string) {
    return logbook.holes.find((hole) => hole.id === holeId)?.name ?? holeId;
  }

  function diffs(conflict: PendingConflict) {
    return differingFields(conflict.existing, conflict.imported);
  }

  function displayValue(interval: Interval, field: string) {
    const value = (interval as unknown as Record<string, string>)[field];
    if (field === 'photoUrl') return value ? '已有照片' : '无照片';
    return value || '—';
  }
</script>

{#if logbook.pendingConflicts.length}
  <section class="conflict-panel">
    <header>
      <div>
        <strong>待处理冲突</strong>
        <span>
          {logbook.pendingConflictCount} 处待处理 · 两边都改过的深度段未覆盖，保留两次改动
        </span>
      </div>
      <button class="btn btn-sm variant-soft" onclick={() => logbook.clearResolvedConflicts()}>
        清除已处理
      </button>
    </header>

    <div class="conflict-list">
      {#each logbook.pendingConflicts as conflict (conflict.id)}
        <article class="conflict-card" class:resolved={conflict.status !== 'pending'}>
          <div class="conflict-head">
            <span class="conflict-depth">
              {holeName(conflict.holeId)} · {conflict.from.toFixed(1)}–{conflict.to.toFixed(1)} m
            </span>
            {#if conflict.status !== 'pending'}
              <span class="resolved-tag">
                已采用{conflict.status === 'imported' ? '导入版本' : '现有版本'}
              </span>
            {/if}
          </div>

          <div class="diff-grid">
            {#each FIELD_ORDER.filter((field) => diffs(conflict).includes(field)) as field}
              <div class="diff-row">
                <span class="field-name">{FIELD_LABELS[field]}</span>
                <div class="diff-values">
                  <div class="diff-value existing">
                    <em>现有</em>
                    <span>{displayValue(conflict.existing, field)}</span>
                  </div>
                  <div class="diff-value imported">
                    <em>导入</em>
                    <span>{displayValue(conflict.imported, field)}</span>
                  </div>
                </div>
              </div>
            {/each}
          </div>

          {#if conflict.status === 'pending'}
            <div class="conflict-actions">
              <button
                class="btn btn-sm variant-soft"
                onclick={() => logbook.resolveConflict(conflict.id, 'existing')}
              >
                保留现有
              </button>
              <button
                class="btn btn-sm variant-filled-primary"
                onclick={() => logbook.resolveConflict(conflict.id, 'imported')}
              >
                采用导入
              </button>
            </div>
          {/if}
        </article>
      {/each}
    </div>
  </section>
{/if}

<style>
  .conflict-panel { margin-bottom: 12px; border: 1px solid #fbbf24; border-radius: 10px; background: #fffbeb; overflow: hidden; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border-bottom: 1px solid #fde68a; }
  header strong { display: block; font-size: 13px; color: #78350f; }
  header span { display: block; margin-top: 2px; color: #92400e; font-size: 10px; }
  .conflict-list { display: grid; gap: 8px; padding: 10px 12px; }
  .conflict-card { border: 1px solid #fde68a; border-radius: 8px; background: #fff; padding: 10px; }
  .conflict-card.resolved { opacity: .7; }
  .conflict-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
  .conflict-depth { font-size: 11px; font-weight: 800; color: #172033; }
  .resolved-tag { font-size: 9px; color: #047857; background: #d1fae5; padding: 2px 8px; border-radius: 999px; }
  .diff-grid { display: grid; gap: 5px; }
  .diff-row { display: grid; grid-template-columns: 48px 1fr; gap: 8px; align-items: start; }
  .field-name { color: #64748b; font-size: 10px; padding-top: 3px; }
  .diff-values { display: grid; gap: 3px; }
  .diff-value { display: grid; grid-template-columns: 36px 1fr; gap: 6px; align-items: baseline; padding: 3px 6px; border-radius: 5px; font-size: 10px; }
  .diff-value em { font-style: normal; font-size: 8px; font-weight: 800; }
  .diff-value span { color: #172033; word-break: break-word; }
  .diff-value.existing { background: #f1f5f9; }
  .diff-value.existing em { color: #475569; }
  .diff-value.imported { background: #ecfdf5; }
  .diff-value.imported em { color: #047857; }
  .conflict-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }
</style>
