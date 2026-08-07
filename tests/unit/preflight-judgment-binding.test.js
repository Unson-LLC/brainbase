import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
    buildJudgmentBindingProbe,
    preflightJudgmentBinding
} from '../../scripts/preflight-judgment-binding.js';
import { canonicalJson } from '../../server/services/judgment-resolution-service.js';

const SECRET = 'test-binding-secret-with-at-least-32-characters';
const NOW = new Date('2026-08-07T00:00:00.000Z');

describe('judgment binding preflight', () => {
    it('API runtimeで検証できるrequest-bound署名を生成する', () => {
        const probe = buildJudgmentBindingProbe({
            bindingSecret: SECRET,
            issuedAt: NOW.toISOString(),
            turnId: 'judgment-preflight-test'
        });
        const signaturePayload = canonicalJson([
            'brainbase-judgment-binding-v1',
            'brainbase-mcp',
            '1',
            probe.body.turn_id,
            NOW.toISOString(),
            probe.requestDigest
        ]);
        expect(probe.headers['x-brainbase-judgment-signature']).toBe(
            createHmac('sha256', SECRET).update(signaturePayload).digest('hex')
        );
        expect(probe.headers['x-brainbase-judgment-request-digest']).toBe(probe.requestDigest);
    });

    it('署名済みprobeがmanaged receiptを返した時だけ成功する', async () => {
        const fetchImpl = vi.fn(async (_url, options) => {
            const body = JSON.parse(options.body);
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    request_digest: options.headers['x-brainbase-judgment-request-digest'],
                    host_binding: {
                        adapter_id: 'brainbase-mcp',
                        adapter_version: '1',
                        status: 'managed',
                        enforcement_level: 'host_contract'
                    },
                    turn_id: body.turn_id
                })
            };
        });
        const result = await preflightJudgmentBinding({
            apiUrl: 'https://brainbase.test/',
            taskApiToken: 'bbsvc_test',
            bindingSecret: SECRET,
            now: () => NOW,
            id: () => 'probe',
            fetchImpl
        });
        expect(result).toEqual({ status: 'managed', adapter_id: 'brainbase-mcp', adapter_version: '1' });
        expect(fetchImpl).toHaveBeenCalledWith('https://brainbase.test/api/judgment/resolve', expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({ authorization: 'Bearer bbsvc_test' })
        }));
    });

    it.each([
        ['HTTP failure', async () => ({ ok: false, status: 403 })],
        ['invalid receipt', async () => ({ ok: true, status: 200, json: async () => ({ host_binding: { status: 'unmanaged' } }) })]
    ])('%sをfail closedにする', async (_label, fetchImpl) => {
        await expect(preflightJudgmentBinding({
            apiUrl: 'https://brainbase.test',
            taskApiToken: 'bbsvc_test',
            bindingSecret: SECRET,
            now: () => NOW,
            id: () => 'probe',
            fetchImpl
        })).rejects.toThrow(/judgment binding probe/u);
    });
});
