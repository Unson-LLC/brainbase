import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { processJudgmentHook } from '../src/judgment-host.js';
import {
  TaskProgressValidationError,
  taskProgressObservationSchema,
  taskProgressScopeSchema,
  type TaskProgressScope
} from '../src/judgment-task-progress.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('taskProgressScopeSchema', () => {
  it('parses and trims valid scope fields including length boundaries (1 and 512)', () => {
    const maxRef = 'a'.repeat(512);
    const parsed = taskProgressScopeSchema.parse({
      task_ref: '  x  ',
      criterion_ref: `  ${maxRef}  `,
      contract_revision: ' rev-1 '
    });
    expect(parsed).toEqual({
      task_ref: 'x',
      criterion_ref: maxRef,
      contract_revision: 'rev-1'
    });
    expect(taskProgressScopeSchema.safeParse(parsed)).toEqual({
      success: true,
      data: parsed
    });
  });

  it('rejects unknown own and inherited enumerable keys strictly (including undefined values and __proto__)', () => {
    const valid = { task_ref: 'task-8', criterion_ref: 'host-stop', contract_revision: '1' };

    const extra = taskProgressScopeSchema.safeParse({ ...valid, extra: 'nope' });
    expect(extra.success).toBe(false);
    if (!extra.success) {
      expect(extra.error.issues[0]).toMatchObject({ code: 'unrecognized_keys', keys: ['extra'] });
    }

    const extraUndefined = taskProgressScopeSchema.safeParse({ ...valid, extra: undefined });
    expect(extraUndefined.success).toBe(false);
    if (!extraUndefined.success) {
      expect(extraUndefined.error.issues[0]).toMatchObject({ code: 'unrecognized_keys', keys: ['extra'] });
    }

    // Exact RUNNER_VERIFY reproduction case: inherited enumerable unknown key with undefined value
    const inheritedExtraUndefined = Object.assign(Object.create({ extra: undefined }), valid);
    const inheritedResult = taskProgressScopeSchema.safeParse(inheritedExtraUndefined);
    expect(inheritedResult.success).toBe(false);
    if (!inheritedResult.success) {
      expect(inheritedResult.error.issues[0]).toMatchObject({
        code: 'unrecognized_keys',
        keys: ['extra'],
        path: []
      });
    }
    expect(() => taskProgressScopeSchema.parse(inheritedExtraUndefined)).toThrow(TaskProgressValidationError);

    // Multi-level prototype chain and duplicate shadowed unknown keys (reported once)
    const multiLevel = Object.assign(Object.create(Object.create({ deep_extra: 1 })), valid);
    const multiLevelResult = taskProgressScopeSchema.safeParse(multiLevel);
    expect(multiLevelResult.success).toBe(false);
    if (!multiLevelResult.success) {
      expect(multiLevelResult.error.issues[0]).toMatchObject({
        code: 'unrecognized_keys',
        keys: ['deep_extra']
      });
    }

    const duplicatedExtra = Object.assign(Object.create({ extra: 1 }), valid, { extra: 2 });
    const duplicatedResult = taskProgressScopeSchema.safeParse(duplicatedExtra);
    expect(duplicatedResult.success).toBe(false);
    if (!duplicatedResult.success) {
      expect(duplicatedResult.error.issues[0]).toMatchObject({
        code: 'unrecognized_keys',
        keys: ['extra']
      });
    }

    // Null-prototype object with extra key
    const nullProtoExtra = Object.assign(Object.create(null), valid, { extra: 1 });
    const nullProtoExtraResult = taskProgressScopeSchema.safeParse(nullProtoExtra);
    expect(nullProtoExtraResult.success).toBe(false);
    if (!nullProtoExtraResult.success) {
      expect(nullProtoExtraResult.error.issues[0]).toMatchObject({
        code: 'unrecognized_keys',
        keys: ['extra']
      });
    }

    // Own enumerable "__proto__" key (e.g. from JSON.parse)
    const protoKeyObj = JSON.parse('{"task_ref":"t1","criterion_ref":"c1","contract_revision":"1","__proto__":1}');
    const protoKeyResult = taskProgressScopeSchema.safeParse(protoKeyObj);
    expect(protoKeyResult.success).toBe(false);
    if (!protoKeyResult.success) {
      expect(protoKeyResult.error.issues[0]).toMatchObject({
        code: 'unrecognized_keys',
        keys: ['__proto__']
      });
    }

    expect(() => taskProgressScopeSchema.parse({ ...valid, extra: true })).toThrow(TaskProgressValidationError);
  });

  it('rejects prototype-polluted taskProgress.scope via public processJudgmentHook (UserPromptSubmit)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'task-progress-strict-'));
    tempDirs.push(root);
    const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal') };
    const pollutedScope = Object.assign(Object.create({ extra: undefined }), {
      task_ref: 'task-8',
      criterion_ref: 'host-stop',
      contract_revision: '1'
    }) as TaskProgressScope;

    let caught: unknown;
    try {
      await processJudgmentHook(
        {
          hook_event_name: 'UserPromptSubmit',
          prompt: '回答を準備して',
          session_id: 'proto-polluted-scope',
          turn_id: 'turn-1',
          cwd: root
        },
        {
          env,
          taskProgress: {
            scope: pollutedScope,
            async assess() {
              return { kind: 'waiting' };
            },
            async verifyOutcome() {
              return false;
            }
          }
        }
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(TaskProgressValidationError);
    expect((caught as TaskProgressValidationError).issues[0]).toMatchObject({
      code: 'unrecognized_keys',
      keys: ['extra']
    });
  });

  it('matches zod 4 parity on class instances, null-prototype objects, inherited valid fields, non-enumerable keys, and built-ins with attached fields', () => {
    class Scope {
      task_ref = 'task-8';
      criterion_ref = 'host-stop';
      contract_revision = '1';

      helper(): string {
        return `${this.task_ref}:${this.criterion_ref}`;
      }
    }

    const scopeInstance = new Scope();
    const expected = {
      task_ref: 'task-8',
      criterion_ref: 'host-stop',
      contract_revision: '1'
    };

    const parsed = taskProgressScopeSchema.parse(scopeInstance);
    expect(parsed).toEqual(expected);
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(parsed).not.toBeInstanceOf(Scope);
    expect(taskProgressScopeSchema.safeParse(scopeInstance)).toEqual({
      success: true,
      data: expected
    });

    class ScopeWithGettersAndTag {
      get task_ref(): string {
        return ' task-9 ';
      }
      get criterion_ref(): string {
        return 'host-stop';
      }
      get contract_revision(): string {
        return '2';
      }
      get [Symbol.toStringTag](): string {
        return 'CustomScope';
      }
    }
    expect(taskProgressScopeSchema.parse(new ScopeWithGettersAndTag())).toEqual({
      task_ref: 'task-9',
      criterion_ref: 'host-stop',
      contract_revision: '2'
    });

    const nullProtoScope = Object.assign(Object.create(null), expected);
    expect(taskProgressScopeSchema.parse(nullProtoScope)).toEqual(expected);

    const inheritedScope = Object.create(expected);
    expect(taskProgressScopeSchema.parse(inheritedScope)).toEqual(expected);

    // Non-enumerable own and inherited properties and Symbol keys are ignored by zod 4 strict()
    const nonEnumOwn = Object.defineProperty({ ...expected }, 'hidden', { value: 1, enumerable: false });
    expect(taskProgressScopeSchema.parse(nonEnumOwn)).toEqual(expected);

    const nonEnumProto = Object.assign(
      Object.create(Object.defineProperty({}, 'hidden', { value: 1, enumerable: false })),
      expected
    );
    expect(taskProgressScopeSchema.parse(nonEnumProto)).toEqual(expected);

    const symbolKeyed = { ...expected, [Symbol('meta')]: 1 };
    expect(taskProgressScopeSchema.parse(symbolKeyed)).toEqual(expected);

    // Zod 4 z.object() accepts non-array objects (typeof v === 'object' && v !== null && !Array.isArray(v))
    // when all required fields are present and no unknown enumerable keys exist, normalizing to a plain object
    const builtinWithFields: unknown[] = [
      Object.assign(new Date(), expected),
      Object.assign(new Map(), expected),
      Object.assign(new Set(), expected),
      Object.assign(/scope/, expected),
      Object.assign(new Error('scope'), expected),
      Object.assign(new WeakMap(), expected),
      Object.assign(new WeakSet(), expected),
      Object.assign(new ArrayBuffer(8), expected),
      Object.assign(Promise.resolve(), expected),
      Object.assign(new Uint8Array(0), expected)
    ];
    for (const input of builtinWithFields) {
      const normalized = taskProgressScopeSchema.parse(input);
      expect(normalized).toEqual(expected);
      expect(Object.getPrototypeOf(normalized)).toBe(Object.prototype);
    }

    class ScopeWithExtraField extends Scope {
      extra = 'unexpected';
    }
    const extraResult = taskProgressScopeSchema.safeParse(new ScopeWithExtraField());
    expect(extraResult.success).toBe(false);
    expect(() => taskProgressScopeSchema.parse(new ScopeWithExtraField())).toThrow(TaskProgressValidationError);
  });

  it('rejects empty, whitespace-only, over-512 strings, missing keys, non-record inputs, and indexed views', () => {
    const valid = { task_ref: 't1', criterion_ref: 'c1', contract_revision: '1' };
    const invalidInputs: unknown[] = [
      null,
      undefined,
      'string',
      123,
      true,
      () => {},
      Object.assign(() => {}, valid),
      [],
      Object.assign([], valid),
      new Date(),
      new Map(),
      new Set(),
      /scope/,
      new Error('scope'),
      new WeakMap(),
      new WeakSet(),
      new ArrayBuffer(4),
      new Uint8Array(4),
      Object.assign(new Uint8Array(4), valid),
      Promise.resolve(),
      { task_ref: '', criterion_ref: 'c1', contract_revision: '1' },
      { task_ref: '   \t\n ', criterion_ref: 'c1', contract_revision: '1' },
      { task_ref: 'a'.repeat(513), criterion_ref: 'c1', contract_revision: '1' },
      { task_ref: 't1', criterion_ref: 42, contract_revision: '1' },
      { task_ref: 't1', criterion_ref: 'c1' }
    ];

    for (const input of invalidInputs) {
      const result = taskProgressScopeSchema.safeParse(input);
      expect(result.success).toBe(false);
      expect(() => taskProgressScopeSchema.parse(input)).toThrow(TaskProgressValidationError);
    }
  });
});

