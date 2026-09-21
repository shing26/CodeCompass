import type { LanguageAdapter } from './LanguageAdapter';
import { JavaAdapter } from './JavaAdapter';
import { TypeScriptAdapter } from './TypeScriptAdapter';
import { GoAdapter } from './GoAdapter';
import { PythonAdapter } from './PythonAdapter';
import { PrismaAdapter } from './PrismaAdapter';
import {
  GO_EXTENSIONS,
  JAVA_EXTENSIONS,
  PRISMA_EXTENSIONS,
  PYTHON_EXTENSIONS,
  TYPESCRIPT_EXTENSIONS
} from './language-extensions';

/**
 * Issue 09 (外部评审 C2) — the wiring table for languages.
 *
 * Adding a language is now exactly two edits, both inside `src/languages/`:
 * declare its extensions in `language-extensions.ts`, wire it here. Missing
 * either side fails the registry tests loudly instead of silently dropping
 * files from the index — which is what the previous five hand-maintained
 * tables did (the scan-side set and the adapters could fork with no error).
 *
 * The scan-side `SOURCE_EXTENSIONS` and `adapterFor` are DERIVED below; they
 * must not be redefined anywhere else.
 */
export interface LanguageRegistration {
  /** Stable language id; doubles as the ParseContext key (parse-context.ts). */
  id: 'java' | 'typescript' | 'go' | 'python' | 'prisma';
  /** Extensions this language owns — the same arrays its adapter's canParse reads. */
  extensions: readonly string[];
  adapter: LanguageAdapter;
}

export const LANGUAGE_REGISTRY: readonly LanguageRegistration[] = [
  { id: 'java', extensions: JAVA_EXTENSIONS, adapter: JavaAdapter },
  { id: 'typescript', extensions: TYPESCRIPT_EXTENSIONS, adapter: TypeScriptAdapter },
  { id: 'go', extensions: GO_EXTENSIONS, adapter: GoAdapter },
  { id: 'python', extensions: PYTHON_EXTENSIONS, adapter: PythonAdapter },
  { id: 'prisma', extensions: PRISMA_EXTENSIONS, adapter: PrismaAdapter }
];

/** Derived: every extension any registered language owns. */
export const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set(
  LANGUAGE_REGISTRY.flatMap((entry) => entry.extensions)
);

/** Derived: the adapter owning `filePath`, or undefined for foreign files. */
export function adapterFor(filePath: string): LanguageAdapter | undefined {
  return LANGUAGE_REGISTRY.find((entry) => entry.adapter.canParse(filePath))?.adapter;
}
