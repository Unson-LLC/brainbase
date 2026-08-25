import { readFile, stat, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    buildSmokeFixtureInput,
    issueSmokeFixture
} from '../../../scripts/issue-personal-knowledge-promotion-smoke-fixture.mjs';
import { parseSmokeFixture } from '../../../scripts/personal-knowledge-promotion-production-smoke.mjs';

const binding = {
    tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    expected_tenant_revision: '7',
    connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAW',
    expected_connection_revision: '11',
    workspace_id: 'workspace-a',
    app_id: 'app-a',
    project_code: 'brainbase',
    channel_id: 'C-production-smoke',
    owner_subject_id: 'person_owner_smoke',
    reviewer_subject_id: 'person_reviewer_smoke'
};

const serviceToken = 'bbsvc_production_fixture_issuer_secret';

function fakeContext(request) {
    return {
        actor: { principal_type: 'person', principal_id: request.provider_identity.authenticated_subject_id },
        authorization: { capability_ids: [request.requested_action.capability_id] },
        authority: request.promotion_authority,
        operation_id: request.operation_id,
        idempotency_key: 'ik1_fixture_test',
        issued_at: '2026-08-26T00:00:00.000Z',
        expires_at: '2026-08-26T00:05:00.000Z',
        integrity: {
            method: 'jws_detached',
            algorithm: 'EdDSA',
            value: `protected..${'a'.repeat(86)}`
        }
    };
}

function createFetch(requests, { unsigned = false } = {}) {
    return async (_url, options) => {
        const body = JSON.parse(options.body);
        requests.push({ body, headers: options.headers });
        const context = fakeContext(body);
        if (unsigned) delete context.integrity;
        return {
            status: 200,
            async json() { return context; }
        };
    };
}

describe('issue-personal-knowledge-promotion-smoke-fixture', () => {
    it('uses the runtime producer for three distinct scoped contexts and readbacks a 0600 synthetic fixture', async () => {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'personal-kg-fixture-'));
        const outputPath = path.join(directory, 'smoke.json');
        const requests = [];
        const receipt = await issueSmokeFixture({
            outputPath,
            runId: 'p0_smoke_20260826_issuer_001',
            binding,
            runtimeBaseUrl: 'http://tenant-runtime.test',
            serviceToken,
            fetchImpl: createFetch(requests),
            validateContext: () => true,
            now: new Date('2026-08-26T00:00:00.000Z')
        });

        expect(receipt).toMatchObject({
            status: 'passed',
            assertions: {
                issued_by_tenant_context_producer: true,
                synthetic_only: true,
                private_key_persisted: false,
                service_token_persisted: false,
                fixture_readback_verified: true
            },
            readback: { status: 'passed', mode: '0600' }
        });
        expect(requests).toHaveLength(3);
        expect(requests.map(({ body }) => body.promotion_authority.action)).toEqual([
            'request', 'owner_consent', 'organization_review'
        ]);
        expect(requests.every(({ headers }) => headers.authorization === `Bearer ${serviceToken}`)).toBe(true);
        expect(JSON.stringify(requests.map(({ body }) => body))).not.toContain(serviceToken);

        const output = await readFile(outputPath, 'utf8');
        const fixture = JSON.parse(output);
        expect(parseSmokeFixture(fixture)).toMatchObject({
            runId: 'p0_smoke_20260826_issuer_001',
            projectCode: 'brainbase'
        });
        expect(output).not.toContain(serviceToken);
        expect(output).not.toContain('private_key');
        expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
    });

    it('fails closed before writing when the producer response is unsigned', async () => {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'personal-kg-fixture-fail-'));
        const outputPath = path.join(directory, 'smoke.json');

        await expect(issueSmokeFixture({
            outputPath,
            runId: 'p0_smoke_20260826_issuer_002',
            binding,
            runtimeBaseUrl: 'http://tenant-runtime.test',
            serviceToken,
            fetchImpl: createFetch([], { unsigned: true }),
            validateContext: () => true
        })).rejects.toMatchObject({ code: 'context_unsigned' });

        await expect(stat(outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('builds only synthetic producer requests before any runtime call', () => {
        const fixture = buildSmokeFixtureInput({
            runId: 'p0_smoke_20260826_issuer_003',
            binding,
            now: new Date('2026-08-26T00:00:00.000Z')
        });

        expect(fixture.synthetic).toBe(true);
        expect(fixture.data_class).toBe('synthetic');
        expect(fixture.event.body).toContain(fixture.run_id);
        expect(fixture.request).not.toHaveProperty('signed_context');
        expect(fixture.owner).not.toHaveProperty('signed_context');
        expect(fixture.organization).not.toHaveProperty('signed_context');
        expect(JSON.stringify(fixture)).not.toContain(serviceToken);
    });
});
