/** Pure redaction shared with native session workers; no platform credential-store dependency. */
export class SecretValues {
  private readonly values = new Set<string>();
  remember(values: string[]): void {
    for (const value of values) if (value) this.values.add(value);
  }
  list(): string[] {
    return [...this.values];
  }
  redact<T>(value: T): T {
    if (!this.values.size) return value;
    const visit = (part: unknown): unknown => {
      if (typeof part === 'string') {
        for (const secret of this.values) part = (part as string).replaceAll(secret, '•••');
        return part;
      }
      if (Array.isArray(part)) return part.map(visit);
      if (part && typeof part === 'object')
        return Object.fromEntries(Object.entries(part).map(([key, entry]) => [key, visit(entry)]));
      return part;
    };
    return visit(value) as T;
  }
}
