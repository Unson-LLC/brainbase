import { describe, expect, it } from 'vitest';

import {
  createCanonicalTaskPrincipal,
  normalizeCanonicalTaskPrincipal,
  principalNamespace,
} from '../src/canonical-task-principal.js';

describe('Canonical Task principal', () => {
  it('本人・サービス・内部処理の主体を同じ契約で生成する', () => {
    expect(createCanonicalTaskPrincipal({ authSource: 'session', personId: 'per_1' }))
      .toEqual({ type: 'person', id: 'per_1' });
    expect(createCanonicalTaskPrincipal({ authSource: 'service-token', serviceId: 'svc_1' }))
      .toEqual({ type: 'service', id: 'svc_1' });
    expect(createCanonicalTaskPrincipal({ authSource: 'internal', internalId: 'routine' }))
      .toEqual({ type: 'internal', id: 'routine' });
  });

  it('未認証主体と制御文字を拒否する', () => {
    expect(() => createCanonicalTaskPrincipal({ authSource: 'cookie', personId: 'per_1' }))
      .toThrow('trusted authentication');
    expect(() => normalizeCanonicalTaskPrincipal({ type: 'person', id: 'bad\nvalue' }))
      .toThrow('control characters');
  });

  it('型を含む安定した名前空間を生成する', () => {
    const person = principalNamespace({ type: 'person', id: 'same' });
    const service = principalNamespace({ type: 'service', id: 'same' });
    expect(person).toMatch(/^v1\./u);
    expect(person).not.toBe(service);
  });
});
