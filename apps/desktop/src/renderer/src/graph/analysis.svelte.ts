import type { GraphPage } from '@skaro/core/graph-view';
import type { ProjectGraph } from './data.svelte';
export class GraphAnalysis {
  from = $state('');
  target = $state('');
  fromName = $state('');
  targetName = $state('');
  depth = $state(12);
  direction = $state<'out' | 'both'>('out');
  busy = $state(false);
  result = $state.raw<GraphPage>();
  private readonly model: ProjectGraph;
  constructor(model: ProjectGraph) {
    this.model = model;
  }
  async path(): Promise<void> {
    if (!this.from || !this.target) return;
    this.busy = true;
    try {
      this.result = await this.model.path(this.from, this.target, this.direction, this.depth);
    } catch (error) {
      this.model.error = String(error);
    } finally {
      this.busy = false;
    }
  }
  async impact(id: string): Promise<void> {
    this.busy = true;
    try {
      this.result = await this.model.impact(id, this.depth);
    } catch (error) {
      this.model.error = String(error);
    } finally {
      this.busy = false;
    }
  }
  clear(): void {
    this.result = undefined;
    this.model.highlighted = [];
  }
}
