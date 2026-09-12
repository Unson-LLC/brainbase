import { describe, expect, it } from 'vitest';

import {
    formatProvisioningError,
    parseProvisionTenantProjectIdentityArgs,
    runProvisionTenantProjectIdentity
} from '../../../scripts/provision-tenant-project-identity.js';

const manifestPath = 'config/manifests/tenant-project-identity-sato-baao-growin.json';

describe('tenant project identity provisioning script', () => {
    it('prints only safe upstream error metadata and the failed operation', () => {
        expect(formatProvisioningError({
            code: 'PROVISIONING_FAILED',
            message: 'Tenant project identity provisioning failed; inspect control-plane logs',
            upstream_code: '57014',
            upstream_name: 'DatabaseError',
            operation: 'workspace_connection_read',
            detail: 'password=must-not-print',
            query: 'SELECT secret'
        })).toBe(
            'PROVISIONING_FAILED: Tenant project identity provisioning failed; inspect control-plane logs '
            + '(upstream_code=57014 upstream_name=DatabaseError operation=workspace_connection_read)\n'
        );
        expect(formatProvisioningError({
            code: 'PROVISIONING_FAILED',
            message: 'generic',
            upstream_code: 'secret',
            upstream_name: 'bad name',
            operation: 'bad operation'
        })).toBe('PROVISIONING_FAILED: generic\n');
    });

    it('requires a manifest and keeps apply behind explicit approval and actor attribution', () => {
        expect(() => parseProvisionTenantProjectIdentityArgs(['--check'], {}))
            .toThrow(/manifest is required/u);
        expect(() => parseProvisionTenantProjectIdentityArgs(['--apply', '--manifest', manifestPath], {}))
            .toThrow(/approve-apply/u);
        expect(() => parseProvisionTenantProjectIdentityArgs(
            ['--apply', '--manifest', manifestPath, '--approve-apply'], {}
        )).toThrow(/BRAINBASE_PROVISIONING_ACTOR/u);
        expect(parseProvisionTenantProjectIdentityArgs(
            ['--apply', '--manifest', manifestPath, '--approve-apply'],
            { BRAINBASE_PROVISIONING_ACTOR: 'operator-keigo' }
        )).toMatchObject({ mode: 'apply', manifestPath, actorId: 'operator-keigo' });
    });

    it('runs check from the BAAO manifest without opening a database connection', async () => {
        const result = await runProvisionTenantProjectIdentity({
            argv: ['--check', '--manifest', manifestPath],
            env: {},
            readManifest: async () => JSON.stringify({
                version: 'tenant-project-identity.v1',
                tenant_id: 'ten_01M0HMA228ES64N4TFX846V8T8',
                tenant_key: 'unson-business',
                organization_id: 'ten_01M0HMA228ES64N4TFX846V8T8',
                project: { project_id: 'prj_01KGCS8BC76XRHFCHRRQ8G25MY', project_code: 'baao' },
                transport: {
                    provider: 'slack', workspace_id: 'T0882T8N9UH', app_id: 'A0BPM2J33SN',
                    connection_id: 'wsc_01M0HRK94FG2Y8DMBFYJHYT14K',
                    installation_id: 'slack_T0882T8N9UH_A0BPM2J33SN'
                },
                humans: [{
                    person_id: 'per_01KGYC7NNS0VXADK7NP48W4VR5',
                    slack_user_id: 'U088D1HBY6L',
                    membership_id: 'membership:unson-business:U088D1HBY6L',
                    membership_revision: '1', expected_project_codes: ['mana', 'brainbase'],
                    expected_role: 'tenant_admin', expected_clearance: ['internal'],
                    expected_tenant_role: null,
                    membership_repairs: {
                        tenant_role: { from_missing: true, to: 'tenant_admin' },
                        principal_type: { from_missing: true, to: 'person' }
                    },
                    placement_id: 'minutes-baao-growin'
                }]
            })
        });
        expect(result).toMatchObject({
            ok: true,
            mode: 'check',
            persisted: false,
            manifest: { project_code: 'baao', project_id: 'prj_01KGCS8BC76XRHFCHRRQ8G25MY' }
        });
    });
});
