import crypto from 'crypto';
import { getConfig, getAuth, saveAuth, clearAuth } from './config.js';
import { resolveTokenExpiry } from './token-expiry.js';

/**
 * Device Code Flow authentication (with PKCE)
 * 1. Generate code_verifier + request device code from server
 * 2. Display URL + code for user to authorize via Slack
 * 3. Poll for token
 */
export async function login() {
    const config = getConfig();
    const serverUrl = config.server_url;

    console.log(`Connecting to ${serverUrl}...`);

    // Generate PKCE code_verifier
    const codeVerifier = crypto.randomBytes(32).toString('base64url');

    // Step 1: Request device code
    let deviceResponse;
    let response;
    try {
        response = await fetch(`${serverUrl}/api/auth/device/code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code_verifier: codeVerifier })
        });
    } catch (error) {
        if (error.cause?.code === 'ECONNREFUSED') {
            throw new Error(
                `Cannot connect to ${serverUrl}. Make sure the Brainbase server is running, then run ` +
                '`brainbase auth login` again. No credentials were saved.'
            );
        }
        throw new Error(
            `Device Code Flow request failed: ${error instanceof Error ? error.message : String(error)}. ` +
            'Verify the Brainbase server and run `brainbase auth login` again. No credentials were saved.'
        );
    }
    if (!response.ok) {
        const body = await response.text();
        if (response.status === 404) {
            throw new Error(
                `Slack Device Code Flow is unavailable on ${serverUrl} (HTTP 404). ` +
                'Use the current Brainbase server or complete Slack login in the web UI, then run `brainbase auth login` again. No credentials were saved.'
            );
        }
        throw new Error(
            `Server returned ${response.status}: ${body}. ` +
            'Verify the Brainbase server and run `brainbase auth login` again. No credentials were saved.'
        );
    }
    try {
        deviceResponse = await response.json();
    } catch (error) {
        throw new Error(
            `Device Code Flow response was invalid: ${error instanceof Error ? error.message : String(error)}. ` +
            'Verify the Brainbase server and run `brainbase auth login` again. No credentials were saved.'
        );
    }

    // Step 2: Display authorization info
    console.log('\nAuthorization required:');
    console.log(`  Open: ${deviceResponse.verification_uri}`);
    console.log(`  Code: ${deviceResponse.user_code}\n`);
    console.log('Waiting for authorization...');

    // Step 3: Poll for token
    const interval = (deviceResponse.interval || 5) * 1000;
    const expiresAt = Date.now() + (deviceResponse.expires_in || 300) * 1000;

    while (Date.now() < expiresAt) {
        await new Promise(resolve => setTimeout(resolve, interval));

        try {
            const res = await fetch(`${serverUrl}/api/auth/device/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ device_code: deviceResponse.device_code })
            });

            if (res.ok) {
                const tokenData = await res.json();
                if (typeof tokenData.access_token !== 'string' || !tokenData.access_token) {
                    const error = new Error(
                        'Device Code Flow response did not include an access token. ' +
                        'Verify the Brainbase server and run `brainbase auth login` again. No credentials were saved.'
                    );
                    error.code = 'INVALID_TOKEN_RESPONSE';
                    throw error;
                }
                const expiresAt = resolveTokenExpiry({
                    ...tokenData,
                    token: tokenData.access_token
                });
                if (!expiresAt) {
                    const error = new Error(
                        'Device Code Flow response did not include usable token expiry metadata. ' +
                        'Verify the Brainbase server and run `brainbase auth login` again. No credentials were saved.'
                    );
                    error.code = 'INVALID_TOKEN_RESPONSE';
                    throw error;
                }
                const auth = {
                    token: tokenData.access_token,
                    expires_at: expiresAt,
                    server_url: serverUrl
                };
                if (typeof tokenData.refresh_token === 'string' && tokenData.refresh_token) {
                    auth.refresh_token = tokenData.refresh_token;
                }
                saveAuth(auth);
                console.log('Login successful!');
                return;
            }

            const body = await res.json();
            if (body.error === 'authorization_pending') {
                process.stdout.write('.');
                continue;
            }
            if (body.error === 'expired_token') {
                console.error('\nAuthorization expired. Please try again.');
                process.exit(1);
            }
        } catch (error) {
            if (error?.code === 'INVALID_TOKEN_RESPONSE') throw error;
            // Network error, retry
        }
    }

    console.error('\nAuthorization timed out. Please try again.');
    process.exit(1);
}

export function status() {
    const auth = getAuth();
    if (!auth) {
        console.log('Not logged in.');
        console.log('Run: brainbase auth login');
        return;
    }

    if (auth.mode === 'insecure_header') {
        console.log('Legacy authentication found: insecure header mode is no longer supported.');
        console.log('Run: brainbase auth login');
        return;
    }
    if (!auth.token) {
        console.log('Saved authentication is invalid because it has no bearer token.');
        console.log('Run: brainbase auth login');
        return;
    }
    console.log('Logged in:');
    console.log(`  Mode: token`);
    console.log(`  Server: ${auth.server_url}`);
    console.log(`  Expires: ${auth.expires_at}`);
}

export function logout() {
    clearAuth();
    console.log('Logged out.');
}
