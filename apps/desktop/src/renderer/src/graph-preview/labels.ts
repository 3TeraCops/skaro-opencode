import type { NodeDisplayData } from 'sigma/types';

export function drawLabel(
  context: CanvasRenderingContext2D,
  node: Pick<NodeDisplayData, 'label' | 'x' | 'y' | 'color' | 'size'>,
): void {
  if (!node.label) return;
  const words = node.label.split(' '),
    lines: string[] = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > 26 && line) {
      lines.push(line);
      line = word;
    } else line = (line + ' ' + word).trim();
  }
  if (line) lines.push(line);
  context.font = (node.size > 9 ? '600 ' : '400 ') + '11px "Nunito Sans Variable", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'top';
  const visible = lines.slice(0, 2);
  if (lines.length > 2) visible[1] = visible[1]!.slice(0, 24) + '…';
  const width = Math.max(...visible.map((text) => context.measureText(text).width)) + 8;
  const y = node.y + node.size + 6;
  context.fillStyle = '#171717e8';
  context.beginPath();
  context.roundRect(node.x - width / 2, y - 2, width, visible.length * 14 + 3, 3);
  context.fill();
  context.fillStyle = node.size > 9 ? '#d5d5d5' : '#a1a1a1';
  visible.forEach((text, i) => context.fillText(text, node.x, y + i * 14));
}
