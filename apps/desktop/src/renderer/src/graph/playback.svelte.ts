import type { GraphScenario } from '@skaro/core/graph-view';
export type PlaybackPhase = 'idle' | 'playing' | 'paused' | 'completed' | 'invalidated' | 'error';

export class ScenarioPlayback {
  scenario = $state.raw<GraphScenario>();
  phase = $state<PlaybackPhase>('idle');
  index = $state(0);
  progress = $state(0);
  speed = $state(1);
  readonly duration = 2200;
  get step() {
    return this.scenario?.steps[this.index];
  }
  load(scenario: GraphScenario, saved?: { step: number; speed: number }): void {
    this.scenario = scenario;
    this.index = saved ? Math.max(0, Math.min(scenario.steps.length - 1, saved.step)) : 0;
    this.speed = saved && [0.5, 1, 2].includes(saved.speed) ? saved.speed : 1;
    this.progress = 0;
    this.phase = scenario.diagnostics.length || !scenario.steps.length ? 'error' : 'paused';
  }
  play(): void {
    if (!this.scenario || ['invalidated', 'error'].includes(this.phase)) return;
    if (this.phase === 'completed') {
      this.index = 0;
      this.progress = 0;
    }
    this.phase = 'playing';
  }
  pause(): void {
    if (this.phase === 'playing') this.phase = 'paused';
  }
  choose(index: number): void {
    if (
      !this.scenario ||
      ['invalidated', 'error'].includes(this.phase) ||
      index < 0 ||
      index >= this.scenario.steps.length
    )
      return;
    this.index = index;
    this.progress = 0;
    this.phase = 'paused';
  }
  tick(delta: number): void {
    if (this.phase !== 'playing' || !this.scenario) return;
    this.progress = Math.min(1, this.progress + (Math.max(0, delta) * this.speed) / this.duration);
    if (this.progress < 1) return;
    if (this.index === this.scenario.steps.length - 1) this.phase = 'completed';
    else {
      this.index++;
      this.progress = 0;
    }
  }
  invalidate(): void {
    if (this.scenario) this.phase = 'invalidated';
  }
  close(): void {
    this.phase = 'idle';
    this.scenario = undefined;
    this.index = 0;
    this.progress = 0;
  }
}
