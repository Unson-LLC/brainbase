#!/usr/bin/env node
// Bounded, read-only context from an existing Graphify artifact.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync, lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const normalize = (repo, file) => relative(repo, resolve(repo, file)).split(sep).join('/');
const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], { maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
function installed(env) {
    return (env.PATH || '').split(delimiter).some((dir) => {
        try { accessSync(join(dir, 'graphify'), constants.X_OK); return true; } catch { return false; }
    });
}
function sourceState(repo, graphPath) {
    try {
        const root = realpathSync(git(repo, ['rev-parse', '--show-toplevel']).toString().trim());
        if (root !== repo) return null;
        const hash = createHash('sha256').update(git(repo, ['rev-parse', 'HEAD']));
        if (git(repo, ['ls-files', '--stage']).toString().split('\n').some((line) => line.startsWith('160000 '))) return null;
        const graphRelative = relative(repo, graphPath);
        const exclusions = graphRelative.startsWith(`..${sep}`) ? [] : [`:(exclude)${graphRelative}`];
        hash.update(git(repo, ['diff', '--binary', '--no-ext-diff', '--no-textconv', 'HEAD', '--', '.', ...exclusions]));
        const paths = [...new Set(git(repo, ['ls-files', '-z', '--others', '--exclude-standard']).toString().split('\0').filter(Boolean))].sort();
        for (const file of paths) {
            const full = resolve(repo, file);
            if (full === graphPath) continue;
            hash.update(JSON.stringify(file));
            try {
                const stat = lstatSync(full);
                hash.update(String(stat.mode));
                if (stat.isSymbolicLink()) hash.update(readlinkSync(full));
                else if (stat.isFile()) hash.update(readFileSync(full));
                else return null; // Submodule/directory contents are not represented reliably.
            } catch (error) {
                if (error.code === 'ENOENT') hash.update('deleted'); else return null;
            }
        }
        return hash.digest('hex');
    } catch { return null; }
}

export function impactContext({ repo, files, graph, cacheDir = join(tmpdir(), 'brainbase-graphify-impact-v1'), env = process.env, limit = 40 }) {
    repo = realpathSync(resolve(repo));
    if (!Array.isArray(files) || !files.length) throw new Error('At least one --file is required');
    const targets = [...new Set(files.map((file) => normalize(repo, file)))].sort();
    if (targets.some((file) => file === '..' || file.startsWith('../') || !file)) throw new Error('Target files must be inside --repo');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid result limit');
    const base = { schema_version: 'graphify-impact-v1', repo, targets, freshness: 'unknown', impact: 'unknown', reused: false };
    if (!installed(env)) return { ...base, status: 'unavailable' };
    const graphPath = graph ? resolve(repo, graph) : ['graphify-out/graph.json', '.vibepro/graphify/graph.json'].map((file) => resolve(repo, file)).find(existsSync);
    if (!graphPath || !existsSync(graphPath)) return { ...base, status: 'missing_graph' };
    let bytes, data;
    try {
        bytes = readFileSync(graphPath);
        data = JSON.parse(bytes);
        if (!Array.isArray(data.nodes) || !Array.isArray(data.links ?? data.edges)) throw new Error('Unsupported graph structure');
        if (data.nodes.some((node) => !node || node.id == null)) throw new Error('Invalid graph node');
    } catch { return { ...base, status: 'invalid_graph', graph: graphPath }; }
    const sourceDigest = sourceState(repo, graphPath);
    const graphDigest = digest(bytes);
    const key = sourceDigest ? digest(JSON.stringify([repo, targets, sourceDigest, graphPath, graphDigest, limit])) : null;
    const cacheOutsideRepo = relative(repo, resolve(cacheDir)).startsWith(`..${sep}`) || isAbsolute(relative(repo, resolve(cacheDir)));
    const cachePath = key && cacheOutsideRepo ? join(cacheDir, `${key}.json`) : null;
    if (cachePath) {
        try {
            const cached = JSON.parse(readFileSync(cachePath, 'utf8'));
            if (cached.key === key) return { ...cached.result, reused: true };
        } catch { /* Cache is optional. */ }
    }
    const nodes = new Map(data.nodes.map((node) => [String(node.id), node]));
    const fileOf = (node) => typeof node.source_file === 'string' ? normalize(repo, node.source_file) : null;
    const matched = new Set();
    const seeds = new Set();
    for (const [id, node] of nodes) {
        const file = fileOf(node);
        if (targets.includes(file)) { seeds.add(id); matched.add(file); }
    }
    const neighbors = new Set(seeds);
    let invalidEdges = false;
    for (const edge of data.links ?? data.edges) {
        if (!edge || edge.source == null || edge.target == null) { invalidEdges = true; continue; }
        const from = String(edge.source), to = String(edge.target);
        if (!nodes.has(from) || !nodes.has(to)) { invalidEdges = true; continue; }
        if (seeds.has(from) || seeds.has(to)) { neighbors.add(from); neighbors.add(to); }
    }
    const selected = [...neighbors].sort();
    const unmatched = targets.filter((file) => !matched.has(file));
    const result = {
        ...base, status: !seeds.size ? 'unmatched' : unmatched.length || invalidEdges || selected.length > limit ? 'partial' : 'context_available',
        graph: graphPath, graph_digest: graphDigest, source_digest: sourceDigest,
        matched_files: [...matched].sort(), unmatched_files: unmatched,
        truncated: selected.length > limit, invalid_edges: invalidEdges,
        nodes: selected.slice(0, limit).map((id) => {
            const node = nodes.get(id);
            return { id: id.slice(0, 300), file: fileOf(node)?.slice(0, 500) ?? null, label: String(node.label ?? id).slice(0, 300), location: String(node.source_location ?? '').slice(0, 100) };
        })
    };
    if (cachePath) {
        try { mkdirSync(cacheDir, { recursive: true, mode: 0o700 }); writeFileSync(cachePath, JSON.stringify({ key, result }), { mode: 0o600 }); } catch { /* Still return fresh context. */ }
    }
    return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try {
        const args = process.argv.slice(2), options = { files: [] };
        for (let i = 0; i < args.length; i += 2) {
            const key = { '--repo': 'repo', '--file': 'files', '--graph': 'graph', '--cache-dir': 'cacheDir' }[args[i]];
            if (!key || !args[i + 1]) throw new Error('Usage: --repo <repo> --file <relative-path> [--file ...] [--graph <path>] [--cache-dir <outside-repo>]');
            if (key === 'files') options.files.push(args[i + 1]); else options[key] = args[i + 1];
        }
        if (!options.repo) throw new Error('--repo is required');
        process.stdout.write(`${JSON.stringify(impactContext(options), null, 2)}\n`);
    } catch (error) {
        process.stdout.write(`${JSON.stringify({ schema_version: 'graphify-impact-v1', status: 'failed', impact: 'unknown', error: error.message })}\n`);
        process.exitCode = 1;
    }
}