describe('taskProgressObservationSchema', () => {
  it('parses all three valid discriminated union variants and trims references', () => {
    expect(taskProgressObservationSchema.parse({
      kind: 'preparation_only',
      evidence_tool_use_ids: ['  tool-1 ', 'tool-2']
    })).toEqual({
      kind: 'preparation_only',
      evidence_tool_use_ids: ['tool-1', 'tool-2']
    });

    expect(taskProgressObservationSchema.parse({
      kind: 'waiting'
    })).toEqual({
      kind: 'waiting'
    });

    expect(taskProgressObservationSchema.parse({
      kind: 'verified_outcome',
      outcome: 'criterion_advanced',
      evidence_tool_use_ids: ['tool-3'],
      verification_ref: '  verify-1  '
    })).toEqual({
      kind: 'verified_outcome',
      outcome: 'criterion_advanced',
      evidence_tool_use_ids: ['tool-3'],
      verification_ref: 'verify-1'
    });

    expect(taskProgressObservationSchema.safeParse({
      kind: 'verified_outcome',
      outcome: 'new_negative_result',
      evidence_tool_use_ids: ['tool-4'],
      verification_ref: 'verify-2'
    })).toEqual({
      success: true,
      data: {
        kind: 'verified_outcome',
        outcome: 'new_negative_result',
        evidence_tool_use_ids: ['tool-4'],
        verification_ref: 'verify-2'
      }
    });
  });

  it('rejects unknown own and inherited enumerable keys on every variant', () => {
    // Exact RUNNER_VERIFY reproduction case for waiting variant
    const inheritedWaiting = Object.assign(Object.create({ extra: undefined }), { kind: 'waiting' });
    const inheritedWaitingResult = taskProgressObservationSchema.safeParse(inheritedWaiting);
    expect(inheritedWaitingResult.success).toBe(false);
    if (!inheritedWaitingResult.success) {
      expect(inheritedWaitingResult.error.issues[0]).toMatchObject({
        code: 'unrecognized_keys',
        keys: ['extra'],
        path: []
      });
    }

    const unknownKeyCases: unknown[] = [
      { kind: 'waiting', extra: 'x' },
      { kind: 'waiting', evidence_tool_use_ids: ['tool-1'] },
      { kind: 'waiting', extra: undefined },
      inheritedWaiting,
      Object.assign(Object.create(null), { kind: 'waiting', extra: 1 }),
      { kind: 'preparation_only', evidence_tool_use_ids: ['tool-1'], extra: 1 },
      Object.assign(Object.create({ extra: undefined }), {
        kind: 'preparation_only',
        evidence_tool_use_ids: ['tool-1']
      }),
      {
        kind: 'verified_outcome',
        outcome: 'criterion_advanced',
        evidence_tool_use_ids: ['tool-1'],
        verification_ref: 'ref-1',
        extra: true
      },
      Object.assign(Object.create({ extra: undefined }), {
        kind: 'verified_outcome',
        outcome: 'criterion_advanced',
        evidence_tool_use_ids: ['tool-1'],
        verification_ref: 'ref-1'
      })
    ];

    for (const input of unknownKeyCases) {
      const result = taskProgressObservationSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.code).toBe('unrecognized_keys');
      }
    }
  });

  it('rejects empty, duplicate (including after trim), whitespace, and over-512 evidence_tool_use_ids', () => {
    const invalidEvidenceCases: unknown[] = [
      { kind: 'preparation_only', evidence_tool_use_ids: [] },
      { kind: 'preparation_only', evidence_tool_use_ids: ['dup', 'dup'] },
      { kind: 'preparation_only', evidence_tool_use_ids: [' dup ', 'dup'] },
      { kind: 'preparation_only', evidence_tool_use_ids: ['   '] },
      { kind: 'preparation_only', evidence_tool_use_ids: ['x'.repeat(513)] },
      { kind: 'preparation_only', evidence_tool_use_ids: [123] },
      { kind: 'preparation_only', evidence_tool_use_ids: 'tool-1' },
      {
        kind: 'verified_outcome',
        outcome: 'new_negative_result',
        evidence_tool_use_ids: ['dup', ' dup '],
        verification_ref: 'ref-1'
      }
    ];

    for (const input of invalidEvidenceCases) {
      const result = taskProgressObservationSchema.safeParse(input);
      expect(result.success).toBe(false);
    }
  });

  it('matches zod 4 parity on class instances, null-prototype objects, inherited valid fields, non-enumerable keys, and built-ins with attached fields', () => {
    class PreparationObservation {
      kind = 'preparation_only' as const;
      evidence_tool_use_ids = [' tool-1 '];
      summary(): string {
        return this.kind;
      }
    }
    class WaitingObservation {
      kind = 'waiting' as const;
      helper(): string {
        return this.kind;
      }
    }
    class VerifiedObservation {
      kind = 'verified_outcome' as const;
      outcome = 'criterion_advanced' as const;
      evidence_tool_use_ids = ['tool-2'];
      verification_ref = ' verify-ref ';
    }
    class WaitingObservationWithExtra extends WaitingObservation {
      extra = 'nope';
    }

    const prepParsed = taskProgressObservationSchema.parse(new PreparationObservation());
    expect(prepParsed).toEqual({
      kind: 'preparation_only',
      evidence_tool_use_ids: ['tool-1']
    });
    expect(Object.getPrototypeOf(prepParsed)).toBe(Object.prototype);

    expect(taskProgressObservationSchema.safeParse(new WaitingObservation())).toEqual({
      success: true,
      data: { kind: 'waiting' }
    });

    expect(taskProgressObservationSchema.parse(new VerifiedObservation())).toEqual({
      kind: 'verified_outcome',
      outcome: 'criterion_advanced',
      evidence_tool_use_ids: ['tool-2'],
      verification_ref: 'verify-ref'
    });

    expect(taskProgressObservationSchema.parse(Object.assign(Object.create(null), { kind: 'waiting' }))).toEqual({
      kind: 'waiting'
    });
    expect(taskProgressObservationSchema.parse(Object.create({ kind: 'waiting' }))).toEqual({
      kind: 'waiting'
    });
    expect(
      taskProgressObservationSchema.parse(
        Object.defineProperty({ kind: 'waiting' }, 'hidden', { value: 1, enumerable: false })
      )
    ).toEqual({ kind: 'waiting' });

    const builtinWaitingCases: unknown[] = [
      Object.assign(new Date(), { kind: 'waiting' }),
      Object.assign(new Map(), { kind: 'waiting' }),
      Object.assign(new Set(), { kind: 'waiting' }),
      Object.assign(/waiting/, { kind: 'waiting' }),
      Object.assign(new Error('waiting'), { kind: 'waiting' }),
      Object.assign(new WeakMap(), { kind: 'waiting' }),
      Object.assign(new WeakSet(), { kind: 'waiting' }),
      Object.assign(new ArrayBuffer(4), { kind: 'waiting' }),
      Object.assign(Promise.resolve(), { kind: 'waiting' }),
      Object.assign(new Uint8Array(0), { kind: 'waiting' })
    ];
    for (const input of builtinWaitingCases) {
      const parsed = taskProgressObservationSchema.parse(input);
      expect(parsed).toEqual({ kind: 'waiting' });
      expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    }

    expect(taskProgressObservationSchema.safeParse(new WaitingObservationWithExtra()).success).toBe(false);
  });

  it('rejects invalid kind, invalid outcome, invalid verification_ref, non-record inputs, and indexed views', () => {
    const invalidCases: unknown[] = [
      null,
      undefined,
      'waiting',
      42,
      true,
      () => {},
      Object.assign(() => {}, { kind: 'waiting' }),
      [],
      Object.assign([], { kind: 'waiting' }),
      new Date(),
      new Map(),
      new Set(),
      /waiting/,
      new Error('waiting'),
      new WeakMap(),
      new WeakSet(),
      new ArrayBuffer(4),
      new Uint8Array(1),
      Object.assign(new Uint8Array(4), { kind: 'waiting' }),
      Promise.resolve(),
      {},
      { kind: 'unknown' },
      { kind: 123 },
      {
        kind: 'verified_outcome',
        outcome: 'unsupported',
        evidence_tool_use_ids: ['tool-1'],
        verification_ref: 'ref-1'
      },
      {
        kind: 'verified_outcome',
        outcome: 'criterion_advanced',
        evidence_tool_use_ids: ['tool-1'],
        verification_ref: '   '
      },
      {
        kind: 'verified_outcome',
        outcome: 'criterion_advanced',
        evidence_tool_use_ids: ['tool-1'],
        verification_ref: 'v'.repeat(513)
      }
    ];

    for (const input of invalidCases) {
      const result = taskProgressObservationSchema.safeParse(input);
      expect(result.success).toBe(false);
      expect(() => taskProgressObservationSchema.parse(input)).toThrow(TaskProgressValidationError);
    }
  });
});
