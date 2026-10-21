import ts from 'typescript';
import { dirname, resolve } from 'node:path';
import { parse } from 'svelte/compiler';
import { slash } from '../source-policy';
import type { SourceFile } from '../facts';

export interface TsInput {
  file: SourceFile;
  name: string;
  source: ts.SourceFile;
  template?: unknown;
}
const syntaxCache = new Map<string, { hash: string; input: TsInput }>();
const programCache = new Map<string, ts.Program>();
export function inputs(
  root: string,
  files: SourceFile[],
  diagnostic: (path: string, message: string) => void,
): TsInput[] {
  if (syntaxCache.size > 4000) syntaxCache.clear();
  return files
    .filter((file) => ['typescript', 'svelte'].includes(file.language))
    .flatMap((file) => {
      const cacheKey = `${root}\0${file.path}`,
        cached = syntaxCache.get(cacheKey);
      if (cached?.hash === file.hash) return [{ ...cached.input, file }];
      let text = file.text,
        template: unknown;
      if (file.language === 'svelte') {
        try {
          const ast = parse(text);
          template = ast.html;
          const scripts = [ast.instance?.content, ast.module?.content].filter(Boolean);
          // Keep original UTF-16 offsets; no generated code is indexed as a source declaration.
          text = text.replace(/[^\r\n]/g, ' ');
          for (const script of scripts) {
            const part = script as { start: number; end: number };
            text =
              text.slice(0, part.start) +
              file.text.slice(part.start, part.end) +
              text.slice(part.end);
          }
        } catch (error) {
          diagnostic(file.path, String(error));
          return [];
        }
      }
      const name = slash(resolve(root, file.path + (file.language === 'svelte' ? '.ts' : '')));
      const kind = /\.[jt]sx$/.test(file.path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
      const input: TsInput = {
        file,
        name,
        source: ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, kind),
        template,
      };
      syntaxCache.set(cacheKey, { hash: file.hash, input });
      return [input];
    });
}
export function programs(root: string, files: SourceFile[], entries: TsInput[]): ts.Program[] {
  const sources = new Map(entries.map((input) => [slash(input.name), input.source]));
  const content = new Map(files.map((file) => [slash(resolve(root, file.path)), file.text]));
  const configs = files.filter((file) => /(^|\/)tsconfig(?:\.[^/]+)?\.json$/.test(file.path));
  const groups = new Map<string, { options: ts.CompilerOptions; roots: string[] }>();
  const getFile = (path: string) => content.get(slash(resolve(path)));
  const directories = new Set(
    [...content.keys()].flatMap((path) => {
      const result: string[] = [];
      let directory = dirname(path);
      while (directory.length >= root.length) {
        result.push(slash(directory));
        const parent = dirname(directory);
        if (parent === directory) break;
        directory = parent;
      }
      return result;
    }),
  );
  for (const input of entries) {
    const config = configs
      .filter((file) =>
        input.file.path.startsWith(
          file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/') + 1) : '',
        ),
      )
      .sort(
        (a, b) =>
          b.path.split('/').length - a.path.split('/').length ||
          Number(!a.path.endsWith('tsconfig.json')) - Number(!b.path.endsWith('tsconfig.json')),
      )[0];
    const key = config?.path ?? '';
    let group = groups.get(key);
    if (!group) {
      const base: ts.CompilerOptions = {
        allowJs: true,
        checkJs: true,
        noLib: true,
        noEmit: true,
        target: ts.ScriptTarget.Latest,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        jsx: ts.JsxEmit.Preserve,
      };
      if (config) {
        const result = ts.parseConfigFileTextToJson(resolve(root, config.path), config.text);
        if (!result.error) {
          const parsed = ts.parseJsonConfigFileContent(
            result.config,
            {
              useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
              readDirectory: () => [],
              fileExists: (file) => content.has(slash(resolve(file))),
              readFile: getFile,
            },
            dirname(resolve(root, config.path)),
          );
          Object.assign(base, parsed.options, {
            plugins: [],
            noLib: true,
            noEmit: true,
            allowJs: true,
          });
        }
      }
      groups.set(key, (group = { options: base, roots: [] }));
    }
    group.roots.push(input.name);
  }
  return [...groups.values()].map(({ options, roots }) => {
    const host: ts.CompilerHost = {
      getSourceFile: (name) => sources.get(slash(resolve(name))),
      getDefaultLibFileName: () => '',
      writeFile: () => undefined,
      getCurrentDirectory: () => root,
      getDirectories: () => [],
      getCanonicalFileName: (name) =>
        ts.sys.useCaseSensitiveFileNames ? name : name.toLowerCase(),
      useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
      getNewLine: () => '\n',
      fileExists: (name) => sources.has(slash(resolve(name))) || content.has(slash(resolve(name))),
      readFile: (name) => sources.get(slash(resolve(name)))?.text ?? getFile(name),
      directoryExists: (name) => directories.has(slash(resolve(name))),
      realpath: (name) => name,
    };
    const key = `${root}\0${JSON.stringify(options)}\0${roots.join('\0')}`;
    const previous = programCache.get(key);
    const program = ts.createProgram({
      rootNames: roots,
      options,
      host,
      ...(previous ? { oldProgram: previous } : {}),
    });
    if (programCache.size > 8) programCache.clear();
    programCache.set(key, program);
    return program;
  });
}
