// @ts-check
/**
 * Account Service
 * SPEC-account-foundation Contract-2
 */

import { InMemoryAccountRepository } from './account-repository.js';

const ROLE_RANK = { member: 1, gm: 3, ceo: 4 };

export class AccountService {
    constructor({ repository } = {}) {
        this.repository = repository || new InMemoryAccountRepository();
    }

    async create(input, actor) {
        const record = await this.repository.create({ ...input, created_by_person_id: actor.actor_person_id });
        await this.repository.recordAudit({
            account_id: record.id,
            actor_person_id: actor.actor_person_id,
            action: 'CONNECTED',
            context: { service: record.service, scope_type: record.scope_type, display_name: record.display_name }
        });
        return record;
    }

    async revoke(id, actor) {
        const r = await this.repository.updateStatus(id, 'revoked', actor);
        await this.repository.recordAudit({
            account_id: id,
            actor_person_id: actor.actor_person_id,
            action: 'REVOKED'
        });
        return r;
    }

    async reauthorize(id, actor) {
        const r = await this.repository.updateStatus(id, 'connected', actor);
        await this.repository.recordAudit({
            account_id: id,
            actor_person_id: actor.actor_person_id,
            action: 'REAUTHORIZED'
        });
        return r;
    }

    async listForActor(actor) {
        return (await this.repository.list({})).filter((acc) => this._canViewSync(acc, actor));
    }

    _canViewSync(acc, actor) {
        if (acc.scope_type === 'personal') {
            return acc.owner_person_id === actor.sub;
        }
        if (acc.scope_type === 'org') {
            const memberOrgs = actor.org_ids || [];
            return memberOrgs.includes(acc.org_id);
        }
        if (acc.scope_type === 'project') {
            const memberProjects = actor.projectCodes || actor.project_ids || [];
            return memberProjects.includes(acc.project_id);
        }
        return false;
    }

    async setDefault({ subject_type, subject_id, service, purpose, account_id }, actor) {
        const acc = await this.repository.findById(account_id);
        if (!acc) throw new Error(`account not found: ${account_id}`);
        await this.repository.setDefault({
            subject_type, subject_id, service, purpose, account_id,
            created_by_person_id: actor.actor_person_id
        });
        await this.repository.recordAudit({
            account_id,
            actor_person_id: actor.actor_person_id,
            action: 'DEFAULT_CHANGED',
            context: { subject_type, subject_id, service, purpose }
        });
    }

    async getDefault(subject_type, subject_id, service, purpose) {
        const def = await this.repository.getDefault(subject_type, subject_id, service, purpose);
        if (!def) return null;
        return this.repository.findById(def.account_id);
    }

    async canUseForPost(account_id, actor) {
        const acc = await this.repository.findById(account_id);
        if (!acc) return { allow: false, reason: 'account-not-found' };
        if (acc.status !== 'connected') return { allow: false, reason: `status-${acc.status}` };

        // INV-5: scope_type=personal は owner のみ
        if (acc.scope_type === 'personal') {
            if (acc.owner_person_id !== actor.sub) {
                return { allow: false, reason: 'personal-owner-mismatch' };
            }
            return { allow: true, reason: 'personal-owner' };
        }

        // org account: org membership + role_min=gm 以上
        if (acc.scope_type === 'org') {
            const memberOrgs = actor.org_ids || [];
            if (!memberOrgs.includes(acc.org_id)) return { allow: false, reason: 'org-not-member' };
            const role = actor.role || 'member';
            if ((ROLE_RANK[role] || 1) < ROLE_RANK.gm) return { allow: false, reason: 'role-too-low-for-org-post' };
            return { allow: true, reason: 'org-member-with-role' };
        }

        // project account: project membership + role_min=gm 以上
        if (acc.scope_type === 'project') {
            const memberProjects = actor.projectCodes || actor.project_ids || [];
            if (!memberProjects.includes(acc.project_id)) return { allow: false, reason: 'project-not-member' };
            return { allow: true, reason: 'project-member' };
        }

        return { allow: false, reason: 'unknown-scope' };
    }

    async recordPost(account_id, actor) {
        await this.repository.recordAudit({
            account_id,
            actor_person_id: actor.actor_person_id,
            action: 'USED_FOR_POST'
        });
    }

    async listAudit(account_id) {
        return this.repository.listAudit(account_id);
    }
}
