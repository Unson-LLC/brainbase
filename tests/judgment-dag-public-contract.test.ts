import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import {
  JUDGMENT_DAG_ALLOWED_KEYS,
  validateJudgmentDAG
} from '../src/judgment-dag.js';

const root = process.cwd();
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex');

function packageRelativePath(relativePath: string): string {
  expect(relativePath).not.toMatch(/^\//u);
  expect(relativePath).not.toMatch(/^[A-Za-z]:[\\/]/u);
  expect(relativePath.split(/[\\/]/u)).not.toContain('..');
  return path.resolve(root, relativePath);
}

describe('public Judgment DAG machine contract', () => {
  it('publishes a side-effect-free subpath and locked machine artifacts', async () => {
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    const readme = await readFile(path.join(root, 'README.md'), 'utf8');
    expect(manifest.version).toBe('0.4.0');
    expect(manifest.main).toBe('dist/index.js');
    expect(manifest.exports['.'].import).toBe('./dist/index.js');
    expect(manifest.exports['./judgment-dag']).toEqual({
      types: './dist/judgment-dag.d.ts',
      import: './dist/judgment-dag.js'
    });
    expect(manifest.exports['./dist/*']).toBe('./dist/*');
    expect(manifest.files).toContain('docs/architecture/judgment-dag-core.md');
    expect(manifest.files).toContain('docs/management/judgment-dag-milestones.md');
    expect(readme).toContain('source-lock.sources');
    expect(readme).toContain('digest.files');
    expect(readme).toContain('path + NUL + sha256 + LF');
    for (const artifact of ['schema', 'fixture', 'source-lock', 'digest']) {
      expect(manifest.exports[`./contracts/judgment-dag/${artifact}.json`])
        .toBe(`./contracts/judgment-dag/${artifact}.json`);
    }

    const fixture = JSON.parse(await readFile(path.join(root, 'contracts/judgment-dag/fixture.json'), 'utf8'));
    expect(validateJudgmentDAG(fixture).execution_order).toEqual([
      'context.account', 'context.customer', 'judgment.fit', 'resource.scope',
      'execution.proposal', 'execution.outcome', 'evaluation.result'
    ]);
    const sourceLock = JSON.parse(await readFile(path.join(root, 'contracts/judgment-dag/source-lock.json'), 'utf8'));
    expect(sourceLock.status).toBe('accepted');
    expect(sourceLock.repository).toBe('https://github.com/Unson-LLC/brainbase');
    expect(sourceLock.accepted_base_commit).toBe('7e5d5693f988f4ba84072c5910ef32f0e70871e1');
    expect(execFileSync('git', ['rev-parse', sourceLock.accepted_base_commit], { cwd: root }).toString().trim())
      .toBe(sourceLock.accepted_base_commit);
    for (const source of sourceLock.sources) {
      const content = await readFile(packageRelativePath(source.path));
      expect(sha256(content)).toBe(source.sha256);
    }

    const digest = JSON.parse(await readFile(path.join(root, 'contracts/judgment-dag/digest.json'), 'utf8'));
    const digestPaths = digest.files.map((file: { path: string }) => file.path);
    expect(digestPaths).toEqual([...digestPaths].sort((left, right) => left.localeCompare(right)));
    const canonical = digest.files.map((file: { path: string; sha256: string }) => `${file.path}\0${file.sha256}\n`).join('');
    expect(digest.digest).toBe(sha256(canonical));
    for (const file of digest.files) {
      expect(sha256(await readFile(packageRelativePath(file.path)))).toBe(file.sha256);
    }
    expect(digestPaths.every((filePath: string) => !filePath.startsWith('src/'))).toBe(true);
  });

  it('keeps schema exact key sets and runtime contract keys in parity', async () => {
    const schema = JSON.parse(await readFile(path.join(root, 'contracts/judgment-dag/schema.json'), 'utf8'));
    const schemaKeySets = {
      root: Object.keys(schema.properties),
      node: Object.keys(schema.$defs.node.properties),
      scope: Object.keys(schema.$defs.scope.properties),
      edge: Object.keys(schema.$defs.edge.properties)
    };
    for (const [kind, schemaKeys] of Object.entries(schemaKeySets)) {
      expect([...schemaKeys].sort()).toEqual([...JUDGMENT_DAG_ALLOWED_KEYS[kind as keyof typeof JUDGMENT_DAG_ALLOWED_KEYS]].sort());
    }
    expect(schema.additionalProperties).toBe(false);
    expect(schema.$defs.node.additionalProperties).toBe(false);
    expect(schema.$defs.scope.additionalProperties).toBe(false);
    expect(schema.$defs.edge.additionalProperties).toBe(false);
    const metadataObject = schema.$defs.metadata.anyOf.find(
      (candidate: { type?: string }) => candidate.type === 'object'
    );
    expect(metadataObject.additionalProperties).toEqual({ $ref: '#/$defs/metadata' });
  });

  it('validates the contract with strict draft-2020 Ajv defaults', async () => {
    const schema = JSON.parse(await readFile(path.join(root, 'contracts/judgment-dag/schema.json'), 'utf8'));
    const fixture = JSON.parse(await readFile(path.join(root, 'contracts/judgment-dag/fixture.json'), 'utf8'));
    const ajv = new Ajv2020({ strict: true });
    const validate = ajv.compile(schema);

    expect(validate(fixture)).toBe(true);
    expect(validate({ ...fixture, unexpected: true })).toBe(false);
  });

  it('keeps the schema and runtime non-empty string acceptance sets in parity', async () => {
    const schema = JSON.parse(await readFile(path.join(root, 'contracts/judgment-dag/schema.json'), 'utf8'));
    const fixture = JSON.parse(await readFile(path.join(root, 'contracts/judgment-dag/fixture.json'), 'utf8'));
    const ajv = new Ajv2020({ strict: true });
    const validate = ajv.compile(schema);
    const candidates = [
      ['dag.id', { ...fixture, id: '   ' }],
      ['dag.id control character', { ...fixture, id: 'dag\u0000id' }],
      ['dag.version', { ...fixture, version: '\t' }],
      ['node.id', {
        ...fixture,
        nodes: fixture.nodes.map((node: Record<string, unknown>, index: number) => index === 0
          ? { ...node, id: '  ' }
          : node)
      }],
      ['node.id control character', {
        ...fixture,
        nodes: fixture.nodes.map((node: Record<string, unknown>, index: number) => index === 0
          ? { ...node, id: 'node\u0000id' }
          : node)
      }],
      ['scope.id', {
        ...fixture,
        nodes: fixture.nodes.map((node: Record<string, unknown>, index: number) => index === 0
          ? { ...node, scope: { ...(node.scope as Record<string, unknown>), id: '  ' } }
          : node)
      }],
      ['scope.id control character', {
        ...fixture,
        nodes: fixture.nodes.map((node: Record<string, unknown>, index: number) => index === 0
          ? { ...node, scope: { ...(node.scope as Record<string, unknown>), id: 'scope\u0000id' } }
          : node)
      }],
      ['node.version', {
        ...fixture,
        nodes: fixture.nodes.map((node: Record<string, unknown>, index: number) => index === 0
          ? { ...node, version: '\n' }
          : node)
      }],
      ['node.description', {
        ...fixture,
        nodes: fixture.nodes.map((node: Record<string, unknown>, index: number) => index === 0
          ? { ...node, description: ' \t ' }
          : node)
      }],
      ['node.input_contract', {
        ...fixture,
        nodes: fixture.nodes.map((node: Record<string, unknown>, index: number) => index === 0
          ? { ...node, input_contract: '  ' }
          : node)
      }],
      ['node.output_contract', {
        ...fixture,
        nodes: fixture.nodes.map((node: Record<string, unknown>, index: number) => index === 0
          ? { ...node, output_contract: '\r\n' }
          : node)
      }],
      ['depends_on item', {
        ...fixture,
        nodes: fixture.nodes.map((node: Record<string, unknown>) => node.id === 'judgment.fit'
          ? { ...node, depends_on: ['\t', 'context.account'] }
          : node)
      }],
      ['depends_on control character', {
        ...fixture,
        nodes: fixture.nodes.map((node: Record<string, unknown>) => node.id === 'judgment.fit'
          ? { ...node, depends_on: ['context\u0000account', 'context.account'] }
          : node)
      }],
      ['edge.from', {
        ...fixture,
        edges: fixture.edges.map((edge: Record<string, unknown>, index: number) => index === 0
          ? { ...edge, from: '  ' }
          : edge)
      }],
      ['edge.to', {
        ...fixture,
        edges: fixture.edges.map((edge: Record<string, unknown>, index: number) => index === 0
          ? { ...edge, to: '\n' }
          : edge)
      }],
      ['edge.from control character', {
        ...fixture,
        edges: fixture.edges.map((edge: Record<string, unknown>, index: number) => index === 0
          ? { ...edge, from: 'context\u0000account' }
          : edge)
      }],
      ['edge.to control character', {
        ...fixture,
        edges: fixture.edges.map((edge: Record<string, unknown>, index: number) => index === 0
          ? { ...edge, to: 'judgment\u0000fit' }
          : edge)
      }]
    ] as const;

    for (const [label, candidate] of candidates) {
      const schemaAccepts = validate(candidate);
      let runtimeAccepts = true;
      try {
        validateJudgmentDAG(candidate);
      } catch {
        runtimeAccepts = false;
      }
      expect(schemaAccepts, `${label}: schema acceptance`).toBe(false);
      expect(runtimeAccepts, `${label}: runtime acceptance`).toBe(false);
      expect(schemaAccepts).toBe(runtimeAccepts);
    }
  });
});
