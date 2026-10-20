import { net, protocol } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { within, readImage } from './files';
import { projectRecords } from './project-records';
import type { Services } from './app-services';

export function registerMedia({ attachments, dataDir, db }: Services, picked: Set<string>): void {
  const imageAllowed = async (abs: string): Promise<boolean> => {
    if (picked.has(abs) || within(attachments.dir, abs) || within(join(dataDir, 'worktrees'), abs))
      return true;
    for await (const project of projectRecords(db)) if (within(project.path, abs)) return true;
    return false;
  };

  protocol.handle('skaro-media', async (request) => {
    const url = new URL(request.url);
    if (url.hostname === 'attachment') {
      const [id, ext] = url.pathname.slice(1).split('.');
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext ?? 'png'}`;
      try {
        return await net.fetch(pathToFileURL(attachments.file({ id: id ?? '', mime })).href);
      } catch {
        return new Response(null, { status: 404 });
      }
    }
    if (url.hostname === 'file') {
      const image = await readImage(url.searchParams.get('path') ?? '', imageAllowed);
      if (!image) return new Response(null, { status: 404 });
      return new Response(new Uint8Array(image.bytes), {
        headers: { 'Content-Type': image.mime },
      });
    }
    return new Response(null, { status: 404 });
  });
}
