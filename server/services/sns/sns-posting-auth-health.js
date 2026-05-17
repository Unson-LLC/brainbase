// @ts-check
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const POSTING_BRIDGE_ENV_KEYS = [
    'X_CONSUMER_KEY',
    'X_CONSUMER_SECRET',
    'X_ACCESS_TOKEN',
    'X_ACCESS_TOKEN_SECRET'
];

const LEGACY_OAUTH1_ACCESS_TOKEN_ENVS = new Set([
    'X_ACCESS_TOKEN',
    'TWITTER_ACCESS_TOKEN'
]);

function hasValue(env, key) {
    return Boolean(String(env?.[key] || '').trim());
}

export function hasPostingBridgeCredentials(env = process.env) {
    return POSTING_BRIDGE_ENV_KEYS.every((key) => hasValue(env, key));
}

export function hasExplicitOAuth2Credential(credentialRef, env = process.env) {
    if (!credentialRef?.env) return false;
    if (LEGACY_OAUTH1_ACCESS_TOKEN_ENVS.has(String(credentialRef.env))) return false;
    return hasValue(env, credentialRef.env);
}

export function postingBridgeRateLimitUnavailable() {
    return {
        remaining: null,
        resetAt: null,
        reason: 'not_available_for_posting_bridge'
    };
}

export function createPostingBridgeHealthCheck({
    env = process.env,
    pythonPath = process.env.SNS_POST_PYTHON || '/Users/ksato/workspace/.venv/bin/python',
    scriptPath = process.env.SNS_POST_SCRIPT || '/Users/ksato/workspace/common/ops/scripts/sns_post.py',
    execFileImpl = execFileAsync
} = {}) {
    return async function postingBridgeHealthCheck() {
        if (!hasPostingBridgeCredentials(env)) {
            return {
                ok: false,
                reason: 'missing_posting_bridge_credentials',
                credential_mode: 'posting_bridge_oauth1'
            };
        }
        const xClientPath = path.join(path.dirname(scriptPath), 'x_client.py');
        try {
            await execFileImpl(pythonPath, [xClientPath, '--verify'], {
                env,
                maxBuffer: 1024 * 1024
            });
            return {
                ok: true,
                reason: null,
                credential_mode: 'posting_bridge_oauth1'
            };
        } catch (error) {
            return {
                ok: false,
                reason: error?.code || error?.message || 'posting_bridge_auth_failed',
                credential_mode: 'posting_bridge_oauth1'
            };
        }
    };
}

export function createSnsAccountHealthProvider({
    xProvider,
    postingBridgeHealthCheck = createPostingBridgeHealthCheck(),
    env = process.env
}) {
    if (!xProvider) throw new Error('xProvider required');
    return {
        ...xProvider,
        async healthCheck(credentialRef) {
            if (hasExplicitOAuth2Credential(credentialRef, env)) {
                const oauth2Health = await xProvider.healthCheck(credentialRef);
                if (oauth2Health?.ok) {
                    return { ...oauth2Health, credential_mode: 'x_api_oauth2' };
                }
            }
            return postingBridgeHealthCheck();
        },
        async getRateLimitStatus(credentialRef) {
            if (!hasExplicitOAuth2Credential(credentialRef, env)) {
                return postingBridgeRateLimitUnavailable();
            }
            return xProvider.getRateLimitStatus(credentialRef);
        }
    };
}
