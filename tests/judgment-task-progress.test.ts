import { describe, expect, it } from 'vitest';
import {
  TaskProgressValidationError,
  taskProgressObservationSchema,
  taskProgressScopeSchema
} from '../src/judgment-task-progress.js';

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

  it('rejects unknown keys strictly (including keys with undefined values)', () => {
    const extra = taskProgressScopeSchema.safeParse({
      task_ref: 't1',
      criterion_ref: 'c1',
      contract_revision: '1',
      extra: 'nope'
    });
    expect(extra.success).toBe(false);

    const extraUndefined = taskProgressScopeSchema.safeParse({
      task_ref: 't1',
      criterion_ref: 'c1',
      contract_revision: '1',
      extra: undefined
    });
    expect(extraUndefined.success).toBe(false);
    expect(() => taskProgressScopeSchema.parse({
      task_ref: 't1',
      criterion_ref: 'c1',
      contract_revision: '1',
      extra: true
    })).toThrow(TaskProgressValidationError);
  });

  it('rejects empty, whitespace-only, over-512 strings, missing keys, and non-object inputs', () => {
    const invalidInputs: unknown[] = [
      null,
      undefined,
      'string',
      123,
      [],
      new Date(),
      { task_ref: '', criterion_ref: 'c1', contract_revision: '1' },
      { task_ref: '   \t\n ', criterion_ref: 'c1', contract_revision: '1' },
      { task_ref: 'a'.repeat(513), criterion_ref: 'c1', contract_revision: '1' },
      { task_ref: 't1', criterion_ref: 42, contract_revision: '1' },
      { task_ref: 't1', criterion_ref: 'c1' },
      Object.create({ task_ref: 't1', criterion_ref: 'c1', contract_revision: '1' })
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

  it('rejects unknown keys on every variant', () => {
    const unknownKeyCases: unknown[] = [
      { kind: 'waiting', extra: 'x' },
      { kind: 'waiting', evidence_tool_use_ids: ['tool-1'] },
      { kind: 'waiting', extra: undefined },
      { kind: 'preparation_only', evidence_tool_use_ids: ['tool-1'], extra: 1 },
      {
        kind: 'verified_outcome',
        outcome: 'criterion_advanced',
        evidence_tool_use_ids: ['tool-1'],
        verification_ref: 'ref-1',
        extra: true
      }
    ];

    for (const input of unknownKeyCases) {
      expect(taskProgressObservationSchema.safeParse(input).success).toBe(false);
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

  it('rejects invalid kind, invalid outcome, invalid verification_ref, and non-object inputs', () => {
    const invalidCases: unknown[] = [
      null,
      undefined,
      'waiting',
      42,
      [],
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
