<script lang="ts">
  /** The existing dashed circle of the task status chip, including «В очереди». */
  let { size = 11 }: { size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  aria-hidden="true"
>
  <circle cx="12" cy="12" r="8" stroke-dasharray="3 3" />
</svg>
