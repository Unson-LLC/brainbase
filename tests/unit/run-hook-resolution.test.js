// @vitest-environment node

import { spawnSync } from 'node:child_process';
import {
    chmodSync,
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const sourceRunnerPath = join(repositoryRoot, '.claude/scripts/run-hook.sh');
const fixtureBase = process.env.CODEX_WORKTREE_ROOT || tmpdir();
const fixtureRoots = [];

afterEach(() => {
    for (const root of fixtureRoots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

function executable(path, contents) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
    chmodSync(path, 0o755);
    return path;
}

function tsxStub(root, marker) {
    return executable(join(root, 'node_modules/.bin/tsx'), `#!/bin/bash
set -eu
{
  printf 'source=%s\\n' '${marker}'
  printf 'script=%s\\n' "$1"
  shift
  printf 'arg=%s\\n' "$@"
  printf 'original_cwd=%s\\n' "$BRAINBASE_HOOK_ORIGINAL_CWD"
  printf 'execution_cwd=%s\\n' "$PWD"
} > "$RUN_HOOK_RESULT"
exit "$RUN_HOOK_EXIT_CODE"
`);
}

function pathTsxStub(pathBin) {
    return executable(join(pathBin, 'tsx'), `#!/bin/bash
set -eu
{
  printf 'source=PATH\\n'
  printf 'script=%s\\n' "$1"
  shift
  printf 'arg=%s\\n' "$@"
  printf 'original_cwd=%s\\n' "$BRAINBASE_HOOK_ORIGINAL_CWD"
  printf 'execution_cwd=%s\\n' "$PWD"
} > "$RUN_HOOK_RESULT"
`);
}

function fixture() {
    if (!existsSync(fixtureBase)) {
        throw new Error(`fixture_base_missing:${fixtureBase}`);
    }

    const root = mkdtempSync(join(fixtureBase, 'run-hook-resolution-'));
    fixtureRoots.push(root);

    const repoRoot = join(root, 'repo');
    const callerCwd = join(root, 'caller cwd');
    const pathBin = join(root, 'path-bin');
    const outputPath = join(root, 'runner-output.txt');
    const runnerPath = join(repoRoot, '.claude/scripts/run-hook.sh');
    const hookPath = join(repoRoot, 'hooks/test-hook.ts');

    mkdirSync(dirname(runnerPath), { recursive: true });
    mkdirSync(dirname(hookPath), { recursive: true });
    mkdirSync(callerCwd, { recursive: true });
    mkdirSync(pathBin, { recursive: true });
    copyFileSync(sourceRunnerPath, runnerPath);
    chmodSync(runnerPath, 0o755);
    writeFileSync(hookPath, '// fixture hook\n');

    executable(join(pathBin, 'git'), '#!/bin/bash\nexit 1\n');

    const environment = {
        ...process.env,
        PATH: `${pathBin}:/usr/bin:/bin`,
        RUN_HOOK_RESULT: outputPath,
        RUN_HOOK_EXIT_CODE: '0'
    };
    delete environment.BRAINBASE_HOOK_REPO_ROOT;

    return {
        callerCwd,
        environment,
        hookPath,
        outputPath,
        pathBin,
        repoRoot,
        root,
        runnerPath
    };
}

function run(fixtureData, args = [], environmentOverrides = {}) {
    const result = spawnSync('/bin/bash', [fixtureData.runnerPath, fixtureData.hookPath, ...args], {
        cwd: fixtureData.callerCwd,
        env: { ...fixtureData.environment, ...environmentOverrides },
        encoding: 'utf8'
    });

    return {
        ...result,
        output: existsSync(fixtureData.outputPath)
            ? readFileSync(fixtureData.outputPath, 'utf8')
            : ''
    };
}

describe('run-hook tool resolution', () => {
    it('prefers repo-local tsx over the PATH candidate', () => {
        const data = fixture();
        const explicitRoot = join(data.root, 'explicit tools');
        tsxStub(data.repoRoot, 'repo-local');
        tsxStub(explicitRoot, 'explicit-root');
        pathTsxStub(data.pathBin);

        const result = run(data, ['--event', 'PostToolUse'], {
            BRAINBASE_HOOK_REPO_ROOT: explicitRoot
        });

        expect(result.status, result.stderr).toBe(0);
        expect(result.output).toContain('source=repo-local');
        expect(result.output).not.toContain('source=explicit-root');
        expect(result.output).toContain('arg=--event\narg=PostToolUse');
    });

    it('preserves the exit code from the selected tsx process', () => {
        const data = fixture();
        tsxStub(data.repoRoot, 'repo-local');

        const result = run(data, ['--nonzero'], { RUN_HOOK_EXIT_CODE: '23' });

        expect(result.status).toBe(23);
        expect(result.output).toContain('source=repo-local');
    });

    it('uses the explicit repo root, preserving args and the original cwd when its path has spaces', () => {
        const data = fixture();
        const explicitRoot = join(data.root, 'explicit hook tools');
        tsxStub(explicitRoot, 'explicit-root');
        pathTsxStub(data.pathBin);

        const result = run(data, ['two words', '--mode=check'], {
            BRAINBASE_HOOK_REPO_ROOT: explicitRoot
        });

        expect(result.status, result.stderr).toBe(0);
        expect(result.output).toContain('source=explicit-root');
        expect(result.output).toContain('arg=two words\narg=--mode=check');
        expect(result.output).toContain(`original_cwd=${data.callerCwd}`);
        expect(result.output).toContain(`execution_cwd=${data.repoRoot}`);
    });

    it('discovers a tool from a same-repository worktree before PATH', () => {
        const data = fixture();
        const worktreeRoot = join(data.root, 'related worktree');
        tsxStub(worktreeRoot, 'same-repo-worktree');
        pathTsxStub(data.pathBin);
        executable(join(data.pathBin, 'git'), `#!/bin/bash
set -eu
case "$*" in
  *"rev-parse --git-dir"*) printf '.git\\n' ;;
  *"worktree list --porcelain"*) printf 'worktree %s\\n\\n' "$RUN_HOOK_WORKTREE_ROOT" ;;
  *) exit 1 ;;
esac
`);

        const result = run(data, ['--reason', 'worktree-discovery'], {
            RUN_HOOK_WORKTREE_ROOT: worktreeRoot
        });

        expect(result.status, result.stderr).toBe(0);
        expect(result.output).toContain('source=same-repo-worktree');
        expect(result.output).toContain('arg=--reason\narg=worktree-discovery');
    });

    it('uses the PATH tsx candidate when no repository candidate exists', () => {
        const data = fixture();
        pathTsxStub(data.pathBin);

        const result = run(data, ['--path-only']);

        expect(result.status, result.stderr).toBe(0);
        expect(result.output).toContain('source=PATH');
        expect(result.output).toContain('arg=--path-only');
    });

    it('returns 127 when no tsx candidate exists', () => {
        const data = fixture();

        const result = run(data);

        expect(result.status).toBe(127);
        expect(result.stderr).toContain('tsx is not available');
        expect(result.output).toBe('');
    });

    it('prefers a neighboring mjs bundle over local tsx', () => {
        const data = fixture();
        tsxStub(data.repoRoot, 'repo-local');
        const bundlePath = data.hookPath.replace(/\.ts$/u, '.mjs');
        writeFileSync(bundlePath, `import { writeFileSync } from 'node:fs';
writeFileSync(process.env.RUN_HOOK_RESULT, JSON.stringify({
  source: 'mjs-bundle',
  args: process.argv.slice(2),
  originalCwd: process.env.BRAINBASE_HOOK_ORIGINAL_CWD,
  executionCwd: process.cwd()
}));
`);
        executable(join(data.pathBin, 'node'), `#!/bin/bash
exec '${process.execPath}' "$@"
`);

        const result = run(data, ['--bundle-arg', 'two words']);

        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(result.output)).toMatchObject({
            source: 'mjs-bundle',
            args: ['--bundle-arg', 'two words'],
            originalCwd: data.callerCwd,
            executionCwd: data.repoRoot
        });
    });

    it('does not contain a personal checkout fallback path', () => {
        const runner = readFileSync(sourceRunnerPath, 'utf8');

        expect(runner).not.toContain('/Users/ksato/workspace/code/brainbase');
    });
});
