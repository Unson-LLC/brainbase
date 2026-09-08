import { describe, expect, it, vi } from 'vitest';

import { ContractError } from '../../../../server/services/multitenant/errors.js';
import {
    FIXED_MANA_SLACK_CONNECTION,
    FixedManaSlackConnectionAdoptionService
} from '../../../../server/services/multitenant/slack-installation-adoption-service.js';

const RAW_TOKEN = 'xoxb-token-never-leaves-the-secret-boundary';
const OPAQUE_REF = 'credref://bbcs/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function fixtures(overrides = {}) {
    const repository = {
        inspectFixedManaSlackConnection: vi.fn(async () => ({ state: 'absent' })),
        adoptFixedManaSlackConnection: vi.fn(async () => ({
            state: 'adopted',
            tenant_id: FIXED_MANA_SLACK_CONNECTION.tenant_id,
            connection_id: FIXED_MANA_SLACK_CONNECTION.connection_id,
            connection_revision: FIXED_MANA_SLACK_CONNECTION.connection_revision,
            status: 'active'
        })),
        recordFixedManaSlackConnectionAdoptionOrphan: vi.fn(async () => ({ state: 'orphaned' })),
        ...overrides.repository
    };
    const slack = {
        authTest: vi.fn(async () => ({
            ok: true,
            team_id: FIXED_MANA_SLACK_CONNECTION.workspace_id,
            team: FIXED_MANA_SLACK_CONNECTION.team_name,
            user_id: FIXED_MANA_SLACK_CONNECTION.bot_user_id,
            bot_id: FIXED_MANA_SLACK_CONNECTION.bot_id
        })),
        listScopes: vi.fn(async () => [...FIXED_MANA_SLACK_CONNECTION.required_scopes]),
        ...overrides.slack
    };
    const credentialStore = {
        store: vi.fn(async () => ({
            credential_ref: OPAQUE_REF,
            credential_mode: 'customer_oauth',
            refresh_revision: 1
        })),
        verify: vi.fn(async () => ({ valid: true })),
        revoke: vi.fn(async () => ({ status: 'revoked' })),
        ...overrides.credentialStore
    };
    const service = new FixedManaSlackConnectionAdoptionService({
        repository,
        slack,
        credentialStore,
        botToken: RAW_TOKEN,
        readback: overrides.readback ?? vi.fn(async () => ({
            connection: { status: 'active' }, revision: { connection_revision: '1' }, credential: { credential_mode: 'customer_oauth' }
        }))
    });
    return { service, repository, slack, credentialStore };
}

function expectNoSecret(value) {
    const serialized = JSON.stringify(value);
    expect(serialized).not.toContain(RAW_TOKEN);
    expect(serialized).not.toContain(OPAQUE_REF);
}

