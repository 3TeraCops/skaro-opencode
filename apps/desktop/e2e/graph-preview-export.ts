import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

/** Export the real native shell DOM and styles; only the graph remains interactive offline. */
export async function exportGraphPreview(
  page: Page,
  root: string,
  destination: string,
): Promise<string> {
  const capture = await page.evaluate(() => {
    const shell = document.querySelector('.app')!.cloneNode(true) as HTMLElement;
    const graph = shell.querySelector('[data-project-graph], [data-graph-preview]')!;
    const mount = document.createElement('div');
    mount.id = 'graph-export';
    mount.style.cssText = 'display:flex;flex:1;min-height:0;min-width:0';
    graph.replaceWith(mount);
    for (const script of shell.querySelectorAll('script')) script.remove();
    return {
      shell: shell.outerHTML,
      styles: Array.from(document.styleSheets).flatMap((sheet) => (sheet.href ? [sheet.href] : [])),
    };
  });
  const css: string[] = [];
  for (const href of capture.styles) {
    const path = fileURLToPath(href);
    let text = await readFile(path, 'utf8');
    const assets = [...text.matchAll(/url\((['"]?)([^)'"\s]+)\1\)/g)];
    for (const asset of assets) {
      if (asset[2]!.startsWith('data:')) continue;
      const file = resolve(dirname(path), asset[2]!);
      const data = await readFile(file);
      const mime = file.endsWith('.woff2') ? 'font/woff2' : 'image/svg+xml';
      text = text.replace(asset[0], () => `url(data:${mime};base64,${data.toString('base64')})`);
    }
    css.push(text);
  }
  const compiled = resolve(__dirname, '../../../output/graph-preview-export');
  let runtime = await readFile(join(compiled, 'preview.js'), 'utf8');
  const workerFiles = [...runtime.matchAll(/new Worker\("([^"]+\.js)"/g)];
  for (const worker of workerFiles) {
    const source = await readFile(join(compiled, worker[1]!.replace(/^\//, '')), 'utf8');
    runtime = runtime.replace(
      `"${worker[1]}"`,
      () => `URL.createObjectURL(new Blob([${JSON.stringify(source)}],{type:"text/javascript"}))`,
    );
  }
  css.push(await readFile(join(compiled, 'desktop.css'), 'utf8'));
  const model = (await readFile(join(root, '.skaro/c4/model.json'), 'utf8')).replace(
    /</g,
    '\\u003c',
  );
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chatballs · Skaro · автономное визуальное превью</title><style>${css.join('\n')}</style><body>${capture.shell}<script id="accepted-c4-source" type="application/json">${model}</script><script>${runtime.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
  const output = join(destination, 'chatballs-graph.html');
  await writeFile(output, html, 'utf8');
  return output;
}
