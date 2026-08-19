import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorkspaceConnectionRegistry } from '../../../../server/services/multitenant/workspace-connection-registry.js';
import { expectContractError } from './test-helpers.js';

const tenantA = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const tenantB = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAW';
const workspaceRegistrySourcePath = path.resolve(process.cwd(), 'server/services/multitenant/workspace-connection-registry.js');

describe('WorkspaceConnectionRegistry', () => {
    it('AC-101/AC-102/AC-103: 複数workspace、再install履歴、監査field、単調revisionを正本化する', () => {
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
            expected_connection_revision: '1',
            installation_id: 'install-3',
            granted_scopes: ['chat:write', 'channels:read'],
            credential_ref: 'credref:three'
        });

        expect(first.connection_id).not.toBe(second.connection_id);
        expect(reinstalled.connection_id).toBe(first.connection_id);
        expect(reinstalled.connection_revision).toBe('2');
        expect(reinstalled.supersedes_connection_revision).toBe('1');
        expect(registry.history(first.connection_id)).toHaveLength(2);
    });

    it('AC-107: legacy registryのhistory-first保存とcurrent/history照合をソース契約として固定する', async () => {
        const source = await readFile(workspaceRegistrySourcePath, 'utf8');
        const saveStart = source.indexOf('\n    #save(');
        const registerStart = source.indexOf('\n    register(');
        const validateStart = source.indexOf('\n    validateRevision(');
        const historyStart = source.indexOf('\n    history(');
        expect(saveStart).toBeGreaterThanOrEqual(0);
        expect(registerStart).toBeGreaterThan(saveStart);
        expect(validateStart).toBeGreaterThanOrEqual(0);
        expect(historyStart).toBeGreaterThan(validateStart);

        const saveSource = source.slice(saveStart, registerStart);
        const historySetIndex = saveSource.indexOf('this.#history.set(connection.connection_id, revisions);');
        const currentSetIndex = saveSource.indexOf('this.#current.set(connection.connection_id, immutableSnapshot);');
        expect(saveSource).toContain('const immutableSnapshot = snapshot(connection);');
        expect(saveSource).toContain('revisions.push(immutableSnapshot);');
        expect(historySetIndex).toBeGreaterThanOrEqual(0);
        expect(currentSetIndex).toBeGreaterThan(historySetIndex);

        const validateSource = source.slice(validateStart, historyStart);
        expect(validateSource).toMatch(/const immutableSnapshot = \(this\.#history\.get\(connection_id\) \?\? \[\]\)\s*\.find\(\(revision\) => revision\.connection_revision === expected_connection_revision\);/);
        expect(validateSource).toContain("if (!immutableSnapshot)");
        expect(validateSource).toContain('JSON.stringify(immutableSnapshot) !== JSON.stringify(current)');
        expect(validateSource.indexOf('JSON.stringify(immutableSnapshot) !== JSON.stringify(current)'))
            .toBeGreaterThan(validateSource.indexOf('expected_connection_revision'));
    });

    it('AC-106: register後のcaller input変更がcurrent/history snapshotへ伝播しない', () => {
        const registry = new WorkspaceConnectionRegistry();
        const input = {
            tenant_id: tenantA,
            provider: 'slack',
            installation_id: 'install-immutable',
            workspace_id: 'workspace-immutable',
            app_id: 'app-immutable',
            granted_scopes: ['chat:write'],
            credential_ref: 'credref:immutable'
        };

        const connection = registry.register(input);
        input.workspace_id = 'workspace-mutated';
        input.granted_scopes.push('channels:read');
        input.credential_ref = 'credref:mutated';

        const history = registry.history(connection.connection_id);
        expect(history).toHaveLength(1);
        expect(history[0]).toMatchObject({
            workspace_id: 'workspace-immutable',
            granted_scopes: ['chat:write'],
            credential_ref: 'credref:immutable'
        });
        expect(Object.isFrozen(connection)).toBe(true);
        expect(Object.isFrozen(connection.granted_scopes)).toBe(true);
        expect(Object.isFrozen(history[0])).toBe(true);
        expect(Reflect.set(history[0], 'workspace_id', 'workspace-mutated')).toBe(false);
        history.push({ connection_revision: '999' });
        expect(registry.history(connection.connection_id)).toHaveLength(1);

        expect(registry.validateRevision({
            tenant_id: tenantA,
            connection_id: connection.connection_id,
            expected_connection_revision: '1',
            workspace_id: 'workspace-immutable',
            app_id: 'app-immutable',
            required_scopes: ['chat:write']
        })).toMatchObject({
            valid: true,
            connection_revision: '1',
            workspace_id: 'workspace-immutable',
            granted_scopes: ['chat:write'],
            credential_ref: 'credref:immutable'
        });
        expectContractError(() => registry.validateRevision({
            tenant_id: tenantA,
            connection_id: connection.connection_id,
            expected_connection_revision: '1',
            required_scopes: ['channels:read']
        }), { code: 'CAPABILITY_SCOPE_MISMATCH' });
    });

    it('AC-104: credential本文らしい入力を保存前に拒否する', () => {
        const registry = new WorkspaceConnectionRegistry();
        expectContractError(() => registry.register({
            tenant_id: tenantA,
            provider: 'slack', installation_id: 'i', workspace_id: 'w', app_id: 'a',
            granted_scopes: [], credential_ref: 'credref:opaque', access_token: 'forbidden'
        }), { code: 'SECRET_ARTIFACT_FORBIDDEN' });
    });

    it('AC-105: 未登録、失効、別tenant、別app、scope不足、stale revisionを区別する', () => {
        const registry = new WorkspaceConnectionRegistry();
        const connection = registry.register({
            tenant_id: tenantA,
            provider: 'slack', installation_id: 'i', workspace_id: 'w', app_id: 'a',
            granted_scopes: ['chat:write'], credential_ref: 'credref:opaque'
        });

        const unknownConnectionId = 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAV';
        // 公開APIにはhistoryだけを削除・差し替える操作がないため、履歴欠落単独や
        // current/history不一致をテスト専用のprivate state操作で作らず、未知IDのfail-closedを確認する。
        expect(registry.history(unknownConnectionId)).toEqual([]);
        expectContractError(() => registry.validateRevision({ tenant_id: tenantA, connection_id: unknownConnectionId, expected_connection_revision: '1' }), { code: 'WORKSPACE_CONNECTION_UNAVAILABLE' });
        expectContractError(() => registry.validateRevision({ tenant_id: tenantB, connection_id: connection.connection_id, expected_connection_revision: '1' }), { code: 'CROSS_TENANT_CANDIDATE' });
        expectContractError(() => registry.validateRevision({ tenant_id: tenantA, connection_id: connection.connection_id, expected_connection_revision: '1', app_id: 'other' }), { code: 'WORKSPACE_OR_APP_MISMATCH' });
        expectContractError(() => registry.validateRevision({ tenant_id: tenantA, connection_id: connection.connection_id, expected_connection_revision: '1', required_scopes: ['channels:read'] }), { code: 'CAPABILITY_SCOPE_MISMATCH' });
        registry.reinstall({ tenant_id: tenantA, connection_id: connection.connection_id, expected_connection_revision: '1', installation_id: 'i2', granted_scopes: ['chat:write'], credential_ref: 'credref:new' });
        expectContractError(() => registry.validateRevision({ tenant_id: tenantA, connection_id: connection.connection_id, expected_connection_revision: '1' }), { code: 'WORKSPACE_CONNECTION_STALE_REVISION' });
        registry.revoke({ tenant_id: tenantA, connection_id: connection.connection_id, expected_connection_revision: '2', reason: 'admin' });
        expectContractError(() => registry.validateRevision({ tenant_id: tenantA, connection_id: connection.connection_id, expected_connection_revision: '3' }), { code: 'WORKSPACE_CONNECTION_REVOKED' });
    });
});
