import { describe, expect, it } from 'vitest';
import {
    buildScopedMemoryResult,
    evaluateMemoryScope,
    filterScopedMemoryRecords,
    normalizeMemoryAccessContext,
    normalizeMemoryRecord
} from '../src/memory-scope-policy.js';

const context = {
    person_id: 'per_owner',
    roles: ['member'],
    project_codes: ['brainbase'],
    clearance: ['internal'],
    workspace: 'unson',
    channel_id: 'C1'
};

function record(payload: Record<string, unknown>) {
    return { id: 'row-1', payload };
}

describe('memory scope policy', () => {
    it('normalizes both snake_case and camelCase access context and de-duplicates lists', () => {
        expect(normalizeMemoryAccessContext({
            personId: ' per_a ', role: 'GM, member', projectCodes: 'p1,p1,p2', sensitivity: 'Internal'
        })).toEqual({
            person_id: 'per_a',
            workspace: null,
            channel_id: null,
            session_id: null,
            roles: ['gm', 'member'],
            role_rank: 2,
            project_codes: ['p1', 'p2'],
            clearance: ['internal']
        });
    });

    it('reads a JSON string payload and falls back to defaults', () => {
        expect(normalizeMemoryRecord({ id: 'r', payload: JSON.stringify({ visibility: 'project', project_code: 'p' }) }))
            .toMatchObject({ id: 'r', visibility: 'project', project_code: 'p', role_min: 'member', sensitivity: 'internal' });
        expect(normalizeMemoryRecord({ id: 'r', payload: '{not json' })).toMatchObject({ id: 'r', visibility: 'unknown' });
    });

    it('denies by default when the access policy is incomplete', () => {
        expect(evaluateMemoryScope(record({ visibility: 'project' }), { person_id: 'per_owner' }))
            .toEqual({ id: 'row-1', visibility: 'project', reason: 'missing_access_policy', allowed: false });
    });

    it.each([
        [{ visibility: 'unknown' }, 'invalid_memory_record'],
        [{ visibility: 'project', workspace: 'other' }, 'workspace_mismatch'],
        [{ visibility: 'project', project_code: 'other' }, 'project_mismatch'],
        [{ visibility: 'project', channel_id: 'C2' }, 'channel_mismatch'],
        [{ visibility: 'project', sensitivity: 'finance' }, 'sensitivity_denied'],
        [{ visibility: 'project', role_min: 'gm' }, 'role_denied'],
        [{ visibility: 'private', owner_person_id: 'per_other' }, 'private_scope_denied'],
        [{ visibility: 'secret' }, 'visibility_denied']
    ])('denies %j with %s', (payload, reason) => {
        expect(evaluateMemoryScope(record(payload), context)).toMatchObject({ allowed: false, reason });
    });

    it('lets the owner read a private record but not an elevated role', () => {
        expect(evaluateMemoryScope(record({ visibility: 'private', owner_person_id: 'per_owner' }), context))
            .toEqual({ id: 'row-1', visibility: 'private', reason: null, allowed: true });
        expect(evaluateMemoryScope(record({ visibility: 'private', owner_person_id: 'per_owner' }), { ...context, roles: ['ceo'] }))
            .toMatchObject({ allowed: false, reason: 'private_scope_denied' });
    });

    it('splits records into allowed and denied with counts', () => {
        const allowed = record({ visibility: 'org' });
        const denied = { id: 'row-2', payload: { visibility: 'project', project_code: 'other' } };
        const result = buildScopedMemoryResult([allowed, denied], context);
        expect(result).toEqual({
            mode: 'deny_by_default',
            records: [allowed],
            denied: [{ id: 'row-2', visibility: 'project', reason: 'project_mismatch', allowed: false }],
            meta: { evaluated_count: 2, returned_count: 1, denied_count: 1 }
        });
        expect(filterScopedMemoryRecords([allowed, denied], context)).toEqual([allowed]);
    });
});
