// @ts-check
import { describe, expect, it } from 'vitest';
import { InMemoryAccountRepository } from '../../../server/services/account/account-repository.js';

describe('account defaults deterministic resolution', () => {
    it('orders legacy duplicate defaults by priority then C-style account_id order', () => {
        const repo = new InMemoryAccountRepository();
        repo.defaults.set('legacy-lower', {
            subject_type: 'org', subject_id: 'org_a', service: 'freee', purpose: 'runtime_read',
            account_id: 'acc_a', priority: 100, created_by_person_id: 'per_admin'
        });
        repo.defaults.set('legacy-priority', {
            subject_type: 'org', subject_id: 'org_a', service: 'freee', purpose: 'runtime_read',
            account_id: 'acc_c', priority: 50, created_by_person_id: 'per_admin'
        });
        repo.defaults.set('legacy-upper', {
            subject_type: 'org', subject_id: 'org_a', service: 'freee', purpose: 'runtime_read',
            account_id: 'acc_A', priority: 100, created_by_person_id: 'per_admin'
        });
        repo.defaults.set('legacy-underscore', {
            subject_type: 'org', subject_id: 'org_a', service: 'freee', purpose: 'runtime_read',
            account_id: 'acc__', priority: 100, created_by_person_id: 'per_admin'
        });

        expect(repo.listDefaults('org', 'org_a', 'freee', 'runtime_read').map((row) => row.account_id))
            .toEqual(['acc_c', 'acc_A', 'acc__', 'acc_a']);
        expect(repo.getDefault('org', 'org_a', 'freee', 'runtime_read')?.account_id).toBe('acc_c');
    });
});
