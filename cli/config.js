import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.brainbase');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const AUTH_FILE = path.join(CONFIG_DIR, 'auth.json');
const TOKENS_FILE = path.join(CONFIG_DIR, 'tokens.json');
const SYNC_STATE_FILE = path.join(CONFIG_DIR, 'sync-state.json');

function ensureConfigDir() {
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
}

export function getConfig() {
    ensureConfigDir();
    if (!fs.existsSync(CONFIG_FILE)) {
        const defaults = {
            server_url: 'http://localhost:31013',
            wiki_dir: path.join(process.cwd(), 'wiki')
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
            if (!auth.expires_at || new Date(auth.expires_at) >= new Date()) {
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

export function getSyncState() {
    if (!fs.existsSync(SYNC_STATE_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(SYNC_STATE_FILE, 'utf-8'));
    } catch {
        return {};
    }
}

export function saveSyncState(state) {
    ensureConfigDir();
    fs.writeFileSync(SYNC_STATE_FILE, JSON.stringify(state, null, 2));
}

export { CONFIG_DIR, AUTH_FILE, SYNC_STATE_FILE };
