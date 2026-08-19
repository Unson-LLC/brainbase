import { describe, expect, it } from 'vitest';

import {
    canonicalProvisioningFingerprint,
    normalizeProvisioningManifest
} from '../../../../server/services/multitenant/provisioning-manifest.js';

const validManifest = {
    tenant_key: 'unson-business',
    tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    display_name: 'Unson Business',
    project_code: 'mana',
    workspace_connection: {
        provider: 'slack',
        workspace_id: 'T0123456789',
        app_id: 'A0123456789',
        installation_id: 'install_01',
        connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        credential_ref: 'credref://unson-business/slack/primary',
        credential_mode: 'customer_oauth',
        scopes: ['chat:write', 'channels:history']
    },
    service_actor: {
        actor_id: 'svc_mana_runtime',
        canonical_project_id: 'project_mana',
        capabilities: ['send_message', 'create_task']
    },
    contract_revision: {
        contract_id: 'ctr_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        revision: '1',
        status: 'active',
        effective_from: '2026-08-18T00:00:00Z',
        effective_until: null,
        plan_code: 'mana-standard',
        allowances: { tool_calls: 1000 },
        thresholds_basis_points: [5000, 8000, 10000],
        overage_policy: 'deny',
        hard_stop_basis_points: 10000,
        rate_card_revision: 8,
        fx_table_revision: 5,
        sales_price_revision: 3,
        capabilities: [
            'signed_tenant_context',
            'connection_revision_recheck',
            'tenant_scoped_authorization',
            'credential_broker_v1',
            'usage_receipt_v1',
            'idempotent_effects_v1',
            'container_sanitization_v1'
        ],
        audience: ['mana-runtime'],
        deployment_id: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        profile: 'shared_cloud'
    }
};

describe('provisioning manifest', () => {
    it('normalizes the tenant boundary and creates a key-order-independent fingerprint', () => {
        const first = normalizeProvisioningManifest(validManifest);
        const second = normalizeProvisioningManifest({
            service_actor: validManifest.service_actor,
            workspace_connection: {
                ...validManifest.workspace_connection,
                scopes: ['channels:history', 'chat:write']
            },
            project_code: 'mana',
            display_name: 'Unson Business',
            tenant_id: validManifest.tenant_id,
            tenant_key: 'unson-business',
            contract_revision: validManifest.contract_revision
        });

        expect(first.tenant_key).toBe('unson-business');
        expect(first.workspace_connection.scopes).toEqual(['channels:history', 'chat:write']);
        expect(first.contract_revision.revision).toBe('1');
        expect(first.contract_revision.capabilities).toContain('signed_tenant_context');
        expect(canonicalProvisioningFingerprint(first)).toBe(canonicalProvisioningFingerprint(second));
        expect(canonicalProvisioningFingerprint(first)).toMatch(/^[a-f0-9]{64}$/u);
    });

    it('rejects unknown tenant identity and secret material without echoing the value', () => {
        expect(() => normalizeProvisioningManifest({ ...validManifest, tenant_key: 'Mana Dev' }))
            .toThrow(/tenant_key/u);

        const secret = 'xoxb-super-secret-value';
        let error;
        try {
            normalizeProvisioningManifest({
                ...validManifest,
                workspace_connection: { ...validManifest.workspace_connection, access_token: secret }
            });
        } catch (caught) {
            error = caught;
        }
        expect(error).toBeDefined();
        expect(error.message).toMatch(/secret|credential|forbidden/u);
        expect(error.message).not.toContain(secret);
    });

    it('only accepts opaque credential references and known capability names', () => {
        expect(() => normalizeProvisioningManifest({
            ...validManifest,
            workspace_connection: { ...validManifest.workspace_connection, credential_ref: 'token-value' }
        })).toThrow(/credential_ref/u);
        expect(() => normalizeProvisioningManifest({
            ...validManifest,
            service_actor: { ...validManifest.service_actor, capabilities: ['delete_everything'] }
        })).toThrow(/capabilit/u);
    });

    it('requires the canonical runtime contract binding fields', () => {
        for (const field of ['capabilities', 'audience', 'deployment_id', 'profile', 'revision']) {
            const contract = { ...validManifest.contract_revision };
            delete contract[field];
            expect(() => normalizeProvisioningManifest({
                ...validManifest,
                contract_revision: contract
            })).toThrow(new RegExp(`contract_revision.${field}`, 'u'));
        }
    });

    it('rejects a contract that omits any canonical protocol capability', () => {
        const capabilities = validManifest.contract_revision.capabilities.slice(1);
        expect(() => normalizeProvisioningManifest({
            ...validManifest,
            contract_revision: { ...validManifest.contract_revision, capabilities }
        })).toThrow(/capabilit/u);
    });

    it('rejects a non-active or non-effective contract revision', () => {
        expect(() => normalizeProvisioningManifest({
            ...validManifest,
            contract_revision: { ...validManifest.contract_revision, status: 'draft' }
        })).toThrow(/active/u);
        expect(() => normalizeProvisioningManifest({
            ...validManifest,
            contract_revision: { ...validManifest.contract_revision, effective_from: 'not-a-date' }
        })).toThrow(/effective_from/u);
    });
});
