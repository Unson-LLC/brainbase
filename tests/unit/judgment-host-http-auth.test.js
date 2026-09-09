import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveAndAdopt } from '../../scripts/codex-hooks/judgment-resolver-host.mjs';

const directories = [];
const args = { request: 'diagnostic', turn_id: 'test-turn', conversation_context: { session_ref: 'test-session' } };
function environment(extra = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'judgment-auth-'));
    directories.push(dir);
    return { BRAINBASE_JUDGMENT_JOURNAL_DIR: dir, ...extra };
}
afterEach(() => directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));

describe('judgment Host HTTP authentication', () => {
    it.each([401, 403])('preserves HTTP %s even for non-JSON errors without retry or secret disclosure', async status => {
        const fetchImpl = vi.fn(async () => new Response('private proxy content', { status }));
        const error = await resolveAndAdopt(args, { env: environment({ MCP_HTTP_BEARER_TOKEN: 'secret-test-value' }), fetchImpl }).catch(error => error);
        expect(error.message).toBe(status === 401 ? 'judgment_host_unauthorized' : 'judgment_host_forbidden');
        expect(error.httpStatus).toBe(status);
        expect(String(error)).not.toContain('secret-test-value');
        expect(String(error)).not.toContain('private proxy content');
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe('Bearer secret-test-value');
        expect(fetchImpl.mock.calls[0][1].redirect).toBe('error');
    });
    it('does not forward the default MCP credential to an overridden endpoint', async () => {
        const fetchImpl = vi.fn(async () => new Response('{}', { status: 401 }));
        await expect(resolveAndAdopt(args, { env: environment({ MCP_HTTP_BEARER_TOKEN: 'default-secret', BRAINBASE_JUDGMENT_HOST_URL: 'https://example.test/resolve' }), fetchImpl })).rejects.toThrow('judgment_host_unauthorized');
        expect(fetchImpl.mock.calls[0][1].headers.authorization).toBeUndefined();
    });
    it('uses the explicitly selected Host token over the default MCP token', async () => {
        const fetchImpl = vi.fn(async () => new Response('{}', { status: 401 }));
        await resolveAndAdopt(args, { env: environment({ MCP_HTTP_BEARER_TOKEN: 'default-secret', BRAINBASE_JUDGMENT_HOST_BEARER_TOKEN: 'host-secret' }), fetchImpl }).catch(() => {});
        expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe('Bearer host-secret');
    });
    it('rejects credentials over non-loopback HTTP before a network call', async () => {
        const fetchImpl = vi.fn();
        await expect(resolveAndAdopt(args, { env: environment({ BRAINBASE_JUDGMENT_HOST_BEARER_TOKEN: 'host-secret', BRAINBASE_JUDGMENT_HOST_URL: 'http://example.test/resolve' }), fetchImpl })).rejects.toThrow('judgment_host_auth_transport_unsafe');
        expect(fetchImpl).not.toHaveBeenCalled();
    });
    it('distinguishes invalid response JSON from a transport failure', async () => {
        const fetchImpl = vi.fn(async () => new Response('not json', { status: 502 }));
        const error = await resolveAndAdopt(args, { env: environment(), fetchImpl }).catch(error => error);
        expect(error.message).toBe('judgment_host_response_invalid');
        expect(error.httpStatus).toBe(502);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
});
