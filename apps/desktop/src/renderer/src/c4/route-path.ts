/** Round ELK's orthogonal corners without moving any semantic endpoint. */
export function routePath(points: { x: number; y: number }[] = []): string {
  if (!points.length) return '';
  let path = `M${points[0]!.x},${points[0]!.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]!,
      b = points[i]!,
      c = points[i + 1]!;
    const incoming = Math.hypot(b.x - a.x, b.y - a.y),
      outgoing = Math.hypot(c.x - b.x, c.y - b.y);
    const radius = Math.min(8, incoming / 2, outgoing / 2);
    if (!incoming || !outgoing) continue;
    path += `L${b.x + ((a.x - b.x) * radius) / incoming},${b.y + ((a.y - b.y) * radius) / incoming}`;
    path += `Q${b.x},${b.y} ${b.x + ((c.x - b.x) * radius) / outgoing},${b.y + ((c.y - b.y) * radius) / outgoing}`;
  }
  const end = points.at(-1)!;
  return `${path}L${end.x},${end.y}`;
}
