import type { Facts, SourceFile } from '../facts';

/** Declared dependencies are metadata; they never assert imports or runtime loading. */
export function analyzePackages(
  files: SourceFile[],
  facts: Facts,
  diagnostic: (path: string, message: string) => void,
): void {
  for (const file of files.filter((file) => /(^|\/)package\.json$/.test(file.path))) {
    try {
      const manifest = JSON.parse(file.text) as Record<string, unknown>;
      const name = typeof manifest.name === 'string' ? manifest.name : file.path;
      const id = `package:${file.path}`;
      facts.node({
        id,
        kind: 'package',
        name,
        origin: 'extracted-code',
        sources: [facts.ref(file)],
        attributes: { language: 'package-json', manifest: true },
      });
      facts.edge(
        `file:${file.path}`,
        id,
        'contains',
        facts.ref(file),
        'package/declaration',
        'Explicit package manifest declaration',
        'extracted-code',
        'explicit',
      );
      for (const section of [
        'dependencies',
        'devDependencies',
        'peerDependencies',
        'optionalDependencies',
      ]) {
        const dependencies = manifest[section];
        if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies))
          continue;
        for (const dependency of Object.keys(dependencies)) {
          if (!/^@?[a-z\d][a-z\d._/-]{0,200}$/i.test(dependency)) continue;
          const target = `package:${file.path}:${dependency}`;
          facts.node({
            id: target,
            kind: 'package',
            name: dependency,
            origin: 'extracted-code',
            sources: [facts.ref(file)],
            attributes: { language: 'package-json', external: true, section },
          });
          facts.edge(
            id,
            target,
            'depends-on',
            facts.ref(file),
            `package/${section}`,
            `Explicit ${section} entry; installation, import and runtime loading are not asserted`,
            'extracted-code',
            'explicit',
          );
        }
      }
    } catch (error) {
      diagnostic(file.path, String(error));
    }
  }
}
