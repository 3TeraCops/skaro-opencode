/** Estimate retained text and graph storage in the worker; never walk a large project on main. */
export function artifactBytes(value: unknown): number {
  if (typeof value === 'string') return 24 + value.length * 2;
  if (Array.isArray(value))
    return 32 + value.reduce((sum, item) => sum + 8 + artifactBytes(item), 0);
  if (value && typeof value === 'object') {
    let bytes = 48;
    for (const [key, item] of Object.entries(value))
      bytes += key.length * 2 + 16 + artifactBytes(item);
    return bytes;
  }
  return 8;
}
