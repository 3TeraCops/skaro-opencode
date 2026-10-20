import { protocol } from 'electron';
import type { AppState } from './state';

/** Logo reads are bounded by the existing one-megabyte project-logo limit. */
export function registerProjectLogos(state: AppState): void {
  protocol.handle('skaro-logo', (request) => {
    const url = new URL(request.url);
    const id = url.pathname.slice(1);
    if (url.hostname !== 'project' || !/^[\w-]+$/.test(id))
      return new Response(null, { status: 404 });
    const data = state.db.shell.logo(id);
    const image = data && /^data:(image\/[\w+.-]+);base64,([\s\S]+)$/.exec(data);
    if (!image) return new Response(null, { status: 404 });
    return new Response(Buffer.from(image[2]!, 'base64'), {
      headers: { 'Content-Type': image[1]!, 'Cache-Control': 'no-store' },
    });
  });
}
