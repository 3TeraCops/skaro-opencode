import type ts from 'typescript';
import type { SourceRef } from '@skaro/core/graph-view';
import type { SourceFile } from '../facts';
export interface TsContext {
  source: ts.SourceFile;
  file: SourceFile;
  checker: ts.TypeChecker;
  symbolId(node: ts.Node): string | undefined;
  owner(node: ts.Node): string;
  ref(node: ts.Node): SourceRef;
}
