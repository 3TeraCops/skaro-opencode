export interface TextFont {
  family: string;
  source: string;
  descriptors: FontFaceDescriptors;
}
export interface TextMetricsStyle {
  font: string;
  tabSize: string;
  faces: TextFont[];
}

/** Reuse the actual bundled font faces; a worker's FontFaceSet is separate from the document's. */
export function textMetricsStyle(node: HTMLElement): TextMetricsStyle {
  const style = getComputedStyle(node);
  const families = style.fontFamily
    .split(',')
    .map((family) => family.trim().replace(/^['"]|['"]$/g, ''));
  const faces: TextFont[] = [];
  const visit = (rules: CSSRuleList, base: string) => {
    for (const rule of rules) {
      if (rule instanceof CSSFontFaceRule) {
        const css = rule.style;
        const family = css.getPropertyValue('font-family').replace(/^['"]|['"]$/g, '');
        if (!families.includes(family)) continue;
        const source = css
          .getPropertyValue('src')
          .replace(
            /url\(["']?([^"')]+)["']?\)/g,
            (_, path: string) => `url("${new URL(path, base).href}")`,
          );
        faces.push({
          family,
          source,
          descriptors: {
            weight: css.getPropertyValue('font-weight') || 'normal',
            style: css.getPropertyValue('font-style') || 'normal',
            unicodeRange: css.getPropertyValue('unicode-range') || 'U+0-10FFFF',
          },
        });
      } else if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules, base);
    }
  };
  for (const sheet of document.styleSheets) visit(sheet.cssRules, sheet.href ?? document.baseURI);
  return {
    font: `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
    tabSize: style.tabSize,
    faces,
  };
}

/** Canvas work can be large even for one line, so run it only in the worker. */
export async function workerTextMetrics(style: TextMetricsStyle) {
  const scope = self as unknown as { fonts: FontFaceSet };
  await Promise.all(
    style.faces.map(async ({ family, source, descriptors }) => {
      const face = new FontFace(family, source, descriptors);
      scope.fonts.add(await face.load());
    }),
  );
  const context = new OffscreenCanvas(1, 1).getContext('2d');
  if (!context) throw new Error('Text measurement context is unavailable');
  context.font = style.font;
  const space = context.measureText(' ').width;
  const tab = Number.parseFloat(style.tabSize) * (style.tabSize.endsWith('px') ? 1 : space);
  return (text: string) => {
    let width = 0;
    for (const [index, part] of text.split('\t').entries()) {
      if (index) width = (Math.floor(width / tab) + 1) * tab;
      width += context.measureText(part).width;
    }
    return width;
  };
}
