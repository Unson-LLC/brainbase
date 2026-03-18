import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getConfig, getAuth, getSyncState, saveSyncState } from './config.js';

/**
 * Show diff status between local and server (no changes made)
 */
export async function wikiStatus() {
    const config = getConfig();
    const auth = getAuth();
    if (!auth) {
        console.error('Not logged in. Run: brainbase auth login');
        process.exit(1);
    }

    const serverUrl = auth.server_url || config.server_url;
    const wikiDir = config.wiki_dir;
    const headers = getHeaders(auth);

    console.log(`Wiki status`);
    console.log(`  Server: ${serverUrl}`);
    console.log(`  Local:  ${wikiDir}`);

    // Get server manifest
    let serverManifest;
    try {
        const res = await fetch(`${serverUrl}/api/wiki/sync/manifest`, { headers });
        if (res.status === 401) {
            console.error('Authentication failed. Run: brainbase auth login');
            process.exit(1);
        }
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        serverManifest = await res.json();
    } catch (error) {
        console.error(`Failed to get manifest: ${error.message}`);
        process.exit(1);
    }

    // Collect local files
    const localFiles = collectLocalFiles(wikiDir);

    const serverMap = new Map(serverManifest.map(p => [p.path, p]));
    const localMap = new Map(localFiles.map(f => [f.path, f]));

    const toPull = [];
    const toPush = [];
    const conflicts = [];
    let unchanged = 0;

    for (const [sPath, sFile] of serverMap) {
        const local = localMap.get(sPath);
        if (!local) {
            toPull.push(sPath);
        } else if (local.content_hash !== sFile.content_hash) {
            const serverTime = new Date(sFile.updated_at).getTime();
            const localTime = new Date(local.mtime).getTime();
            if (localTime > serverTime) {
                toPush.push(sPath);
            } else {
                toPull.push(sPath);
            }
        } else {
            unchanged++;
        }
    }

    for (const [lPath] of localMap) {
        if (!serverMap.has(lPath)) {
            toPush.push(lPath);
        }
    }

    // Display results
    console.log('');
    if (toPull.length > 0) {
        console.log(`  ↓ Pull (${toPull.length}):`);
        for (const p of toPull) console.log(`    ${p}`);
    }
    if (toPush.length > 0) {
        console.log(`  ↑ Push (${toPush.length}):`);
        for (const p of toPush) console.log(`    ${p}`);
    }
    if (toPull.length === 0 && toPush.length === 0) {
        console.log('  Everything up to date.');
    }
    console.log(`\n  Summary: ${toPull.length} to pull, ${toPush.length} to push, ${unchanged} unchanged`);

    // Show last sync info
    const syncState = getSyncState();
    if (syncState.last_sync) {
        console.log(`  Last sync: ${syncState.last_sync}`);
    }
}

