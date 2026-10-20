import type { AgentAdapter, SessionOptions } from '@skaro/timeline';
import { startNativeSession } from './client';
import type { NativeConfig } from './protocol';

/** Account, login and metadata stay on the original adapter, including shared auth invalidation. */
export function nativeAdapter(
  adapter: AgentAdapter,
  config: () => Promise<NativeConfig>,
): AgentAdapter {
  return new Proxy(adapter, {
    get: (target, key: keyof AgentAdapter) => {
      if (key === 'start')
        return async (options: SessionOptions) => startNativeSession(await config(), options);
      const value = target[key];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
