import fs from 'fs';
import path from 'path';
import os from 'os';
import { isAuthActive } from './token-expiry.js';

const CONFIG_DIR = path.join(os.homedir(), '.brainbase');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const AUTH_FILE = path.join(CONFIG_DIR, 'auth.json');
const TOKENS_FILE = path.join(CONFIG_DIR, 'tokens.json');

function ensureConfigDir() {
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
}

export function getConfig() {
    ensureConfigDir();
    if (!fs.existsSync(CONFIG_FILE)) {
        const defaults = {
            server_url: 'http://localhost:31013'
        };
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaults, null, 2));
        return defaults;
    }
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
}

export function saveConfig(config) {
    ensureConfigDir();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getAuth() {
    // 1. Try auth.json (CLI login)
    if (fs.existsSync(AUTH_FILE)) {
        try {
            const auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
            if (isAuthActive(auth)) {
                return auth;
            }
        } catch { /* fall through */ }
    }
    // 2. Fallback to tokens.json (UI Slack login)
    if (fs.existsSync(TOKENS_FILE)) {
        try {
            const tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8'));
            if (tokens.access_token) {
                return {
                    token: tokens.access_token,
                    server_url: 'http://localhost:31013'
                };
            }
        } catch { /* fall through */ }
    }
    return null;
}

export function saveAuth(auth) {
    ensureConfigDir();
    fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });
}

export function clearAuth() {
    if (fs.existsSync(AUTH_FILE)) fs.unlinkSync(AUTH_FILE);
}

export { CONFIG_DIR, AUTH_FILE };
