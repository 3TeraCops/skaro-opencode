<script lang="ts">
  import type { NumberedLine } from './diff-model';
  import type { Segment } from './diff-highlight';
  import WindowedContent from '../WindowedContent.svelte';

  let {
    lines,
    colors,
    width,
    revision,
  }: {
    lines: NumberedLine[] | undefined;
    colors: (Segment[] | undefined)[] | undefined;
    width: number;
    revision: number;
  } = $props();
  async function read(start: number) {
    return (lines?.slice(start, start + 16) ?? []).map((line, offset) => ({
      id: String(start + offset),
      line,
      colors: colors?.[start + offset],
    }));
  }
</script>

<div class="dm-lines" style="min-width: max(100%, calc(144px + {width}ch))">
  <WindowedContent
    count={lines?.length ?? 1}
    {revision}
    identity="diff"
    {read}
    scroller=".dm-body"
    gap={0}
    estimate={20}
    copyText={() => (lines ?? []).map((line) => line.text).join('\n')}
  >
    {#snippet children({ line, colors })}
      {#if line.kind === 'hunk'}
        <div class="dm-hunk"><span class="dm-hunk-pad"></span><span>{line.text}</span></div>
      {:else}
        <div class="dm-row {line.kind}">
          <span class="dm-num">{line.old ?? ''}</span>
          <span class="dm-num">{line.new ?? ''}</span>
          <span class="dm-sign">{line.sign}</span>
          <span class="dm-code"
            >{#if colors}{#each colors as seg, s (s)}<span style:color={seg.color}>{seg.text}</span
                >{/each}{:else}{line.text}{/if}</span
          >
        </div>
      {/if}
    {/snippet}
  </WindowedContent>
</div>
