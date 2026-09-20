import { describe, expect, it } from 'vitest';

import {
  CANONICAL_TASK_PRIORITIES,
  CANONICAL_TASK_STATUSES,
  canTransitionCanonicalTaskStatus,
  hasInvalidCanonicalTaskProjectCode,
  isCanonicalTaskPriority,
  isCanonicalTaskStatus,
  normalizeCanonicalTaskProjectCodes,
} from '../src/canonical-task-contract.js';

describe('Canonical Task contract', () => {
  it('公開する状態と優先度を安定した列挙として扱う', () => {
    expect(CANONICAL_TASK_STATUSES).toEqual([
      'pending',
      'in_progress',
      'waiting',
      'completed',
      'cancelled',
    ]);
    expect(CANONICAL_TASK_PRIORITIES).toEqual(['low', 'medium', 'high', 'urgent']);
    expect(isCanonicalTaskStatus('waiting')).toBe(true);
    expect(isCanonicalTaskStatus('unknown')).toBe(false);
    expect(isCanonicalTaskPriority('urgent')).toBe(true);
    expect(isCanonicalTaskPriority('critical')).toBe(false);
  });

  it('案件コードをCSVと配列から正規化して重複を除く', () => {
    expect(normalizeCanonicalTaskProjectCodes([' mana ', 'brainbase,mana']))
      .toEqual(['mana', 'brainbase']);
    expect(normalizeCanonicalTaskProjectCodes('growin, brainbase'))
      .toEqual(['growin', 'brainbase']);
  });

  it('空値・非文字列・100文字超の案件コードを拒否対象にする', () => {
    expect(hasInvalidCanonicalTaskProjectCode(['mana', ''])).toBe(true);
    expect(hasInvalidCanonicalTaskProjectCode([123])).toBe(true);
    expect(hasInvalidCanonicalTaskProjectCode(['x'.repeat(101)])).toBe(true);
    expect(hasInvalidCanonicalTaskProjectCode(['mana', 'brainbase'])).toBe(false);
  });

  it('現行の状態遷移だけを許可する', () => {
    expect(canTransitionCanonicalTaskStatus('pending', 'completed')).toBe(true);
    expect(canTransitionCanonicalTaskStatus('waiting', 'in_progress')).toBe(true);
    expect(canTransitionCanonicalTaskStatus('cancelled', 'pending')).toBe(true);
    expect(canTransitionCanonicalTaskStatus('completed', 'in_progress')).toBe(false);
    expect(canTransitionCanonicalTaskStatus('pending', 'pending')).toBe(false);
    expect(canTransitionCanonicalTaskStatus('unknown', 'pending')).toBe(false);
  });
});
