/** Existing specification requirement syntax, projected without sending its whole document. */
export function requirementsOf(body: string | undefined): {
  requirements?: { id: string; text: string }[];
} {
  const list = [...(body ?? '').matchAll(/^\s*[-*]\s+(R-\d+)[\s:.—–-]+(.+)$/gm)].map((match) => ({
    id: match[1]!,
    text: match[2]!.trim(),
  }));
  return list.length ? { requirements: list } : {};
}
