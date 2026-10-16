import type { EnvironmentRecord } from './task-environment-registry';

/** Only an allocated loopback port can identify this task's services. */
export function environmentLink(record: EnvironmentRecord, value: string): string | undefined {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Only web links open externally.');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return;
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  return (
    Object.entries(record.ports).find(([, allocated]) => allocated === port)?.[0] ??
    Object.entries(record.previousPorts ?? {}).find(([, ports]) => ports.includes(port))?.[0]
  );
}

/** A stopped service may have lost its old port; preserve the requested route on its new port. */
export function environmentLinkAddress(value: string, port: number): string {
  const url = new URL(value);
  url.port = String(port);
  return url.href;
}
