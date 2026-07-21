/**
 * Guards the declared React floor.
 *
 * `peerDependencies` claims `react >=16.14.0`, but the dev install is React 18 and
 * `@testing-library/react@16` requires 18+, so no test in this suite actually executes
 * against 16 or 17. That gap is not closable cheaply: covering it properly means a second
 * devDependency tree and a CI matrix.
 *
 * What it *is* cheap to catch is the failure that gap would hide — someone importing a
 * React API that does not exist in 16.14, CI staying green on 18, and consumers on the
 * declared floor breaking at bundle time. That is a static property of the source, so this
 * checks it statically: every name imported from `react` must be on a list that was
 * checked against 16.14 by hand.
 *
 * The list is deliberately the library's *actual* usage, not React 16.14's full export
 * surface. A new import fails here until someone consciously adds it, which is the moment
 * to confirm it exists in 16.14 — or to raise the floor and say so in DECISIONS.md.
 *
 * @packageDocumentation
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every name the library may import from `react`, all present in 16.14.0.
 *
 * Adding to this list is a deliberate act: check the name against React 16.14 first.
 * Notable absences, all React 18+, all of which would silently break the floor:
 * `useSyncExternalStore`, `useId`, `useTransition`, `useDeferredValue`,
 * `useInsertionEffect`, and `use`.
 */
const ALLOWED_REACT_IMPORTS: ReadonlySet<string> = new Set([
  // Hooks — all present since 16.8.
  'useCallback',
  'useEffect',
  'useMemo',
  'useRef',
  'useState',
  // Types. Imported by name rather than reached through the `React` UMD global, so the
  // emitted .d.ts does not depend on the consumer's ambient @types/react shape — see
  // DECISIONS.md §7.
  'CSSProperties',
  'MouseEvent',
  'ReactElement',
  'RefObject',
]);

// Not `import.meta.url`: the jsdom environment makes that an http: URL. Vitest runs from
// the project root, and the "finds source files" assertion below catches a wrong path.
const SRC_DIR = join(process.cwd(), 'src');

/** Recursive walk. `readdirSync(..., { recursive: true })` is Node 20+; CI still runs 18. */
function sourceFiles(dir: string): readonly string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
    } else if (path.endsWith('.ts') || path.endsWith('.tsx')) {
      out.push(path);
    }
  }
  return out;
}

/** One `import ... from '<module>'` statement. */
interface ImportStatement {
  readonly module: string;
  /** The clause between `import` and `from`. */
  readonly clause: string;
}

const IMPORT_RE = /import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;

function importsIn(source: string): readonly ImportStatement[] {
  const out: ImportStatement[] = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const clause = match[1];
    const module = match[2];
    if (clause !== undefined && module !== undefined) out.push({ clause, module });
  }
  return out;
}

/**
 * The names bound by an import clause.
 *
 * Handles `import type { A }`, `import { a, type B }`, and `c as d` — the alias is
 * dropped, since what matters is the name React has to export, not the local one.
 */
function boundNames(clause: string): readonly string[] {
  const braces = /\{([\s\S]*)\}/.exec(clause);
  if (!braces?.[1]) return [];

  return braces[1]
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const withoutTypeModifier = part.replace(/^type\s+/, '');
      const original = withoutTypeModifier.split(/\s+as\s+/)[0];
      return original?.trim() ?? '';
    })
    .filter((name) => name.length > 0);
}

describe('React floor (peerDependencies: >=16.14.0)', () => {
  const files = sourceFiles(SRC_DIR);

  it('finds source files to check', () => {
    // A broken walk would make every assertion below vacuously pass.
    expect(files.length).toBeGreaterThan(10);
  });

  it('imports only React APIs that exist in 16.14.0', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const statement of importsIn(source)) {
        if (statement.module !== 'react') continue;
        for (const name of boundNames(statement.clause)) {
          if (!ALLOWED_REACT_IMPORTS.has(name)) {
            offenders.push(`${file.slice(SRC_DIR.length + 1)}: ${name}`);
          }
        }
      }
    }

    expect(
      offenders,
      `Imported from 'react' but not on the 16.14-checked allowlist:\n  ${offenders.join('\n  ')}\n\n` +
        'If the name does exist in React 16.14, add it to ALLOWED_REACT_IMPORTS. If it does not, ' +
        'either avoid it or raise the floor in package.json and record why in DECISIONS.md.',
    ).toEqual([]);
  });

  it('does not reach for the React UMD global or the global JSX namespace', () => {
    // These resolve against whatever @types/react the consumer has rather than an import
    // we control. @types/react@19 dropped the global JSX namespace, which broke React 19
    // consumers compiling with skipLibCheck:false — see DECISIONS.md §7.
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
      if (/\bReact\.[A-Z]/.test(withoutComments) || /\bJSX\.[A-Z]/.test(withoutComments)) {
        offenders.push(file.slice(SRC_DIR.length + 1));
      }
    }

    expect(
      offenders,
      `Use a named type import from 'react' instead (e.g. ReactElement, not JSX.Element):\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('never imports react-dom, which is not a declared peer dependency', () => {
    const offenders = files.filter((file) =>
      importsIn(readFileSync(file, 'utf8')).some((s) => s.module.startsWith('react-dom')),
    );

    expect(offenders.map((f) => f.slice(SRC_DIR.length + 1))).toEqual([]);
  });
});
