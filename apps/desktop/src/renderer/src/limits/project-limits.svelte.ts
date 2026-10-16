import type { AgentLimits } from '@skaro/timeline';
import type { AgentId } from '../../../shared/ipc';
import { lowRemaining } from './low-remaining';

/** Watches only the default agent of this project, even while its modal is closed. */
export class ProjectLimits {
  snapshot = $state<AgentLimits>();
  remaining = $derived(lowRemaining(this.snapshot));
  private agent: AgentId | undefined;
  private settingsGeneration = 0;
  private quotaGeneration = 0;
  private disposed = false;
  private refreshRequested = false;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly stop: () => void;
  private readonly projectId: string;

  constructor(projectId: string) {
    this.projectId = projectId;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), 3 * 60_000);
    this.stop = window.skaro.on('project.changed', ({ projectId }) => {
      if (projectId === this.projectId) void this.refresh(false);
    });
  }

  private async refresh(force = true): Promise<void> {
    this.refreshRequested ||= force;
    const settingsGeneration = ++this.settingsGeneration;
    try {
      const settings = await window.skaro.invoke('project.settings', this.projectId);
      if (this.disposed || settingsGeneration !== this.settingsGeneration) return;
      const changed = this.agent !== settings.defaultAgent;
      if (changed) {
        this.agent = settings.defaultAgent;
        this.snapshot = undefined;
        this.quotaGeneration++;
      }
      if (!this.refreshRequested && !changed) return;
      this.refreshRequested = false;
      const quotaGeneration = ++this.quotaGeneration;
      try {
        const snapshot = await window.skaro.invoke('agents.limits', settings.defaultAgent);
        if (!this.disposed && quotaGeneration === this.quotaGeneration) this.snapshot = snapshot;
      } catch {
        if (!this.disposed && quotaGeneration === this.quotaGeneration) this.snapshot = undefined;
      }
    } catch {
      if (!this.disposed && settingsGeneration === this.settingsGeneration) {
        this.quotaGeneration++;
        this.snapshot = undefined;
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.settingsGeneration++;
    this.quotaGeneration++;
    clearInterval(this.timer);
    this.stop();
  }
}
