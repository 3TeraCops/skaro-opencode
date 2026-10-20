/** Local timing distinguishes a painted conversation from a shell or loading placeholder. */
export function historyPaint(ready: () => boolean): void {
  let painted = false;
  $effect(() => {
    if (painted || !ready()) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        painted = true;
        performance.clearMarks('skaro.history.content');
        performance.mark('skaro.history.content');
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  });
}
