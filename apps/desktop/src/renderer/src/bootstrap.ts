import type { BootstrapState } from '../../shared/ipc-sessions';

/** Read once before importing views; reloading fetches the current workspace from main. */
export let bootstrap: BootstrapState | undefined;

export async function loadBootstrap(): Promise<void> {
  bootstrap = await (window.skaro.bootstrapReady ?? window.skaro.bootstrap);
}
