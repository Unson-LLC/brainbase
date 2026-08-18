import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
    createEnvCredentialMaterializer,
    createTrustedHttpProviderForwarder,
    createTrustedProviderForwardersFromEnv
} from '../../../../server/services/multitenant/trusted-provider-forwarder.js';
import { expectContractErrorAsync } from './test-helpers.js';

describe('trusted provider HTTP forwarder', () => {
    it('P0-1: operation allowlistからmethod/path/query/body/response encodingとcredential headerを決める', async () => {
        const fetchImpl = vi.fn(async (_url, init) => ({
            status: 202,
            headers: { get: () => 'application/json' },
            json: async () => ({ provider_request_id: 'request-a' }),
            text: async () => ''
        }));
        const forwarder = createTrustedHttpProviderForwarder({
            provider: 'anthropic',
            baseUrl: 'https://api.anthropic.com',
            operations: {
                'anthropic.messages.create': {
                    method: 'POST',
                    path: '/v1/messages',
                    body_encoding: 'json',
                    response_encoding: 'json',
                    credential_placement: 'x-api-key',
                    fixed_headers: { 'anthropic-version': '2023-06-01' }
                }
            },
            fetchImpl
        });
        const providerCredential = randomBytes(32).toString('base64url');
        const credential = Buffer.from(providerCredential, 'utf8');

        await expect(forwarder.forward({
            credential,
            operation: 'anthropic.messages.create',
            request: { body: { model: 'claude-test', max_tokens: 16, messages: [] } }
        })).resolves.toEqual({
            status: 202,
            response_encoding: 'json',
            content_type: 'application/json',
            body: { provider_request_id: 'request-a' }
        });

        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe('https://api.anthropic.com/v1/messages');
        expect(init.method).toBe('POST');
        expect(init.headers['x-api-key']).toBe(providerCredential);
        expect(init.headers['anthropic-version']).toBe('2023-06-01');
        expect(init.headers['brainbase-provider-operation']).toBe('anthropic.messages.create');
        expect(init.body).not.toContain(providerCredential);
    });

    it('P0-1: 専用idempotency_keyをproviderのIdempotency-Key headerに設定する', async () => {
        const fetchImpl = vi.fn(async () => ({
            status: 201,
            headers: { get: () => 'application/json' },
            json: async () => ({ id: 'task-1' })
        }));
        const forwarder = createTrustedHttpProviderForwarder({
            provider: 'brainbase',
            baseUrl: 'https://brainbase.example',
            operations: {
                'brainbase.tasks.create': {
                    method: 'POST', path: '/api/companion/tasks', body_encoding: 'json',
                    response_encoding: 'json', credential_placement: 'bearer'
                }
            },
            fetchImpl
        });

        await forwarder.forward({
            credential: Buffer.from('brainbase-provider-secret'),
            operation: 'brainbase.tasks.create',
            request: {
                body: { title: '確認する' },
                idempotency_key: 'slack:request-123:0'
            }
        });

        const headers = new Headers(fetchImpl.mock.calls[0][1].headers);
        expect(headers.get('Idempotency-Key')).toBe('slack:request-123:0');
    });

    it.each([
        '',
        ' leading',
        'contains space',
        'contains\nnewline',
        '日本語',
        123,
        null,
        'a'.repeat(201)
    ])('P0-1: 不正なidempotency_key %jをprovider未到達で拒否する', async (idempotencyKey) => {
        const fetchImpl = vi.fn();
        const forwarder = createTrustedHttpProviderForwarder({
            provider: 'brainbase',
            baseUrl: 'https://brainbase.example',
            operations: {
                'brainbase.tasks.update': {
                    method: 'PATCH', path: '/api/companion/tasks/task-1', body_encoding: 'json',
                    response_encoding: 'json', credential_placement: 'bearer'
                }
            },
            fetchImpl
        });

        await expectContractErrorAsync(
            () => forwarder.forward({
                credential: Buffer.from('brainbase-provider-secret'),
                operation: 'brainbase.tasks.update',
                request: { body: { title: '更新' }, idempotency_key: idempotencyKey }
            }),
            { code: 'SCHEMA_INVALID' }
        );
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('P0-1: 任意headersとfixed Idempotency-Keyは専用fieldを迂回できない', async () => {
        expect(() => createTrustedHttpProviderForwarder({
            provider: 'brainbase',
            baseUrl: 'https://brainbase.example',
            operations: {
                'brainbase.tasks.create': {
                    method: 'POST', path: '/api/companion/tasks', body_encoding: 'json',
                    response_encoding: 'json', credential_placement: 'bearer',
                    fixed_headers: { 'Idempotency-Key': 'fixed-key' }
                }
            },
            fetchImpl: vi.fn()
        })).toThrow(/fixed header configuration/u);

        const fetchImpl = vi.fn();
        const forwarder = createTrustedHttpProviderForwarder({
            provider: 'brainbase',
            baseUrl: 'https://brainbase.example',
            operations: {
                'brainbase.tasks.create': {
                    method: 'POST', path: '/api/companion/tasks', body_encoding: 'json',
                    response_encoding: 'json', credential_placement: 'bearer'
                }
            },
            fetchImpl
        });
        await expectContractErrorAsync(
            () => forwarder.forward({
                credential: Buffer.from('brainbase-provider-secret'),
                operation: 'brainbase.tasks.create',
                request: {
                    body: { title: '確認する' },
                    headers: { 'Idempotency-Key': 'arbitrary-key' }
                }
            }),
            { code: 'SCHEMA_INVALID' }
        );
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('P0-1: GET queryとpath parameterをoperation定義の範囲だけ許可する', async () => {
        const fetchImpl = vi.fn(async () => ({
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ ok: true }),
            text: async () => ''
        }));
        const forwarder = createTrustedHttpProviderForwarder({
            provider: 'slack',
            baseUrl: 'https://slack.com',
            operations: {
                'slack.conversations.history': {
                    method: 'GET',
                    path: '/api/conversations.history',
                    query: {
                        channel: { type: 'string', pattern: '^[CGD][A-Z0-9]+$' },
                        limit: { type: 'integer', minimum: 1, maximum: 200 }
                    },
                    body_encoding: 'none',
                    response_encoding: 'json',
                    credential_placement: 'bearer'
                }
            },
            fetchImpl
        });

        await forwarder.forward({
            credential: Buffer.from('slack-provider-secret'),
            operation: 'slack.conversations.history',
            request: { query: { channel: 'C123ABC', limit: 50 } }
        });
        expect(fetchImpl.mock.calls[0][0]).toBe('https://slack.com/api/conversations.history?channel=C123ABC&limit=50');
        expect(fetchImpl.mock.calls[0][1]).not.toHaveProperty('body');
        await expectContractErrorAsync(
            () => forwarder.forward({
                credential: Buffer.from('slack-provider-secret'),
                operation: 'slack.conversations.history',
                request: { query: { channel: 'C123ABC', redirect_uri: 'https://attacker.invalid' } }
            }),
            { code: 'SCHEMA_INVALID' }
        );
    });

    it('P0-1: Git smart HTTP binaryをbase64 wireへ変換しpath/queryをallowlistする', async () => {
        const providerBinary = Buffer.from('001e# service=git-upload-pack\n0000', 'utf8');
        const fetchImpl = vi.fn(async () => ({
            status: 200,
            headers: { get: () => 'application/x-git-upload-pack-advertisement' },
            arrayBuffer: async () => providerBinary.buffer.slice(
                providerBinary.byteOffset,
                providerBinary.byteOffset + providerBinary.byteLength
            )
        }));
        const forwarder = createTrustedHttpProviderForwarder({
            provider: 'github',
            baseUrl: 'https://github.com',
            operations: {
                'github.git.info_refs.upload_pack': {
                    method: 'GET',
                    path: '/{owner}/{repo}.git/info/refs',
                    path_params: {
                        owner: { pattern: '^[A-Za-z0-9_.-]+$' },
                        repo: { pattern: '^[A-Za-z0-9_.-]+$' }
                    },
                    query: { service: { enum: ['git-upload-pack'] } },
                    body_encoding: 'none',
                    response_encoding: 'base64',
                    credential_placement: 'bearer'
                }
            },
            fetchImpl
        });

        const result = await forwarder.forward({
            credential: Buffer.from('github-provider-secret'),
            operation: 'github.git.info_refs.upload_pack',
            request: {
                path_params: { owner: 'Unson-LLC', repo: 'brainbase-unson' },
                query: { service: 'git-upload-pack' }
            }
        });
        expect(fetchImpl.mock.calls[0][0]).toBe('https://github.com/Unson-LLC/brainbase-unson.git/info/refs?service=git-upload-pack');
        expect(result).toMatchObject({ response_encoding: 'base64', body: providerBinary.toString('base64') });
    });

    it('P0-1: Git smart HTTP binary request/responseとBasic credentialをserver内だけで変換する', async () => {
        const providerBinary = Buffer.from('0008NAK\n', 'utf8');
        const requestBinary = Buffer.from('0032want deadbeef multi_ack_detailed\n0000', 'utf8');
        const providerCredential = 'github-provider-secret';
        const fetchImpl = vi.fn(async () => ({
            status: 200,
            headers: { get: () => 'application/x-git-upload-pack-result' },
            arrayBuffer: async () => providerBinary.buffer.slice(
                providerBinary.byteOffset,
                providerBinary.byteOffset + providerBinary.byteLength
            )
        }));
        const forwarder = createTrustedHttpProviderForwarder({
            provider: 'github',
            baseUrl: 'https://github.com',
            operations: {
                'github.git.upload_pack': {
                    method: 'POST',
                    path: '/{owner}/{repo}.git/git-upload-pack',
                    path_params: {
                        owner: { pattern: '^[A-Za-z0-9_.-]+$' },
                        repo: { pattern: '^[A-Za-z0-9_.-]+$' }
                    },
                    body_encoding: 'base64',
                    response_encoding: 'base64',
                    credential_placement: 'basic',
                    credential_username: 'x-access-token',
                    fixed_headers: {
                        accept: 'application/x-git-upload-pack-result',
                        'content-type': 'application/x-git-upload-pack-request'
                    }
                }
            },
            fetchImpl
        });

        const result = await forwarder.forward({
            credential: Buffer.from(providerCredential, 'utf8'),
            operation: 'github.git.upload_pack',
            request: {
                path_params: { owner: 'Unson-LLC', repo: 'brainbase-unson' },
                body: requestBinary.toString('base64')
            }
        });
        const [, init] = fetchImpl.mock.calls[0];
        expect(Buffer.compare(init.body, requestBinary)).toBe(0);
        expect(init.headers.authorization).toBe(
            `Basic ${Buffer.from(`x-access-token:${providerCredential}`, 'utf8').toString('base64')}`
        );
        expect(result.body).toBe(providerBinary.toString('base64'));
        expect(JSON.stringify(result)).not.toContain(providerCredential);
    });

    it('P0-1: Slack upload URLのhost/pathだけを許可しbinaryをcredentialなしでforwardする', async () => {
        const requestBinary = Buffer.from('file bytes', 'utf8');
        const fetchImpl = vi.fn(async () => ({
            status: 200,
            headers: { get: () => 'text/plain' },
            text: async () => 'OK'
        }));
        const forwarder = createTrustedHttpProviderForwarder({
            provider: 'slack',
            operations: {
                'slack.files.upload_binary': {
                    method: 'POST',
                    path: '/',
                    body_encoding: 'base64',
                    response_encoding: 'utf8',
                    credential_placement: 'none',
                    target_url_hosts: ['files.slack.com'],
                    target_url_path_pattern: '^/upload/v1/[A-Za-z0-9_-]+$'
                }
            },
            fetchImpl
        });
        const result = await forwarder.forward({
            credential: Buffer.alloc(0),
            operation: 'slack.files.upload_binary',
            request: {
                target_url: 'https://files.slack.com/upload/v1/opaque-upload-id',
                body: requestBinary.toString('base64')
            }
        });
        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe('https://files.slack.com/upload/v1/opaque-upload-id');
        expect(Buffer.compare(init.body, requestBinary)).toBe(0);
        expect(init.headers).not.toHaveProperty('authorization');
        expect(result).toMatchObject({ response_encoding: 'utf8', body: 'OK' });

        await expectContractErrorAsync(
            () => forwarder.forward({
                credential: Buffer.alloc(0),
                operation: 'slack.files.upload_binary',
                request: {
                    target_url: 'https://attacker.invalid/upload/v1/opaque-upload-id',
                    body: requestBinary.toString('base64')
                }
            }),
            { code: 'CREDENTIAL_LEASE_SCOPE_MISMATCH' }
        );
    });

    it('P0-1: credential URL webhookを生secret非公開のままforwardする', async () => {
        const fetchImpl = vi.fn(async () => ({
            status: 200,
            headers: { get: () => 'text/plain' },
            text: async () => 'ok'
        }));
        const forwarder = createTrustedHttpProviderForwarder({
            provider: 'slack',
            operations: {
                'slack.hooks.post': {
                    method: 'POST',
                    path: '/',
                    body_encoding: 'json',
                    response_encoding: 'utf8',
                    credential_placement: 'url',
                    credential_url_hosts: ['hooks.slack.com'],
                    credential_url_path_pattern: '^/services/[A-Za-z0-9/_-]+$'
                }
            },
            fetchImpl
        });
        const webhookUrl = 'https://hooks.slack.com/services/T000/B000/opaque-secret';
        const result = await forwarder.forward({
            credential: Buffer.from(webhookUrl, 'utf8'),
            operation: 'slack.hooks.post',
            request: { body: { text: 'hello' } }
        });
        expect(fetchImpl.mock.calls[0][0]).toBe(webhookUrl);
        expect(fetchImpl.mock.calls[0][1].headers).not.toHaveProperty('authorization');
        expect(JSON.stringify(result)).not.toContain(webhookUrl);
        expect(result).toMatchObject({ response_encoding: 'utf8', body: 'ok' });
    });

    it('P0-1: arbitrary operationと非TLS provider endpointをfail-closedにする', async () => {
        expect(() => createTrustedHttpProviderForwarder({
            provider: 'openai',
            baseUrl: 'http://provider.example',
            operations: {
                'responses.create': {
                    method: 'POST', path: '/v1/responses', body_encoding: 'json',
                    response_encoding: 'json', credential_placement: 'bearer'
                }
            },
            fetchImpl: vi.fn()
        })).toThrow(/HTTPS/);

        const forwarder = createTrustedHttpProviderForwarder({
            provider: 'openai',
            baseUrl: 'https://provider.example',
            operations: {
                'responses.create': {
                    method: 'POST', path: '/v1/responses', body_encoding: 'json',
                    response_encoding: 'json', credential_placement: 'bearer'
                }
            },
            fetchImpl: vi.fn()
        });
        await expectContractErrorAsync(
            () => forwarder.forward({
                credential: Buffer.from('secret'),
                operation: 'arbitrary.forward',
                request: { body: { input: 'hello' } }
            }),
            { code: 'CREDENTIAL_LEASE_SCOPE_MISMATCH' }
        );
    });

    it('P0-1: provider responseがcredential materialを反射した場合もmanaへ返さない', async () => {
        const providerCredential = randomBytes(32).toString('base64url');
        const forwarder = createTrustedHttpProviderForwarder({
            provider: 'openai',
            baseUrl: 'https://provider.example',
            operations: {
                'responses.create': {
                    method: 'POST', path: '/v1/responses', body_encoding: 'json',
                    response_encoding: 'json', credential_placement: 'bearer'
                }
            },
            fetchImpl: vi.fn(async () => ({
                status: 200,
                headers: { get: () => 'application/json' },
                json: async () => ({ message: providerCredential }),
                text: async () => ''
            }))
        });

        await expectContractErrorAsync(
            () => forwarder.forward({
                credential: Buffer.from(providerCredential, 'utf8'),
                operation: 'responses.create',
                request: { body: { input: 'hello' } }
            }),
            { code: 'UPSTREAM_INVALID_RESPONSE' }
        );
    });

    it('P0-1: production env bindingはopaque refから許可済みenv名だけをmaterializeする', async () => {
        const providerCredential = randomBytes(32).toString('base64url');
        const env = {
            PROVIDER_CREDENTIAL_A: providerCredential,
            BRAINBASE_TENANT_CREDENTIAL_ENV_REFS_JSON: JSON.stringify({ 'credref:a': 'PROVIDER_CREDENTIAL_A' }),
            BRAINBASE_TENANT_PROVIDER_FORWARDERS_JSON: JSON.stringify({
                'api.provider.example': {
                    provider: 'openai',
                    base_url: 'https://api.provider.example',
                    operations: {
                        'responses.create': {
                            method: 'POST',
                            path: '/v1/responses',
                            body_encoding: 'json',
                            response_encoding: 'json',
                            credential_placement: 'bearer'
                        }
                    }
                }
            })
        };
        const materializer = createEnvCredentialMaterializer({ env });
        const forwarders = createTrustedProviderForwardersFromEnv({ env, fetchImpl: vi.fn() });

        await expect(materializer.materialize('credref:a')).resolves.toBeInstanceOf(Buffer);
        await expectContractErrorAsync(
            () => materializer.materialize('credref:unknown'),
            { code: 'CREDENTIAL_REF_UNKNOWN' }
        );
        expect(forwarders['api.provider.example']).toMatchObject({ provider: 'openai' });
        expect(JSON.stringify(forwarders)).not.toContain(providerCredential);
    });
});
