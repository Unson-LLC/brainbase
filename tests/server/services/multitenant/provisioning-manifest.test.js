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
            tenant_key: 'unson-business'
        });

        expect(first.tenant_key).toBe('unson-business');
        expect(first.workspace_connection.scopes).toEqual(['channels:history', 'chat:write']);
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
});
