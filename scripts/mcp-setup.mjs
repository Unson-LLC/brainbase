#!/usr/bin/env node
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ANSI color codes
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    red: '\x1b[31m',
    cyan: '\x1b[36m'
};

function log(message, color = colors.reset) {
    console.log(`${color}${message}${colors.reset}`);
}

function generateCodeVerifier() {
    return crypto.randomBytes(32).toString('base64url');
}

function getTokenFilePath() {
    const homeDir = os.homedir();
    const brainbaseDir = path.join(homeDir, '.brainbase');
    return path.join(brainbaseDir, 'tokens.json');
}

function ensureBrainbaseDir() {
    const homeDir = os.homedir();
    const brainbaseDir = path.join(homeDir, '.brainbase');
    if (!fs.existsSync(brainbaseDir)) {
        fs.mkdirSync(brainbaseDir, { mode: 0o700 });
    }
}

function saveTokens(tokens) {
    ensureBrainbaseDir();
    const tokenFilePath = getTokenFilePath();

    const data = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in || 3600,
        issued_at: Math.floor(Date.now() / 1000)
    };

    fs.writeFileSync(tokenFilePath, JSON.stringify(data, null, 2), { mode: 0o600 });
    log(`✅ Tokens saved to ${tokenFilePath}`, colors.green);
}

async function requestDeviceCode(codeVerifier) {
    const apiUrl = process.env.BRAINBASE_API_URL || 'http://localhost:31013';
    const deviceCodeUrl = `${apiUrl}/api/auth/device/code`;

    log(`\n📡 Requesting device code from ${apiUrl}...`, colors.cyan);

    const response = await fetch(deviceCodeUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            code_verifier: codeVerifier
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Device code request failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    return data;
}

async function pollForToken(deviceCode, interval, expiresIn) {
    const apiUrl = process.env.BRAINBASE_API_URL || 'http://localhost:31013';
    const tokenUrl = `${apiUrl}/api/auth/device/token`;

    const startTime = Date.now();
    const expiresInMs = expiresIn * 1000;
    const intervalMs = interval * 1000;

    let dots = 0;
    const maxDots = 10;

    while (true) {
        // Check timeout
        if (Date.now() - startTime >= expiresInMs) {
            throw new Error('Device code expired (timeout: 10 minutes)');
        }

        // Polling request
        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                device_code: deviceCode
            })
        });

        const data = await response.json();

        // Success
        if (response.ok && data.access_token) {
            process.stdout.write('\n');
            return data;
        }

        // OAuth 2.0 Device Flow error codes (RFC 8628)
        if (data.error === 'authorization_pending') {
            // Still waiting for user authorization
            process.stdout.write('.');
            dots++;
            if (dots >= maxDots) {
                process.stdout.write('\n⏳ Still waiting for authorization...');
                dots = 0;
            }
            await new Promise(resolve => setTimeout(resolve, intervalMs));
            continue;
        }

        if (data.error === 'slow_down') {
            // Server requested slower polling
            await new Promise(resolve => setTimeout(resolve, intervalMs + 5000));
            continue;
        }

        if (data.error === 'expired_token') {
            throw new Error('Device code expired');
        }

        if (data.error === 'access_denied') {
            throw new Error('User denied the authorization request');
        }

        // Unknown error
        throw new Error(data.error_description || data.error || 'Unknown error during polling');
    }
}

async function main() {
    try {
        log('\n🔐 Brainbase MCP Setup - OAuth 2.0 Device Code Flow\n', colors.bright);

        // Check if tokens already exist
        const tokenFilePath = getTokenFilePath();
        if (fs.existsSync(tokenFilePath)) {
            log(`⚠️  Tokens already exist at ${tokenFilePath}`, colors.yellow);
            log('   This will overwrite existing tokens.', colors.yellow);
            log('   Press Ctrl+C to cancel, or wait 3 seconds to continue...\n', colors.yellow);
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        // Generate PKCE code_verifier
        const codeVerifier = generateCodeVerifier();
        log('✨ Generated PKCE code_verifier', colors.green);

        // Request device code
        const deviceCodeResponse = await requestDeviceCode(codeVerifier);
        const {
            device_code,
            user_code,
            verification_uri,
            verification_uri_complete,
            expires_in,
            interval
        } = deviceCodeResponse;

        log('✅ Device code received', colors.green);
        log('');

        // Display user code prominently
        log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.cyan);
        log('', colors.bright);
        log('  1. 以下のURLをブラウザで開いてください:', colors.bright);
        log(`     ${colors.blue}${verification_uri_complete}${colors.reset}`, colors.bright);
        log('', colors.bright);
        log('  2. または、手動でコードを入力してください:', colors.bright);
        log(`     コード: ${colors.green + colors.bright}${user_code}${colors.reset}`, colors.bright);
        log(`     URL:    ${colors.blue}${verification_uri}${colors.reset}`, colors.bright);
        log('', colors.bright);
        log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.cyan);
        log('');

        // Poll for token
        const expiresInMinutes = Math.floor(expires_in / 60);
        log(`⏳ 認証を待っています (${expiresInMinutes}分以内に完了してください)`, colors.yellow);
        process.stdout.write('   ');

        const tokens = await pollForToken(device_code, interval, expires_in);

        // Save tokens
        saveTokens(tokens);

        log('\n✅ Setup complete!', colors.green + colors.bright);
        log('   Your MCP server will now automatically use these tokens.', colors.green);
        log('   Restart Claude Code to apply changes.\n', colors.green);

        process.exit(0);
    } catch (error) {
        log(`\n❌ Error: ${error.message}`, colors.red);
        process.exit(1);
    }
}

main();
