<script lang="ts">
  import { onMount } from 'svelte';
  import { ViewerModal, IconButton, t } from '@skaro/ui';
  import { X } from '@lucide/svelte';
  import { lineNumbers, EditorView } from '@codemirror/view';
  import { readonlyTextView } from '../feed/readonly-text-view';
  import { commandOutputTheme } from '../feed/command-output-theme';
  import '../c4/viewer.css';
  let {
    source,
    onclose,
  }: { source: { path: string; text: string; line: number }; onclose: () => void } = $props();
  let root: HTMLDivElement;
  onMount(() => {
    const editor = readonlyTextView(root, source.text, [lineNumbers(), commandOutputTheme]);
    const line = editor.view.state.doc.line(Math.min(source.line, editor.view.state.doc.lines));
    editor.view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
    return editor.destroy;
  });
</script>

<ViewerModal expanded label={source.path} {onclose}>
  <header class="c4-viewer-header">
    <div class="c4-viewer-heading">
      <strong>{source.path}</strong><span>{t('graph.sourceLine', { n: source.line })}</span>
    </div>
    <IconButton tip={t('c4.close')} onclick={onclose}><X size={15} /></IconButton>
  </header>
  <div class="graph-source" bind:this={root}></div>
</ViewerModal>

<style>
  .graph-source {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 16px;
  }
</style>
