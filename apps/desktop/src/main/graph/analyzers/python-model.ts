import type { SourceRef } from '@skaro/core/graph-view';
import type { SourceFile } from '../facts';
export interface PyDeclaration {
  id: string;
  name: string;
  qualified: string;
  scope: string[];
  kind: 'function' | 'class' | 'constant';
  ref: SourceRef;
  bases: string[];
  value?: string;
}
export interface PyImport {
  local: string;
  module: string;
  imported?: string;
  scope: string[];
  ref: SourceRef;
}
export interface PyCall {
  expression: string;
  owner: string;
  scope: string[];
  ref: SourceRef;
  args: { expression: string; literal?: string; keyword?: string }[];
  assigned?: string;
  handler?: string;
}
export interface PyDocument {
  file: SourceFile;
  module: string;
  declarations: PyDeclaration[];
  imports: PyImport[];
  calls: PyCall[];
  references: { name: string; scope: string[]; owner: string; ref: SourceRef }[];
  bindings: { name: string; scope: string[] }[];
  errors: boolean;
}
