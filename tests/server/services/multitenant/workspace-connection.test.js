import { describe, expect, it } from 'vitest';
import { WorkspaceConnectionRegistry } from '../../../../server/services/multitenant/workspace-connection-registry.js';

const tenantA = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const tenantB = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAW';

describe('WorkspaceConnectionRegistry', () => {
    it('AC-101/102/103: 複数workspace、再install履歴、監査field、単調revisionを正本化する', () => {
        const registry = new WorkspaceConnectionRegistry();
        const first = registry.register({
            tenant_id: tenantA,
            provider: 'slack',
            installation_id: 'install-1', workspace_id: 'workspace-1', app_id: 'app-1',
            granted_scopes: ['chat:write'], credential_ref: 'credref:one'
        });
        const second = registry.register({
            tenant_id: tenantA,
            provider: 'slack',
            installation_id: 'install-2', workspace_id: 'workspace-2', app_id: 'app-1',
            granted_scopes: ['chat:write'], credential_ref: 'credref:two'
        });
        const reinstalled = registry.reinstall({
            tenant_id: tenantA,
            connection_id: first.connection_id,
            expected_connection_revision: 1,
            installation_id: 'install-3',
            granted_scopes: ['chat:write', 'channels:read'],
            credential_ref: 'credref:three'
        });

        expect(first.connection_id).not.toBe(second.connection_id);
        expect(reinstalled.connection_id).toBe(first.connection_id);
        expect(reinstalled.connection_revision).toBe(2);
        expect(reinstalled.supersedes_connection_revision).toBe(1);
        expect(registry.history(first.connection_id)).toHaveLength(2);
    });

    it('AC-104: credential本文らしい入力を保存前に拒否する', () => {
        const registry = new WorkspaceConnectionRegistry();
        expect(() => registry.register({
            tenant_id: tenantA,
            provider: 'slack', installation_id: 'i', workspace_id: 'w', app_id: 'a',
            granted_scopes: [], credential_ref: 'credref:opaque', access_token: 'forbidden'
        })).toThrowErrorMatchingObject({ code: 'SECRET_ARTIFACT_FORBIDDEN' });
    });

    it('AC-105: 未登録、失効、別tenant、別app、scope不足、stale revisionを区別する', () => {
        const registry = new WorkspaceConnectionRegistry();
        const connection = registry.register({
            tenant_id: tenantA,
            provider: 'slack', installation_id: 'i', workspace_id: 'w', app_id: 'a',
            granted_scopes: ['chat:write'], credential_ref: 'credref:opaque'
        });

        expect(() => registry.validateRevision({ tenant_id: tenantA, connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAV', expected_connection_revision: 1 }))
            .toThrowErrorMatchingObject({ code: 'WORKSPACE_CONNECTION_UNAVAILABLE' });
        expect(() => registry.validateRevision({ tenant_id: tenantB, connection_id: connection.connection_id, expected_connection_revision: 1 }))
            .toThrowErrorMatchingObject({ code: 'CROSS_TENANT_CANDIDATE' });
        expect(() => registry.validateRevision({ tenant_id: tenantA, connection_id: connection.connection_id, expected_connection_revision: 1, app_id: 'other' }))
            .toThrowErrorMatchingObject({ code: 'WORKSPACE_OR_APP_MISMATCH' });
        expect(() => registry.validateRevision({ tenant_id: tenantA, connection_id: connection.connection_id, expected_connection_revision: 1, required_scopes: ['channels:read'] }))
            .toThrowErrorMatchingObject({ code: 'CAPABILITY_SCOPE_MISMATCH' });
        registry.reinstall({ tenant_id: tenantA, connection_id: connection.connection_id, expected_connection_revision: 1, installation_id: 'i2', granted_scopes: ['chat:write'], credential_ref: 'credref:new' });
        expect(() => registry.validateRevision({ tenant_id: tenantA, connection_id: connection.connection_id, expected_connection_revision: 1 }))
            .toThrowErrorMatchingObject({ code: 'WORKSPACE_CONNECTION_STALE_REVISION' });
        registry.revoke({ tenant_id: tenantA, connection_id: connection.connection_id, expected_connection_revision: 2, reason: 'admin' });
        expect(() => registry.validateRevision({ tenant_id: tenantA, connection_id: connection.connection_id, expected_connection_revision: 3 }))
            .toThrowErrorMatchingObject({ code: 'WORKSPACE_CONNECTION_REVOKED' });
    });
});
