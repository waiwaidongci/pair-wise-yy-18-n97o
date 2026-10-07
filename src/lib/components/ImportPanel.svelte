<script lang="ts">
  import { logbook } from '$lib/stores/logbook.svelte';
  import { createSamplePayload } from '$lib/utils/merge';

  interface Props {
    open: boolean;
    onClose: () => void;
  }

  let { open, onClose }: Props = $props();

  let text = $state('');
  let fileInput = $state<HTMLInputElement | null>(null);

  function fillSample() {
    const hole = logbook.activeHole;
    if (!hole) return;
    text = JSON.stringify(createSamplePayload(hole), null, 2);
  }

  function readFile(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      text = String(reader.result ?? '');
    };
    reader.readAsText(file);
  }

  function runImport() {
    // 失败时 text 保留在输入框里，修正后可直接再次合并
    if (logbook.importFieldData(text)) {
      text = '';
      onClose();
    }
  }
</script>

{#if open}
  <div
    class="overlay"
    role="presentation"
    onclick={(event) => event.target === event.currentTarget && onClose()}
  >
    <div class="dialog" role="dialog" aria-label="导入野外编录数据">
      <header>
        <div>
          <span>离线数据合并</span>
          <strong>导入野外平板编录包 · {logbook.activeHole?.name ?? ''}</strong>
        </div>
        <button class="btn btn-sm variant-soft" onclick={onClose}>关闭</button>
      </header>

      <p class="hint">
        粘贴或选择平板离线导出的 JSON 数据包。合并时按导入边界把现存区间切开再叠加，
        原有岩性、描述和照片都会保留；同一深度段两边都改过的不覆盖，会列为待处理冲突。
      </p>

      <textarea
        rows="10"
        bind:value={text}
        placeholder="粘贴平板导出的 JSON，或点击“生成示例数据包”"
        spellcheck="false"
      ></textarea>

      {#if logbook.importError}
        <div class="import-error" role="alert">
          <strong>导入失败：{logbook.importError}</strong>
          <span>原始记录未改动，修正数据后可重试。</span>
        </div>
      {/if}

      <footer>
        <input
          bind:this={fileInput}
          type="file"
          accept="application/json,.json"
          class="file-hidden"
          onchange={readFile}
        />
        <button class="btn btn-sm variant-soft" onclick={() => fileInput?.click()}>选择文件…</button>
        <button class="btn btn-sm variant-soft" onclick={fillSample}>生成示例数据包</button>
        <span class="spacer"></span>
        <button class="btn btn-sm variant-filled-primary" disabled={!text.trim()} onclick={runImport}>
          合并到当前项目
        </button>
      </footer>

      <p class="tip">提示：想看到冲突效果，可先生成示例数据包，再到区间表里改动某一段，然后回到这里合并。</p>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: center;
    padding: 20px;
    background: rgba(15, 23, 42, 0.45);
  }
  .dialog {
    width: min(620px, 100%);
    max-height: 90vh;
    overflow: auto;
    border-radius: 12px;
    background: #fff;
    padding: 16px;
    box-shadow: 0 24px 60px rgba(15, 23, 42, 0.3);
  }
  header {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 10px;
  }
  header div { display: grid; gap: 2px; }
  header span { color: #0f766e; font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .1em; }
  header strong { font-size: 14px; color: #172033; }
  .hint { margin: 0 0 10px; color: #475569; font-size: 11px; line-height: 1.6; }
  textarea {
    width: 100%;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    padding: 9px;
    font-family: ui-monospace, monospace;
    font-size: 11px;
    line-height: 1.5;
    resize: vertical;
  }
  .import-error {
    display: grid;
    gap: 3px;
    margin-top: 10px;
    padding: 9px 11px;
    border: 1px solid #fca5a5;
    border-radius: 8px;
    background: #fef2f2;
    color: #991b1b;
    font-size: 11px;
  }
  .import-error span { color: #b91c1c; font-size: 10px; }
  footer { display: flex; align-items: center; gap: 6px; margin-top: 12px; }
  .spacer { flex: 1; }
  .file-hidden { display: none; }
  .tip { margin: 10px 0 0; color: #94a3b8; font-size: 10px; }
</style>