function getHeaders(auth) {
    if (auth.mode === 'insecure_header') {
        return {
            'Content-Type': 'application/json',
            'x-brainbase-role': auth.role,
            'x-brainbase-projects': (auth.projects || []).join(','),
            'x-brainbase-clearance': (auth.clearance || []).join(',')
        };
    }
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth.token}`
    };
}

function hashFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    return crypto.createHash('sha256').update(content).digest('hex');
}

function collectLocalFiles(wikiDir, prefix = '') {
    if (!fs.existsSync(wikiDir)) return [];
    const entries = fs.readdirSync(wikiDir, { withFileTypes: true });
    const results = [];
    for (const entry of entries) {
        const fullPath = path.join(wikiDir, entry.name);
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            results.push(...collectLocalFiles(fullPath, relPath));
        } else if (entry.name.endsWith('.md')) {
            const wikiPath = relPath.slice(0, -3);
            results.push({
                path: wikiPath,
                content_hash: hashFile(fullPath),
                mtime: fs.statSync(fullPath).mtime.toISOString(),
                fullPath
            });
        }
    }
    return results;
}

/**
 * Full bidirectional sync
 */
export async function sync() {
    const config = getConfig();
    const auth = getAuth();
    if (!auth) {
        console.error('Not logged in. Run: brainbase auth login');
        process.exit(1);
    }

    const serverUrl = auth.server_url || config.server_url;
    const wikiDir = config.wiki_dir;
    const headers = getHeaders(auth);

    console.log(`Syncing wiki...`);
    console.log(`  Server: ${serverUrl}`);
    console.log(`  Local:  ${wikiDir}`);

    // Step 1: Get server manifest
    let serverManifest;
    try {
        const res = await fetch(`${serverUrl}/api/wiki/sync/manifest`, { headers });
        if (res.status === 401) {
            console.error('Authentication failed. Run: brainbase auth login');
            process.exit(1);
        }
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        serverManifest = await res.json();
    } catch (error) {
        console.error(`Failed to get manifest: ${error.message}`);
        process.exit(1);
    }

    // Step 2: Collect local files
    const localFiles = collectLocalFiles(wikiDir);

    // Build maps
    const serverMap = new Map(serverManifest.map(p => [p.path, p]));
    const localMap = new Map(localFiles.map(f => [f.path, f]));

    // Step 3: Diff
    const toPull = [];   // Server → Local
    const toPush = [];   // Local → Server
    const toDelete = [];  // Local only, not on server (permission revoked or deleted)
    let skipped = 0;

    // Check server files
    for (const [sPath, sFile] of serverMap) {
        const local = localMap.get(sPath);
        if (!local) {
            toPull.push(sPath);
        } else if (local.content_hash !== sFile.content_hash) {
            // Different content - server wins by default (pull)
            const serverTime = new Date(sFile.updated_at).getTime();
            const localTime = new Date(local.mtime).getTime();
            if (localTime > serverTime) {
                toPush.push({ path: sPath, if_unmodified_since: sFile.updated_at });
            } else {
                toPull.push(sPath);
            }
        } else {
            skipped++;
        }
    }

    // Check local-only files (not on server manifest)
    for (const [lPath, lFile] of localMap) {
        if (!serverMap.has(lPath)) {
            // New local file → push
            toPush.push({ path: lPath });
        }
    }

    console.log(`\nDiff: ${toPull.length} pull, ${toPush.length} push, ${skipped} unchanged`);

    // Step 4: Pull
    if (toPull.length > 0) {
        console.log(`Pulling ${toPull.length} pages...`);
        const res = await fetch(`${serverUrl}/api/wiki/sync/pull`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ paths: toPull })
        });
        if (!res.ok) {
            console.error(`Pull failed: ${res.status}`);
        } else {
            const pages = await res.json();
            for (const page of pages) {
                const filePath = path.join(wikiDir, `${page.path}.md`);
                fs.mkdirSync(path.dirname(filePath), { recursive: true });
                fs.writeFileSync(filePath, page.content, 'utf-8');
                console.log(`  ↓ ${page.path}`);
            }
        }
    }

    // Step 5: Push
    if (toPush.length > 0) {
        console.log(`Pushing ${toPush.length} pages...`);
        const pages = toPush.map(item => {
            const p = typeof item === 'string' ? item : item.path;
            const filePath = path.join(wikiDir, `${p}.md`);
            return {
                path: p,
                content: fs.readFileSync(filePath, 'utf-8'),
                if_unmodified_since: item.if_unmodified_since || null
            };
        });
        const res = await fetch(`${serverUrl}/api/wiki/sync/push`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ pages })
        });
        const results = await res.json();
        for (const result of results) {
            if (result.success) {
                console.log(`  ↑ ${result.path}`);
            } else if (result.error === 'conflict') {
                console.log(`  ⚡ CONFLICT: ${result.path} (server modified at ${result.server_updated_at})`);
            } else if (result.error === 'forbidden') {
                console.log(`  🚫 ${result.path} (no permission)`);
            }
        }
    }

    // Save sync state
    saveSyncState({
        last_sync: new Date().toISOString(),
        server_url: serverUrl,
        files_synced: serverManifest.length
    });

    console.log('\nSync complete.');
}

/**
 * Pull only (server → local)
 */
export async function pull() {
    const config = getConfig();
    const auth = getAuth();
    if (!auth) {
        console.error('Not logged in. Run: brainbase auth login');
        process.exit(1);
    }

    const serverUrl = auth.server_url || config.server_url;
    const wikiDir = config.wiki_dir;
    const headers = getHeaders(auth);

    console.log('Pulling all accessible wiki pages...');

    const res = await fetch(`${serverUrl}/api/wiki/sync/manifest`, { headers });
    if (!res.ok) {
        console.error(`Failed: ${res.status}`);
        process.exit(1);
    }
    const manifest = await res.json();

    if (manifest.length === 0) {
        console.log('No pages accessible.');
        return;
    }

    const pullRes = await fetch(`${serverUrl}/api/wiki/sync/pull`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ paths: manifest.map(p => p.path) })
    });
    const pages = await pullRes.json();

    for (const page of pages) {
        const filePath = path.join(wikiDir, `${page.path}.md`);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, page.content, 'utf-8');
        console.log(`  ↓ ${page.path}`);
    }

    saveSyncState({
        last_sync: new Date().toISOString(),
        server_url: serverUrl,
        files_synced: pages.length
    });

    console.log(`\nPulled ${pages.length} pages.`);
}

/**
 * Push only (local → server)
 */
export async function push() {
    const config = getConfig();
    const auth = getAuth();
    if (!auth) {
        console.error('Not logged in. Run: brainbase auth login');
        process.exit(1);
    }

    const serverUrl = auth.server_url || config.server_url;
    const wikiDir = config.wiki_dir;
    const headers = getHeaders(auth);

    console.log('Pushing local wiki pages...');

    const localFiles = collectLocalFiles(wikiDir);
    if (localFiles.length === 0) {
        console.log('No local wiki files found.');
        return;
    }

    const pages = localFiles.map(f => ({
        path: f.path,
        content: fs.readFileSync(f.fullPath, 'utf-8')
    }));

    const res = await fetch(`${serverUrl}/api/wiki/sync/push`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ pages })
    });
    const results = await res.json();

    let pushed = 0;
    let conflicts = 0;
    let forbidden = 0;
    for (const result of results) {
        if (result.success) {
            console.log(`  ↑ ${result.path}`);
            pushed++;
        } else if (result.error === 'conflict') {
            console.log(`  ⚡ CONFLICT: ${result.path}`);
            conflicts++;
        } else if (result.error === 'forbidden') {
            console.log(`  🚫 ${result.path}`);
            forbidden++;
        }
    }

    console.log(`\nPushed: ${pushed}, Conflicts: ${conflicts}, Forbidden: ${forbidden}`);
}
