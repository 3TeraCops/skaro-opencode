import { t } from '@skaro/ui';
export const kinds = [
  'architecture',
  'instance',
  'file',
  'symbol',
  'endpoint',
  'event',
  'model',
  'service',
  'document',
  'requirement',
  'task',
  'milestone',
  'package',
] as const;
export const edgeKinds = [
  'contains',
  'imports',
  'exports',
  'references',
  'calls',
  'inherits',
  'implements',
  'handles',
  'requests',
  'emits',
  'consumes',
  'reads',
  'writes',
  'model-relation',
  'deploys',
  'depends-on',
  'documents',
  'covers',
  'governed-by',
  'implements-requirement',
  'interacts',
] as const;
export const origins = [
  'accepted-c4',
  'extracted-code',
  'extracted-document',
  'analyzer-inferred',
] as const;
export const resolutions = ['explicit', 'resolved', 'inferred', 'unresolved'] as const;
export function options(values: readonly string[], prefix: string) {
  return values.map((value) => ({ value, label: t(`${prefix}.${value}`) }));
}