describe('FixedManaSlackConnectionAdoptionService', () => {
    it('keeps dry-run and check non-mutating, and requires a second explicit approval for apply', async () => {
        const { service, repository, slack, credentialStore } = fixtures();

        await expect(service.execute({ mode: 'dry-run' })).resolves.toMatchObject({
            state: 'dry_run', target: expect.objectContaining({ connection_id: FIXED_MANA_SLACK_CONNECTION.connection_id })
        });
        expect(slack.authTest).not.toHaveBeenCalled();
        await expect(service.execute({ mode: 'check' })).resolves.toMatchObject({ state: 'checked' });
        expect(credentialStore.store).not.toHaveBeenCalled();
        expect(repository.adoptFixedManaSlackConnection).not.toHaveBeenCalled();
        await expect(service.execute({ mode: 'apply' })).rejects.toMatchObject({ code: 'ADOPTION_APPROVAL_REQUIRED', status: 403 });
        expect(credentialStore.store).not.toHaveBeenCalled();
    });

    it.each([
        ['workspace', { authTest: vi.fn(async () => ({ ok: true, team_id: 'Twrong', team: FIXED_MANA_SLACK_CONNECTION.team_name, user_id: FIXED_MANA_SLACK_CONNECTION.bot_user_id, bot_id: FIXED_MANA_SLACK_CONNECTION.bot_id })) }],
        ['team', { authTest: vi.fn(async () => ({ ok: true, team_id: FIXED_MANA_SLACK_CONNECTION.workspace_id, team: 'wrong team', user_id: FIXED_MANA_SLACK_CONNECTION.bot_user_id, bot_id: FIXED_MANA_SLACK_CONNECTION.bot_id })) }],
        ['bot', { authTest: vi.fn(async () => ({ ok: true, team_id: FIXED_MANA_SLACK_CONNECTION.workspace_id, team: FIXED_MANA_SLACK_CONNECTION.team_name, user_id: FIXED_MANA_SLACK_CONNECTION.bot_user_id, bot_id: 'Bwrong' })) }],
        ['missing scope', { listScopes: vi.fn(async () => FIXED_MANA_SLACK_CONNECTION.required_scopes.slice(1)) }],
        ['extra scope', { listScopes: vi.fn(async () => [...FIXED_MANA_SLACK_CONNECTION.required_scopes, 'admin.users:read']) }],
        ['duplicate scope', { listScopes: vi.fn(async () => [...FIXED_MANA_SLACK_CONNECTION.required_scopes, 'chat:write']) }]
    ])('rejects a %s mismatch before the credential boundary', async (_label, slack) => {
        const { service, repository, credentialStore } = fixtures({ slack });

        await expect(service.execute({ mode: 'apply', approved: true })).rejects.toMatchObject({
            code: 'FIXED_MANA_SLACK_BINDING_MISMATCH', status: 409
        });
        expect(credentialStore.store).not.toHaveBeenCalled();
        expect(repository.adoptFixedManaSlackConnection).not.toHaveBeenCalled();
    });

    it('normalizes scope order but never accepts a duplicate as the fixed scope set', async () => {
        const { service } = fixtures({ slack: {
            listScopes: vi.fn(async () => [...FIXED_MANA_SLACK_CONNECTION.required_scopes].reverse())
        } });
        await expect(service.execute({ mode: 'check' })).resolves.toMatchObject({ state: 'checked' });
    });

    it('stores only an opaque reference, commits the fixed three-record adoption, then uses a separate readback client', async () => {
        const readback = vi.fn(async () => ({
            connection: { status: 'active' }, revision: { connection_revision: '1' }, credential: { credential_mode: 'customer_oauth' }
        }));
        const { service, repository, credentialStore } = fixtures({ readback });

        const result = await service.execute({ mode: 'apply', approved: true });

        expect(credentialStore.store).toHaveBeenCalledWith(expect.objectContaining({
            tenant_id: FIXED_MANA_SLACK_CONNECTION.tenant_id,
            connection_id: FIXED_MANA_SLACK_CONNECTION.connection_id,
            credential_material: RAW_TOKEN
        }));
        expect(credentialStore.verify).toHaveBeenCalledWith(expect.objectContaining({ credential_ref: OPAQUE_REF }));
        expect(repository.adoptFixedManaSlackConnection).toHaveBeenCalledWith(expect.objectContaining({
            definition: FIXED_MANA_SLACK_CONNECTION,
            credential: { credential_ref: OPAQUE_REF, credential_mode: 'customer_oauth', refresh_revision: '1' }
        }));
        expect(readback).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({ state: 'adopted', status: 'active' });
        expectNoSecret(result);
    });

    it('is idempotent only for the exact immutable snapshot and verifies its existing credential without storing a second one', async () => {
        const existing = {
            state: 'existing',
            credential: { credential_ref: OPAQUE_REF, credential_mode: 'customer_oauth', refresh_revision: '1' },
            snapshot: { ...FIXED_MANA_SLACK_CONNECTION, granted_scopes: [...FIXED_MANA_SLACK_CONNECTION.required_scopes], status: 'active' }
        };
        const { service, credentialStore } = fixtures({ repository: {
            inspectFixedManaSlackConnection: vi.fn(async () => existing)
        } });

        await expect(service.execute({ mode: 'apply', approved: true })).resolves.toMatchObject({ state: 'already_adopted' });
        expect(credentialStore.store).not.toHaveBeenCalled();
        expect(credentialStore.verify).toHaveBeenCalledWith(expect.objectContaining({ credential_ref: OPAQUE_REF }));

        const { service: conflictService, credentialStore: conflictStore } = fixtures({ repository: {
            inspectFixedManaSlackConnection: vi.fn(async () => ({
                ...existing, snapshot: { ...existing.snapshot, installation_id: 'wrong-installation' }
            }))
        } });
        await expect(conflictService.execute({ mode: 'apply', approved: true })).rejects.toMatchObject({
            code: 'FIXED_MANA_SLACK_CONNECTION_CONFLICT', status: 409
        });
        expect(conflictStore.store).not.toHaveBeenCalled();
    });

    it('rolls back the database transaction, revokes the opaque reference, and durably blocks retry when revoke fails without disclosing it', async () => {
        const databaseFailure = new ContractError('UPSTREAM_UNAVAILABLE', { status: 503 });
        const { service, repository, credentialStore } = fixtures({
            repository: { adoptFixedManaSlackConnection: vi.fn(async () => { throw databaseFailure; }) }
        });
        await expect(service.execute({ mode: 'apply', approved: true })).rejects.toBe(databaseFailure);
        expect(credentialStore.revoke).toHaveBeenCalledWith(expect.objectContaining({
            credential_ref: OPAQUE_REF, reason: 'fixed_mana_adoption_db_failed'
        }));
        expect(repository.recordFixedManaSlackConnectionAdoptionOrphan).not.toHaveBeenCalled();

        const { service: orphanService, repository: orphanRepository, credentialStore: orphanStore } = fixtures({
            repository: { adoptFixedManaSlackConnection: vi.fn(async () => { throw databaseFailure; }) },
            credentialStore: { revoke: vi.fn(async () => { throw new Error('store unavailable'); }) }
        });
        let captured;
        await orphanService.execute({ mode: 'apply', approved: true }).catch((error) => { captured = error; });
        expect(captured).toMatchObject({ code: 'FIXED_MANA_SLACK_CREDENTIAL_ORPHANED', status: 503 });
        expect(orphanRepository.recordFixedManaSlackConnectionAdoptionOrphan).toHaveBeenCalledWith(expect.objectContaining({
            credential: expect.objectContaining({ credential_ref: OPAQUE_REF })
        }));
        expectNoSecret({ result: captured });
        expect(captured.message).not.toContain(RAW_TOKEN);
        expect(captured.message).not.toContain(OPAQUE_REF);
        expect(orphanStore.revoke).toHaveBeenCalledTimes(1);
    });

    it('converts an unexpected credential-store error into a coded error without its secret-bearing message', async () => {
        const { service } = fixtures({ credentialStore: {
            store: vi.fn(async () => { throw new Error(`credential rejected: ${RAW_TOKEN}`); })
        } });

        let captured;
        await service.execute({ mode: 'apply', approved: true }).catch((error) => { captured = error; });
        expect(captured).toMatchObject({ code: 'FIXED_MANA_SLACK_CREDENTIAL_STORE_FAILED', status: 503 });
        expect(captured.message).not.toContain(RAW_TOKEN);
        expect(captured.message).not.toContain(OPAQUE_REF);
    });
});
