<script lang="ts">
  import { logbook } from '$lib/stores/logbook.svelte';

  interface Props {
    open: boolean;
    onclose: () => void;
  }

  let { open, onclose }: Props = $props();

  let dialogEl = $state<HTMLDialogElement | null>(null);
  let raw = $state('');
  let fileName = $state('');
  let outcome = $state<{ ok: boolean; message: string } | null>(null);

  $effect(() => {
    if (open) {
      raw = '';
      fileName = '';
      outcome = null;
      if (dialogEl && !dialogEl.open) dialogEl.showModal();
    } else if (dialogEl?.open) {
      dialogEl.close();
    }
  });

  function handleFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    fileName = file.name;
    const reader = new FileReader();
    reader.onload = () => {
      raw = String(reader.result ?? '');
    };
    reader.readAsText(file);
  }

  function runImport(useRetry: boolean) {
    const result = useRetry ? logbook.retryImport() : logbook.importOfflineData(raw);
    if (result.ok) {
      const s = result.summary;
      outcome = {
        ok: true,
        message: `导入完成：合并 ${s.mergedCount} 个钻孔，新增 ${s.newCount} 个钻孔，待处理冲突 ${s.conflictCount} 处，失效地层线 ${s.invalidCorrelationCount} 条。`,
      };
    } else {
      outcome = { ok: false, message: result.error };
    }
  }

  function handleBackdrop(event: MouseEvent) {
    if (event.target === dialogEl) onclose();
  }
</script>

<dialog bind:this={dialogEl} class="import-dialog" onclose={onclose} onclick={handleBackdrop}>
  <header>
    <div>
      <span>离线编录导入</span>
      <strong>导入平板离线记好的钻芯编录 JSON</strong>
    </div>
    <button class="dialog-close" aria-label="关闭" onclick={onclose}>×</button>
  </header>

  <div class="dialog-body">
    <p class="hint">
      选择野外平板导出的编录文件，或直接粘贴 JSON。导入会先按导入边界切分现存区间再叠加，
      原有岩性、描述和照片不会被覆盖；两边都改过的深度段会列成待处理。
    </p>

    <label class="file-drop">
      <input type="file" accept="application/json,.json" onchange={handleFile} />
      <span>{fileName || '选择 .json 编录文件'}</span>
    </label>

    <label class="raw-input">
      <span>或粘贴编录 JSON</span>
      <textarea
        bind:value={raw}
        rows="8"
        placeholder={'{"schema":"core-column/v1","holes":[...]}'}
      ></textarea>
    </label>

    {#if outcome}
      <div class="outcome" class:ok={outcome.ok} class:err={!outcome.ok}>
        <strong>{outcome.ok ? '导入成功' : '导入失败，原记录未改动，可重试'}</strong>
        <span>{outcome.message}</span>
      </div>
    {/if}
  </div>

  <footer>
    <button class="btn variant-soft" onclick={onclose}>关闭</button>
    {#if outcome && !outcome.ok && logbook.lastImportRaw}
      <button class="btn variant-soft" onclick={() => runImport(true)}>重试上次导入</button>
    {/if}
    <button class="btn variant-filled-primary" disabled={!raw.trim()} onclick={() => runImport(false)}>
      导入并合并
    </button>
  </footer>
</dialog>

<style>
  .import-dialog { width: min(560px, 92vw); border: 1px solid #cbd5e1; border-radius: 12px; padding: 0; background: #fff; color: #172033; box-shadow: 0 24px 60px rgba(15,23,42,.25); }
  .import-dialog::backdrop { background: rgba(15,23,42,.45); }
  header { display: flex; align-items: start; justify-content: space-between; gap: 12px; padding: 14px 16px; border-bottom: 1px solid #e2e8f0; background: #f8fafc; border-radius: 12px 12px 0 0; }
  header span { display: block; color: #0f766e; font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; }
  header strong { display: block; margin-top: 2px; font-size: 14px; }
  .dialog-close { border: 0; background: transparent; font-size: 22px; line-height: 1; color: #64748b; cursor: pointer; }
  .dialog-body { display: grid; gap: 12px; padding: 16px; }
  .hint { margin: 0; color: #64748b; font-size: 11px; line-height: 1.6; }
  .file-drop { display: grid; place-items: center; padding: 18px; border: 1.5px dashed #94a3b8; border-radius: 10px; background: #f8fafc; color: #475569; font-size: 12px; cursor: pointer; }
  .file-drop:hover { border-color: #0f766e; color: #0f766e; }
  .file-drop input { display: none; }
  .raw-input { display: grid; gap: 5px; }
  .raw-input span { color: #64748b; font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; }
  .raw-input textarea { width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px; font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; resize: vertical; }
  .outcome { display: grid; gap: 3px; padding: 10px 12px; border-radius: 8px; font-size: 11px; }
  .outcome.ok { background: #ecfdf5; border: 1px solid #6ee7b7; color: #065f46; }
  .outcome.err { background: #fef2f2; border: 1px solid #fca5a5; color: #991b1b; }
  footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid #e2e8f0; }
</style>
