<script lang="ts">
  import type { TurnFile } from '@skaro/timeline';
  import { t, ViewerModal } from '@skaro/ui';
  import type { FileDiff } from '../../../shared/ipc';
  import DiffCode from './DiffCode.svelte';
  import { useFeed } from './context.svelte';
  import DiffModalHeader from './DiffModalHeader.svelte';
  import { createDiffModalController, isCodePath } from './diff-modal-controller.svelte';
  import { displayPath } from './format';
  import './diff-modal.css';

  /**
   * The changes of the files of an agent's reply (Skaro UI v2 mockup, "Diff modal"): one file at
   * a time with old and new line numbers; switch files, refresh from the working folder, expand
   * to the window. Esc or the backdrop closes it.
   */
  let {
    files,
    start = 0,
    cwd,
    load,
    onclose,
  }: {
    files: TurnFile[];
    start?: number;
    cwd: string | undefined;
    load: (path: string) => Promise<FileDiff>;
    onclose: () => void;
  } = $props();

  const feed = useFeed();
  const dm = createDiffModalController({
    files: () => files,
    start: () => start,
    load: (path) => load(path),
    onerror: (error) => feed.historyError?.(error),
  });

  const path = $derived(
    dm.change === 'move' && dm.file.movePath
      ? `${displayPath(dm.file.path, cwd)} → ${displayPath(dm.file.movePath, cwd)}`
      : displayPath(dm.file.path, cwd),
  );
</script>

<ViewerModal class="dm-dialog" expanded={dm.expanded} label={path} {onclose}>
  <DiffModalHeader
    {path}
    code={isCodePath(dm.file.movePath ?? dm.file.path)}
    added={dm.counts.added}
    removed={dm.counts.removed}
    badge={dm.change === 'add' ? 'new' : dm.change === 'delete' ? 'deleted' : undefined}
    sub={dm.sub}
    index={dm.index}
    count={files.length}
    spin={dm.spin}
    expanded={dm.expanded}
    onprev={() => dm.go(dm.index - 1)}
    onnext={() => dm.go(dm.index + 1)}
    onrefresh={() => void dm.refresh()}
    ontoggle={() => (dm.expanded = !dm.expanded)}
    {onclose}
  />
  <div class="dm-body" class:dim={dm.refreshing}>
    {#if dm.unchanged}
      <div class="dm-empty">{t('diff.unchanged')}</div>
    {:else}
      <DiffCode lines={dm.lines} colors={dm.colors} width={dm.width} revision={dm.revision} />
    {/if}
  </div>
</ViewerModal>
