import { expect, it } from 'vitest';
import { CompletionFixture } from './completion-test-support';

it('drains the real startup head scan before closing the completion service', async () => {
  const fixture = await CompletionFixture.create();
  const git = fixture.context.git;
  const head = git.head.bind(git);
  const heads: Promise<string>[] = [];
  let active = 0;
  let started!: () => void;
  const scanning = new Promise<void>((resolve) => {
    started = resolve;
  });
  // Observe real Git operations without replacing their results or transport.
  git.head = (...args) => {
    active++;
    const work = head(...args).finally(() => active--);
    heads.push(work);
    started();
    return work;
  };
  try {
    fixture.coordinator.start();
    await scanning;
    await fixture.coordinator.close();
    expect(active).toBe(0);
    expect(fixture.errors).toEqual([]);
  } finally {
    await Promise.allSettled(heads);
    await fixture.close();
  }
});
