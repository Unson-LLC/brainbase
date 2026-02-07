#!/usr/bin/env node
import crypto from 'crypto';
import http from 'http';
import open from 'open';
import fs from 'fs';
import path from 'path';
import os from 'os';

const CALLBACK_PORT = 8888;
const CALLBACK_PATH = '/callback';
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

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

function generateCodeChallenge(verifier) {
    const hash = crypto.createHash('sha256').update(verifier).digest();
    return hash.toString('base64url');
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
        access_token: tokens.token,
        refresh_token: tokens.refresh_token,
        expires_in: 3600, // 1 hour in seconds
        issued_at: Math.floor(Date.now() / 1000) // Unix timestamp
    };

    fs.writeFileSync(tokenFilePath, JSON.stringify(data, null, 2), { mode: 0o600 });
    log(`✅ Tokens saved to ${tokenFilePath}`, colors.green);
}

async function exchangeToken(code, codeVerifier) {
    const apiUrl = process.env.BRAINBASE_API_URL || 'http://localhost:31013';
    const exchangeUrl = `${apiUrl}/api/auth/token/exchange`;

    log(`\n📡 Exchanging code for token...`, colors.cyan);

    const response = await fetch(exchangeUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            code,
            code_verifier: codeVerifier
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    return data;
}

async function startCallbackServer(codeVerifier) {
    return new Promise((resolve, reject) => {
        let resolved = false;
        let server;

        const timeout = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                server?.close();
                reject(new Error('Authentication timeout (5 minutes)'));
            }
        }, TIMEOUT_MS);

        server = http.createServer(async (req, res) => {
            if (req.url?.startsWith(CALLBACK_PATH)) {
                const url = new URL(req.url, `http://localhost:${CALLBACK_PORT}`);
                const code = url.searchParams.get('code');
                const state = url.searchParams.get('state');
                const error = url.searchParams.get('error');

                if (error) {
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(`
                        <!DOCTYPE html>
                        <html>
                        <head><title>Authentication Failed</title></head>
                        <body style="font-family: system-ui; padding: 40px; text-align: center;">
                            <h1 style="color: #e74c3c;">❌ Authentication Failed</h1>
                            <p>Error: ${error}</p>
                            <p>You can close this window.</p>
                        </body>
                        </html>
                    `);

                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        server.close();
                        reject(new Error(`Authentication error: ${error}`));
                    }
                    return;
                }

                if (!code || !state) {
                    res.writeHead(400, { 'Content-Type': 'text/html' });
                    res.end(`
                        <!DOCTYPE html>
                        <html>
                        <head><title>Invalid Request</title></head>
                        <body style="font-family: system-ui; padding: 40px; text-align: center;">
                            <h1 style="color: #e74c3c;">❌ Invalid Request</h1>
                            <p>Missing code or state parameter.</p>
                            <p>You can close this window.</p>
                        </body>
                        </html>
                    `);

                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        server.close();
                        reject(new Error('Missing code or state parameter'));
                    }
                    return;
                }

                // Exchange code for token
                try {
                    const tokens = await exchangeToken(code, codeVerifier);

                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(`
                        <!DOCTYPE html>
                        <html>
                        <head><title>Authentication Successful</title></head>
                        <body style="font-family: system-ui; padding: 40px; text-align: center; background: #0b1120; color: #e2e8f0;">
                            <div style="background: rgba(15, 23, 42, 0.9); border: 1px solid rgba(148, 163, 184, 0.2); padding: 32px; border-radius: 16px; max-width: 500px; margin: 0 auto;">
                                <h1 style="color: #10b981;">✅ Authentication Successful</h1>
                                <p>Your MCP server is now authenticated!</p>
                                <p style="color: #94a3b8; font-size: 14px;">You can close this window and return to your terminal.</p>
                            </div>
                        </body>
                        </html>
                    `);

                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        server.close();
                        resolve(tokens);
                    }
                } catch (error) {
                    res.writeHead(500, { 'Content-Type': 'text/html' });
                    res.end(`
                        <!DOCTYPE html>
                        <html>
                        <head><title>Token Exchange Failed</title></head>
                        <body style="font-family: system-ui; padding: 40px; text-align: center;">
                            <h1 style="color: #e74c3c;">❌ Token Exchange Failed</h1>
                            <p>${error.message}</p>
                            <p>You can close this window.</p>
                        </body>
                        </html>
                    `);

                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        server.close();
                        reject(error);
                    }
                }
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not Found');
            }
        });

        server.on('error', (error) => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                reject(error);
            }
        });

        server.listen(CALLBACK_PORT, 'localhost', () => {
            log(`\n🌐 Callback server listening on http://localhost:${CALLBACK_PORT}`, colors.blue);
        });
    });
}

async function main() {
    try {
        log('\n🔐 Brainbase MCP Setup - OAuth2 PKCE Authentication\n', colors.bright);

        // Check if tokens already exist
        const tokenFilePath = getTokenFilePath();
        if (fs.existsSync(tokenFilePath)) {
            log(`⚠️  Tokens already exist at ${tokenFilePath}`, colors.yellow);
            log('   This will overwrite existing tokens.', colors.yellow);
            log('   Press Ctrl+C to cancel, or wait 3 seconds to continue...\n', colors.yellow);
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        // Generate PKCE parameters
        const codeVerifier = generateCodeVerifier();
        const codeChallenge = generateCodeChallenge(codeVerifier);
        const state = crypto.randomBytes(16).toString('hex');

        log('✨ Generated PKCE parameters', colors.green);
        log(`   code_verifier:  ${codeVerifier.substring(0, 20)}...`, colors.cyan);
        log(`   code_challenge: ${codeChallenge.substring(0, 20)}...`, colors.cyan);

        // Build authorization URL
        const apiUrl = process.env.BRAINBASE_API_URL || 'http://localhost:31013';
        const startUrl = new URL(`${apiUrl}/api/auth/slack/start`);
        startUrl.searchParams.set('code_challenge', codeChallenge);
        startUrl.searchParams.set('json', 'true');

        log(`\n📡 Fetching authorization URL from ${apiUrl}...`, colors.cyan);

        const startResponse = await fetch(startUrl.toString());
        if (!startResponse.ok) {
            throw new Error(`Failed to get authorization URL: ${startResponse.status}`);
        }

        const { url: authorizeUrl } = await startResponse.json();

        // Start callback server
        const tokensPromise = startCallbackServer(codeVerifier);

        // Wait a bit for server to start
        await new Promise(resolve => setTimeout(resolve, 500));

        // Open browser
        log('\n🌐 Opening browser for Slack authentication...', colors.blue);
        log(`   If the browser doesn't open, visit this URL manually:`, colors.yellow);
        log(`   ${authorizeUrl}\n`, colors.cyan);

        await open(authorizeUrl);

        // Wait for callback
        log('⏳ Waiting for authentication (timeout: 5 minutes)...', colors.yellow);
        const tokens = await tokensPromise;

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
