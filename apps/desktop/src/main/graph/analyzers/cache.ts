export interface AnalysisCache {
  read<T>(path: string, hash: string): T | undefined;
  write(path: string, hash: string, facts: unknown): void;
  reused(): void;
}
