import { createRequire } from 'node:module';
import { foundationPublicTools, foundationAdoptionTools } from '../src/foundation-authenticated-tools.js';
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import ts from 'typescript';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { FoundationPublicConnection } from '../src/foundation-public-provider.js';
import { createServer } from '../src/server.js';
import { runCli } from '../src/cli.js';
import { createQueueTaskTools } from '../src/queue-task-tools.js';
import { createQueueReferenceBackend, createQueueReferenceSeed } from '../src/testing/queue-task-tools-contract.js';
import { packFilesInIsolation } from '../scripts/npm-release.mjs';

const repoRoot = resolve(import.meta.dirname, '..');
const fixturePath = 'contracts/brainbase-public-contract.v1.json';
const text = z.string().min(1).refine(s => s === s.trim(), 'must not have leading or trailing whitespace');
const strings = z.array(text);
const tool = z.strictObject({ name: text, requiredInput: strings });
const base = { condition: text };
const fixtureSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'),
  package: z.strictObject({ name: text, main: text, types: text, bin: z.record(text, text).refine(bin => Object.keys(bin).length > 0, 'package.bin must not be empty') }),
  mcp: z.strictObject({ internalTools: z.array(tool).nonempty(), toolGroups: z.array(z.discriminatedUnion('id', [
    z.strictObject({ ...base, id: z.literal('local'), tools: z.array(tool).nonempty() }),
    z.strictObject({ ...base, id: z.literal('managed_cloud'), selectsFrom: z.literal('local'), toolNames: strings.nonempty() }),
    z.strictObject({ ...base, id: z.literal('foundation_connected'), extends: z.literal('local'), tools: z.array(tool).nonempty() }),
    z.strictObject({ ...base, id: z.literal('queue_task_tools'), releaseStatus: z.literal('unreleased'), tools: z.array(tool).nonempty() }),
  ])).nonempty() }),
  cli: z.strictObject({ bin: text, commands: strings.nonempty(), aliases: z.record(text, text) }),
});
type Fixture = z.infer<typeof fixtureSchema>;
type Entry = z.infer<typeof tool>;
async function readFixture(): Promise<Fixture> {
  return fixtureSchema.parse(JSON.parse(await readFile(resolve(repoRoot, fixturePath), 'utf8')));
}
function unique(names: string[], label: string) {
  expect(names.filter((name, index) => names.indexOf(name) !== index), `${label}: duplicate names`).toEqual([]);
}
function sameNames(observed: string[], expected: string[], label: string) {
  unique(observed, `${label} observed`);
  unique(expected, `${label} fixture`);
  expect({
    missingFromFixture: observed.filter(name => !expected.includes(name)).sort(),
    extraInFixture: expected.filter(name => !observed.includes(name)).sort(),
  }, label).toEqual({ missingFromFixture: [], extraInFixture: [] });
}
function matchesTools(observed: Entry[], expected: Entry[], label: string) {
  sameNames(observed.map(t => t.name), expected.map(t => t.name), label);
  for (const entry of observed) {
    const recorded = expected.find(t => t.name === entry.name)!;
    expect({
      missingFromFixture: entry.requiredInput.filter(key => !recorded.requiredInput.includes(key)),
      extraInFixture: recorded.requiredInput.filter(key => !entry.requiredInput.includes(key)),
    }, `${label}.${entry.name}: required input difference`).toEqual({ missingFromFixture: [], extraInFixture: [] });
  }
}
function normalize(tools: Tool[]): Entry[] {
  return tools.map(t => ({ name: t.name, requiredInput: [...new Set(t.inputSchema.required ?? [])].sort() }));
}
async function listTools(mode: 'local' | 'managed_cloud', foundation?: FoundationPublicConnection) {
  vi.stubEnv('BRAINBASE_PERSONAL_KNOWLEDGE_MODE', mode);
  vi.stubEnv('BRAINBASE_PERSONAL_KG_STORAGE_MODE', mode);
  const server = createServer({ foundation });
  const client = new Client({ name: 'public-contract-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    return normalize((await client.listTools()).tools);
  } finally {
    try { await client.close(); } finally { await server.close(); }
  }
}
function routedGroups(source: string): string[][] {
  const marker = 'switch (parsed.command) {';
  expect(source.split(marker).length - 1, 'expected exactly one CLI dispatch switch').toBe(1);
  const file = ts.createSourceFile('cli.ts', source, ts.ScriptTarget.Latest, true);
  let dispatch: ts.SwitchStatement | undefined;
  function visit(node: ts.Node) {
    if (ts.isSwitchStatement(node) && node.getStart(file) === source.indexOf(marker)) dispatch = node;
    ts.forEachChild(node, visit);
  }
  visit(file);
  expect(dispatch, 'CLI dispatch switch could not be parsed').toBeDefined();
  const groups: string[][] = [];
  let pending: string[] = [];
  let foundDefault = false;
  for (const clause of dispatch!.caseBlock.clauses) {
    if (ts.isDefaultClause(clause)) { foundDefault = true; break; }
    expect(ts.isStringLiteral(clause.expression), 'CLI case must be a string literal').toBe(true);
    pending.push((clause.expression as ts.StringLiteral).text);
    if (clause.statements.length) { groups.push(pending); pending = []; }
  }
  expect(foundDefault, 'CLI dispatch must have a default clause').toBe(true);
  expect(pending, 'unhandled cases before default').toEqual([]);
  return groups;
}
function sortedUnique(values: string[], label: string, allowEmpty = false) {
  if (!allowEmpty) expect(values.length, `${label} must not be empty`).toBeGreaterThan(0);
  expect(values, `${label} must be sorted and unique`).toEqual([...new Set(values)].sort());
}

describe('OSS public contract fixture', () => {
  it('AC-1 matches every MCP tool group and its required input', async () => {
    const fixture = await readFixture();
    const group = <I extends Fixture['mcp']['toolGroups'][number]['id']>(id: I) =>
      fixture.mcp.toolGroups.find(g => g.id === id) as Extract<Fixture['mcp']['toolGroups'][number], { id: I }>;
    const unexpectedCall = vi.fn(() => { throw new Error('tools/list must not call the foundation provider'); });
    const foundation = {
      provider: { describe: unexpectedCall, read: unexpectedCall, validate: unexpectedCall, validateProblem: unexpectedCall },
      resolveContext: vi.fn(() => null),
    } satisfies FoundationPublicConnection;
    try {
      const local = await listTools('local');
      matchesTools(local, group('local').tools, 'local');
      const selected = group('managed_cloud').toolNames.map(name => {
        const entry = group('local').tools.find(t => t.name === name);
        expect(entry, `managed_cloud: ${name} must exist in local`).toBeDefined();
        return entry!;
      });
      matchesTools(await listTools('managed_cloud'), selected, 'managed_cloud');
      matchesTools(await listTools('managed_cloud', foundation), selected, 'managed_cloud with foundation');
      const added = group('foundation_connected').tools;
      expect(added.map(t => t.name).filter(name => local.some(t => t.name === name)), 'foundation overlaps local').toEqual([]);
      matchesTools(await listTools('local', foundation), [...group('local').tools, ...added], 'foundation_connected');
      expect(unexpectedCall).not.toHaveBeenCalled();
      expect(foundation.resolveContext).not.toHaveBeenCalled();
      const queue = createQueueTaskTools({
        backend: createQueueReferenceBackend(createQueueReferenceSeed()),
        resolveAgent: () => ({ kind: 'agent', agentId: 'contract', credential: 'synthetic' }),
      });
      matchesTools(normalize(queue.map(t => t.definition)), group('queue_task_tools').tools, 'queue_task_tools');
    } finally { vi.unstubAllEnvs(); }
  });

  it('AC-2 matches every routed CLI command and alias', async () => {
    const { cli } = await readFixture();
    const groups = routedGroups(await readFile(resolve(repoRoot, 'src/cli.ts'), 'utf8'));
    const names = [...cli.commands, ...Object.keys(cli.aliases)];
    sameNames(groups.flat(), names, 'CLI routes');
    for (const [alias, canonical] of Object.entries(cli.aliases)) {
      expect(cli.commands, `${alias}: canonical command ${canonical} is missing`).toContain(canonical);
      expect(groups.find(g => g.includes(alias)), `${alias} must fall through with ${canonical}`).toContain(canonical);
    }
    for (const group of groups) {
      const canonical = group.filter(name => cli.commands.includes(name));
      expect(canonical, `fall-through group ${group.join(', ')} must have one canonical command`).toHaveLength(1);
      for (const alias of group.filter(name => name !== canonical[0])) {
        expect(cli.aliases[alias], `${alias}: unrecorded fall-through alias`).toBe(canonical[0]);
      }
    }
    let output = '';
    const io = { stdout: { write: (chunk: string) => { output += chunk; } }, stderr: { write: (chunk: string) => { output += chunk; } } };
    expect(await runCli(['--help'], io)).toBe(0);
    for (const name of names) {
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(output, `help missing ${name}`).toMatch(new RegExp(`brainbase ${escapedName}(?=\\s|$)`));
    }
    expect(await runCli(['__brainbase_contract_unknown__'], io)).toBe(1);
  });

  it('AC-3 matches the package manifest and built entry points', async () => {
    const fixture = await readFixture();
    const { name, main, types, bin } = JSON.parse(await readFile(resolve(repoRoot, 'package.json'), 'utf8'));
    expect(fixture.package).toEqual({ name, main, types, bin });
    expect(Object.keys(fixture.package.bin)).toContain(fixture.cli.bin);
    for (const path of new Set([main, types, ...Object.values(fixture.package.bin)])) {
      await expect(access(resolve(repoRoot, path)), `${path} がありません。npm run build してから実行してください`).resolves.toBeUndefined();
    }
    for (const [binName, binPath] of Object.entries(fixture.package.bin)) {
      expect((await readFile(resolve(repoRoot, binPath), 'utf8')).startsWith('#!/usr/bin/env node'), `${binName}: ${binPath} missing node shebang`).toBe(true);
    }
  });

  it('AC-4 ships the fixture in the npm tarball', async () => {
    expect(await packFilesInIsolation(repoRoot)).toContain(fixturePath);
  }, 30_000);

  it('AC-5 contains only public OSS surface', async () => {
    const fixture = await readFixture();
    const forbidden = /:\/\/|bb\.unson\.jp|lightsail|infisical|\/Users\/|\/home\/|~\/|[a-z]:[\\/]|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
    function inspect(value: unknown) {
      if (typeof value === 'string') expect(value).not.toMatch(forbidden);
      else if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) { inspect(key); inspect(child); }
      }
    }
    inspect(fixture);
    for (const path of [fixture.package.main, fixture.package.types, ...Object.values(fixture.package.bin)]) {
      expect(path).toMatch(/^dist\//);
      expect(path.split('/')).not.toContain('..');
      expect(path).not.toContain('\\');
    }
  });

  it('AC-6 rejects a malformed fixture', async () => {
    function validate(candidate: unknown) {
      const fixture = fixtureSchema.parse(candidate);
      const groups = fixture.mcp.toolGroups;
      sameNames(groups.map(g => g.id), ['local', 'managed_cloud', 'foundation_connected', 'queue_task_tools'], 'group ids');
      for (const group of groups) {
        if ('tools' in group) {
          sortedUnique(group.tools.map(t => t.name), `${group.id}.tools`);
          // A tool with no required inputs intentionally records an empty array.
          for (const tool of group.tools) sortedUnique(tool.requiredInput, `${group.id}.${tool.name}.requiredInput`, true);
        } else sortedUnique(group.toolNames, `${group.id}.toolNames`);
      }
      sortedUnique(fixture.mcp.internalTools.map(t => t.name), 'internalTools');
      for (const entry of fixture.mcp.internalTools) sortedUnique(entry.requiredInput, entry.name);
      sortedUnique(fixture.cli.commands, 'cli.commands');
      sortedUnique(Object.keys(fixture.cli.aliases), 'cli.aliases', true);
      sortedUnique(Object.keys(fixture.package.bin), 'package.bin');
    }
    const fixture = await readFixture();
    validate(fixture);
    const malformedCases: Array<[string, (copy: Fixture) => unknown]> = [
      ['unknown key', copy => ({ ...copy, unknown: true })],
      ['unsorted commands', copy => { copy.cli.commands.reverse(); return copy; }],
      ['duplicate command', copy => { copy.cli.commands.push(copy.cli.commands[0]); return copy; }],
      ['empty group', copy => {
        const group = copy.mcp.toolGroups.find(g => g.id === 'local');
        if (group?.id !== 'local') throw new Error('local group missing');
        group.tools = [] as unknown as typeof group.tools;
        return copy;
      }],
      ['unknown group id', copy => ({ ...copy, mcp: { toolGroups: [...copy.mcp.toolGroups, { id: 'unknown', condition: 'unknown', tools: [] }] } })],
      ['missing group', copy => { copy.mcp.toolGroups.pop(); return copy; }],
      ['duplicate group', copy => { copy.mcp.toolGroups.push(copy.mcp.toolGroups[0]); return copy; }],
      ['non-local selectsFrom', copy => ({ ...copy, mcp: { toolGroups: copy.mcp.toolGroups.map(g => g.id === 'managed_cloud' ? { ...g, selectsFrom: 'queue_task_tools' } : g) } })],
      ['non-local extends', copy => ({ ...copy, mcp: { toolGroups: copy.mcp.toolGroups.map(g => g.id === 'foundation_connected' ? { ...g, extends: 'queue_task_tools' } : g) } })],
      ['untrimmed command', copy => { copy.cli.commands[0] = ` ${copy.cli.commands[0]}`; return copy; }],
      ['missing internal tools', copy => { const { internalTools, ...mcp } = copy.mcp; return { ...copy, mcp }; }],
      ['empty internal tools', copy => ({ ...copy, mcp: { ...copy.mcp, internalTools: [] } })],
      ['duplicate internal tool', copy => { copy.mcp.internalTools.push(copy.mcp.internalTools[0]); return copy; }],
      ['unknown internal field', copy => ({ ...copy, mcp: { ...copy.mcp, internalTools: [{ ...copy.mcp.internalTools[0], unknown: true }] } })],
      ['missing release status', copy => ({ ...copy, mcp: { ...copy.mcp, toolGroups: copy.mcp.toolGroups.map(g => { if (g.id !== 'queue_task_tools') return g; const { releaseStatus, ...rest } = g; return rest; }) } })],
      ['invalid release status', copy => ({ ...copy, mcp: { ...copy.mcp, toolGroups: copy.mcp.toolGroups.map(g => g.id === 'queue_task_tools' ? { ...g, releaseStatus: 'released' } : g) } })],
      ['empty bin', copy => { copy.package.bin = {}; return copy; }],
    ];
    for (const [label, corrupt] of malformedCases) {
      const candidate = corrupt(structuredClone(fixture));
      expect(() => validate(candidate), label).toThrowError(expect.toSatisfy(
        (error: unknown) => error instanceof z.ZodError || (error instanceof Error && error.name === 'AssertionError'),
      ));
    }
    validate({ ...fixture, cli: { ...fixture.cli, aliases: {} } });
  });
  it('AC-7 exposes the fixture through package exports', async () => {
    const manifest = JSON.parse(await readFile(resolve(repoRoot, 'package.json'), 'utf8'));
    expect(manifest.exports['./' + fixturePath]).toBe('./' + fixturePath);
    const exported = createRequire(import.meta.url).resolve('@unson/brainbase-mcp/' + fixturePath);
    expect(JSON.parse(await readFile(exported, 'utf8'))).toEqual(await readFixture());
  });

  it('AC-8 keeps internal foundation tools out of the public contract', async () => {
    const fixture = await readFixture();
    matchesTools(normalize([...foundationPublicTools, ...foundationAdoptionTools]), fixture.mcp.internalTools, 'internal');
    const publicTools = fixture.mcp.toolGroups.flatMap(g => 'tools' in g ? g.tools : []);
    for (const entry of fixture.mcp.internalTools) {
      expect(publicTools).not.toContainEqual(entry);
    }
    const unexpectedCall = vi.fn(() => { throw new Error('unexpected foundation call'); });
    const foundation = {
      provider: { describe: unexpectedCall, read: unexpectedCall, validate: unexpectedCall, validateProblem: unexpectedCall },
      resolveContext: () => null,
    } satisfies FoundationPublicConnection;
    try {
      for (const mode of ['local', 'managed_cloud'] as const) {
        for (const connection of [undefined, foundation]) {
          const observed = await listTools(mode, connection);
          expect(observed.map(t => t.name)).not.toContain('foundation_adopt');
          for (const entry of observed) expect(entry.requiredInput).not.toContain('scope_id');
        }
      }
    } finally { vi.unstubAllEnvs(); }
  });

  it('AC-9 existing contract tests use the fixture as the single source of truth', async () => {
    for (const path of ['tests/mcp-contract.test.ts', 'tests/queue-task-tools.test.ts']) {
      const source = await readFile(resolve(repoRoot, path), 'utf8');
      expect(source).toContain("import publicContract from '../contracts/brainbase-public-contract.v1.json'");
      expect(source).toContain("publicContract.mcp.toolGroups.find(group => group.id === 'local')");
      expect(source).not.toMatch(/toHaveLength\(18\)/);
    }
  });

  it('AC-10 marks queue task tools as unreleased', async () => {
    const fixture = await readFixture();
    expect(fixture.mcp.toolGroups.find(g => g.id === 'queue_task_tools')).toMatchObject({ releaseStatus: 'unreleased' });
  });

});
