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

describe('public Judgment DAG machine contract', () => {
  it('publishes a side-effect-free subpath and locked machine artifacts', async () => {
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    expect(manifest.version).toBe('0.4.0');
    expect(manifest.main).toBe('dist/index.js');
    expect(manifest.exports['.'].import).toBe('./dist/index.js');
    expect(manifest.exports['./judgment-dag']).toEqual({
      types: './dist/judgment-dag.d.ts',
      import: './dist/judgment-dag.js'
    });

    const fixture = JSON.parse(await readFile(path.join(root, 'contracts/judgment-dag/fixture.json'), 'utf8'));
    expect(validateJudgmentDAG(fixture).execution_order).toEqual([
      'context.account', 'context.customer', 'judgment.fit', 'resource.scope',
      'execution.proposal', 'execution.outcome', 'evaluation.result'
    ]);
    const sourceLock = JSON.parse(await readFile(path.join(root, 'contracts/judgment-dag/source-lock.json'), 'utf8'));
    expect(sourceLock.status).toBe('accepted');
    expect(sourceLock.accepted_base_commit).toBe('7e5d5693f988f4ba84072c5910ef32f0e70871e1');
    expect(execFileSync('git', ['rev-parse', sourceLock.accepted_base_commit], { cwd: root }).toString().trim())
      .toBe(sourceLock.accepted_base_commit);
    for (const source of sourceLock.sources) {
      const content = await readFile(path.join(root, source.path));
      expect(sha256(content)).toBe(source.sha256);
    }

    const digest = JSON.parse(await readFile(path.join(root, 'contracts/judgment-dag/digest.json'), 'utf8'));
    const canonical = digest.files.map((file: { path: string; sha256: string }) => `${file.path}\0${file.sha256}\n`).join('');
    expect(digest.digest).toBe(sha256(canonical));
    for (const file of digest.files) {
      expect(sha256(await readFile(path.join(root, file.path)))).toBe(file.sha256);
    }
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
});
