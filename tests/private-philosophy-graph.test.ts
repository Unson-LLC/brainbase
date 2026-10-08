import { describe, expect, it } from 'vitest';
import { assertPrivatePhilosophyRead, assertPrivatePhilosophyWrite, privatePhilosophyAcl } from '../src/private-philosophy-graph.js';
const acl = { ownerId: 'alice', visibility: 'private', readerIds: [], writerIds: [] };
const payload = () => ({ statement: 'Prefer sustainable growth', acl: { ...acl }, judgmentApplicability: { scope: { type: 'project', id: 'project-1' }, validFrom: '2026-10-08T00:00:00Z' } });
const input = () => ({ payload: payload(), principal: 'alice', projectCode: 'project-1', currentVersion: 0, expectedVersion: 0 });
describe('private Philosophy Graph boundary', () => {
  it('keeps unmarked legacy payload unchanged', () => {
    expect(privatePhilosophyAcl({ title: 'Legacy' })).toBeUndefined();
    expect(() => assertPrivatePhilosophyWrite({ ...input(), payload: { title: 'Legacy' }, expectedVersion: undefined })).not.toThrow();
  });
  it('allows owner creation, exact-version edit and read', () => {
    expect(() => assertPrivatePhilosophyWrite(input())).not.toThrow();
    expect(() => assertPrivatePhilosophyWrite({ ...input(), currentPayload: payload(), currentVersion: 1, expectedVersion: 1 })).not.toThrow();
    expect(assertPrivatePhilosophyRead(payload(), 'alice')).toEqual(acl);
  });
  it.each([null, {}, { ...acl, visibility: 'public' }, { ...acl, ownerId: ' ' }, { ...acl, readerIds: ['bob'] }, { ...acl, writerIds: ['bob'] }])('rejects malformed or broadened ACL %j', bad => {
    expect(() => privatePhilosophyAcl({ acl: bad })).toThrow();
  });
  it.each(['bob', 'ceo'])('refuses another actor %s', principal => {
    expect(() => assertPrivatePhilosophyRead(payload(), principal)).toThrow(/owner-only/);
    expect(() => assertPrivatePhilosophyWrite({ ...input(), principal })).toThrow(/owner/);
  });
  it.each([undefined, -1, 1, 0.5, Number.NaN])('requires exact version %s', expectedVersion => {
    expect(() => assertPrivatePhilosophyWrite({ ...input(), expectedVersion })).toThrow(/version/);
  });
  it('refuses private ACL removal, owner change, scope move and legacy conversion', () => {
    const currentPayload = payload();
    for (const next of [{ ...payload(), acl: undefined }, { ...payload(), acl: { ...acl, ownerId: 'bob' } }, { ...payload(), judgmentApplicability: { ...payload().judgmentApplicability, scope: {type: 'project', id: 'project-2'} } }]) {
      expect(() => assertPrivatePhilosophyWrite({ ...input(), currentPayload, payload: next })).toThrow();
    }
    expect(() => assertPrivatePhilosophyWrite({ ...input(), currentPayload: { title: 'Legacy' } })).toThrow(/migration/);
  });
  it('rejects an invalid statement or applicability interval', () => {
    expect(() => assertPrivatePhilosophyWrite({ ...input(), payload: { ...payload(), statement: '' } })).toThrow();
    expect(() => assertPrivatePhilosophyWrite({ ...input(), payload: { ...payload(), judgmentApplicability: { ...payload().judgmentApplicability, validFrom: 'invalid' } } })).toThrow();
  });
});
