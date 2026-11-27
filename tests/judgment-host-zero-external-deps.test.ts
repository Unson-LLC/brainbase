import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST_ENTRY = resolve(REPO_ROOT, 'dist', 'judgment-host.js');

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface ModuleGraphResult {
  visitedFiles: string[];
  externalSpecifiers: Array<{ file: string; kind: string; specifier: string }>;
}

function collectRuntimeModuleGraph(entryFile: string): ModuleGraphResult {
  const visited = new Set<string>();
  const externalSpecifiers: Array<{ file: string; kind: string; specifier: string }> = [];

  function walk(filePath: string): void {
    const absolutePath = resolve(filePath);
    if (visited.has(absolutePath)) return;
    visited.add(absolutePath);

    const sourceText = readFileSync(absolutePath, 'utf8');
    const sourceFile = ts.createSourceFile(
      absolutePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS
    );

    const inspectSpecifier = (specifier: string, kind: string): void => {
      if (specifier.startsWith('node:')) {
        return;
      }
      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        const resolvedTarget = resolve(dirname(absolutePath), specifier);
        if (!existsSync(resolvedTarget)) {
          externalSpecifiers.push({
            file: relative(REPO_ROOT, absolutePath),
            kind: `${kind}:missing-local`,
            specifier
          });
          return;
        }
        walk(resolvedTarget);
        return;
      }
      externalSpecifiers.push({
        file: relative(REPO_ROOT, absolutePath),
        kind,
        specifier
      });
    };

    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        inspectSpecifier(node.moduleSpecifier.text, 'import');
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        inspectSpecifier(node.moduleSpecifier.text, 'export');
      } else if (ts.isCallExpression(node)) {
        const firstArg = node.arguments[0];
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword && firstArg && ts.isStringLiteral(firstArg)) {
          inspectSpecifier(firstArg.text, 'dynamic-import');
        } else if (
          ts.isIdentifier(node.expression)
          && node.expression.text === 'require'
          && firstArg
          && ts.isStringLiteral(firstArg)
        ) {
          inspectSpecifier(firstArg.text, 'require');
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  walk(entryFile);

  return {
    visitedFiles: [...visited].sort(),
    externalSpecifiers
  };
}

describe('dist/judgment-host.js zero external npm dependency contract', () => {
  it('has no external npm package imports or re-exports in the recursive dist/judgment-host.js module graph', () => {
    expect(existsSync(DIST_ENTRY), `Expected built artifact at ${DIST_ENTRY}; run npm run build first.`).toBe(true);

    const graph = collectRuntimeModuleGraph(DIST_ENTRY);
    const relativeVisited = graph.visitedFiles.map((file) => relative(REPO_ROOT, file));

    expect(relativeVisited).toContain('dist/judgment-host.js');
    expect(relativeVisited).toContain('dist/judgment-task-progress.js');
    expect(graph.externalSpecifiers).toEqual([]);
  });

  it('loads dist/judgment-host.js in an isolated os.tmpdir() directory with no node_modules', async () => {
    expect(existsSync(DIST_ENTRY), `Expected built artifact at ${DIST_ENTRY}; run npm run build first.`).toBe(true);

    const graph = collectRuntimeModuleGraph(DIST_ENTRY);
    const isolatedRoot = await mkdtemp(join(tmpdir(), 'brainbase-judgment-host-isolated-'));
    tempDirs.push(isolatedRoot);

    await writeFile(
      join(isolatedRoot, 'package.json'),
      JSON.stringify({ name: 'brainbase-judgment-host-isolated', private: true, type: 'module' }, null, 2)
    );

    for (const sourcePath of graph.visitedFiles) {
      const relPath = relative(REPO_ROOT, sourcePath);
      const destinationPath = join(isolatedRoot, relPath);
      await mkdir(dirname(destinationPath), { recursive: true });
      await cp(sourcePath, destinationPath);
    }

    expect(existsSync(join(isolatedRoot, 'node_modules'))).toBe(false);

    const isolatedEntryUrl = pathToFileURL(join(isolatedRoot, 'dist', 'judgment-host.js')).href;
    const probeScript = [
      'const mod = await import(process.env.ISOLATED_ENTRY_URL);',
      'const expectedFunctions = [',
      "  'processJudgmentHook',",
      "  'runJudgmentHost',",
      "  'buildJudgmentRequest',",
      "  'resolveLocalJudgment',",
      "  'canonicalJson',",
      "  'buildOwnerReferenceLine'",
      '];',
      'const exportTypes = Object.fromEntries(expectedFunctions.map((name) => [name, typeof mod[name]]));',
      "const canonical = mod.canonicalJson({ b: 1, a: 2 });",
      'process.stdout.write(JSON.stringify({ exportTypes, canonical }));'
    ].join('\n');

    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ['--input-type=module', '-e', probeScript],
      {
        cwd: isolatedRoot,
        env: {
          PATH: process.env.PATH ?? '',
          HOME: isolatedRoot,
          ISOLATED_ENTRY_URL: isolatedEntryUrl
        }
      }
    );

    expect(stderr).toBe('');
    const result = JSON.parse(stdout) as {
      exportTypes: Record<string, string>;
      canonical: string;
    };

    expect(result.exportTypes).toEqual({
      processJudgmentHook: 'function',
      runJudgmentHost: 'function',
      buildJudgmentRequest: 'function',
      resolveLocalJudgment: 'function',
      canonicalJson: 'function',
      buildOwnerReferenceLine: 'function'
    });
    expect(result.canonical).toBe('{"a":2,"b":1}');
  });
});
