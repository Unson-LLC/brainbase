// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureGraphifyArtifact, impactContext } from '../../scripts/graphify-impact-context.mjs';
const roots = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'impact-test-')); roots.push(root);
    const repo = join(root, 'repo'), bin = join(root, 'bin'); mkdirSync(repo); mkdirSync(bin);
    writeFileSync(join(bin, 'graphify'), '#!/bin/sh\n', { mode: 0o755 });
    const git = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
    git('init'); writeFileSync(join(repo, 'a.js'), 'a'); git('add', 'a.js');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-m', 'initial');
    const graph = join(root, 'graph.json');
    const data = { nodes: [{ id: 'a', source_file: 'a.js' }, { id: 'b', source_file: 'b.js' }], links: [{ source: 'a', target: 'b' }] };
    const save = () => writeFileSync(graph, JSON.stringify(data)); save();
    const options = { repo, files: ['a.js'], graph, cacheDir: join(root, 'cache'), env: { PATH: bin } };
    return { repo, data, save, options };
}
describe('Graphify lightweight impact context', () => {
    it('generates a missing worktree graph once and refreshes it only when requested', () => {
        const { repo, options } = fixture();
        const graph = join(repo, '.vibepro', 'graphify', 'graph.json');
        const calls = [];
        const run = (command, args) => {
            calls.push([command, args]);
            mkdirSync(join(repo, '.vibepro', 'graphify'), { recursive: true });
            writeFileSync(graph, JSON.stringify({ nodes: [], links: [] }));
        };

        expect(ensureGraphifyArtifact({ repo, env: options.env, run })).toEqual({ graph, generated: true });
        expect(ensureGraphifyArtifact({ repo, env: options.env, run })).toEqual({ graph, generated: false });
        expect(ensureGraphifyArtifact({ repo, env: options.env, run, refresh: true })).toEqual({ graph, generated: true });
        expect(calls).toEqual([
            ['vibepro', ['graph', repo, '--run-graphify']],
            ['vibepro', ['graph', repo, '--run-graphify']]
        ]);
    });

    it('reads direct neighbors and reuses unchanged context without claiming freshness', () => {
        const { options } = fixture();
        const first = impactContext(options);
        expect(first).toMatchObject({ status: 'context_available', freshness: 'unknown', impact: 'unknown', reused: false });
        expect(first.nodes.map((node) => node.id)).toEqual(['a', 'b']);
        expect(impactContext(options).reused).toBe(true);
    });
    it('invalidates reuse on tracked, untracked, graph and target changes', () => {
        const { repo, options, data, save } = fixture(); impactContext(options);
        writeFileSync(join(repo, 'a.js'), 'changed'); expect(impactContext(options).reused).toBe(false);
        expect(impactContext(options).reused).toBe(true);
        writeFileSync(join(repo, 'new.js'), 'new'); expect(impactContext(options).reused).toBe(false);
        data.nodes[1].label = 'new label'; save(); expect(impactContext(options).reused).toBe(false);
        expect(impactContext({ ...options, files: ['b.js'] }).reused).toBe(false);
    });
    it('keeps missing installation, graph, matches and corrupt graph distinct and unknown', () => {
        const { options } = fixture();
        expect(impactContext({ ...options, env: { PATH: '' } })).toMatchObject({ status: 'unavailable', impact: 'unknown' });
        expect(impactContext({ ...options, graph: '/missing/graph.json' }).status).toBe('missing_graph');
        expect(impactContext({ ...options, files: ['missing.js'] }).status).toBe('unmatched');
        writeFileSync(options.graph, '{'); expect(impactContext(options).status).toBe('invalid_graph');
    });
    it('reports partial matches and capped results rather than complete impact', () => {
        const { options } = fixture();
        expect(impactContext({ ...options, files: ['a.js', 'missing.js'] })).toMatchObject({ status: 'partial', unmatched_files: ['missing.js'] });
        const capped = impactContext({ ...options, limit: 1 });
        expect(capped).toMatchObject({ status: 'partial', truncated: true }); expect(capped.nodes).toHaveLength(1);
    });
    it('does not reuse when source state is unverifiable or cache is inside repo', () => {
        const { repo, options } = fixture();
        const inside = { ...options, cacheDir: join(repo, 'cache') };
        impactContext(inside); expect(impactContext(inside).reused).toBe(false);
        rmSync(join(repo, '.git'), { recursive: true });
        impactContext(options); expect(impactContext(options)).toMatchObject({ reused: false, source_digest: null });
    });
    it('rejects targets outside the repository', () => {
        const { options } = fixture(); expect(() => impactContext({ ...options, files: ['../outside.js'] })).toThrow(/inside/);
    });
});
