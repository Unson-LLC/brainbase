import { getConfig, getAuth, saveAuth, clearAuth } from './config.js';

/**
 * Device Code Flow authentication
 * 1. Request device code from server
 * 2. Display URL + code for user to authorize
 * 3. Poll for token
 */
export async function login() {
    const config = getConfig();
    const serverUrl = config.server_url;

    console.log(`Connecting to ${serverUrl}...`);

    // Step 1: Request device code
    let deviceResponse;
    try {
        const res = await fetch(`${serverUrl}/api/auth/device/code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        if (!res.ok) {
            // If device flow not implemented yet, fall back to manual token
            if (res.status === 404) {
                return await manualTokenLogin(serverUrl);
            }
            throw new Error(`Server returned ${res.status}: ${await res.text()}`);
        }
        deviceResponse = await res.json();
    } catch (error) {
        if (error.cause?.code === 'ECONNREFUSED') {
            console.error(`Error: Cannot connect to ${serverUrl}`);
            console.error('Make sure the brainbase server is running.');
            process.exit(1);
        }
        // Fall back to manual token entry
        return await manualTokenLogin(serverUrl);
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
                saveAuth({
                    token: tokenData.access_token,
                    expires_at: tokenData.expires_at || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                    server_url: serverUrl
                });
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
        } catch {
            // Network error, retry
        }
    }

    console.error('\nAuthorization timed out. Please try again.');
    process.exit(1);
}

/**
 * Manual token login (fallback when device flow is not available)
 */
async function manualTokenLogin(serverUrl) {
    console.log('\nDevice Code Flow not available on this server.');
    console.log('Using manual token entry.\n');

    // Use insecure header auth for development
    const readline = await import('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    const role = await new Promise(resolve => {
        rl.question('Role (member/gm/ceo) [member]: ', answer => resolve(answer || 'member'));
    });

    const projects = await new Promise(resolve => {
        rl.question('Project codes (comma-separated) []: ', answer => resolve(answer));
    });

    rl.close();

    saveAuth({
        mode: 'insecure_header',
        role,
        projects: projects ? projects.split(',').map(p => p.trim()) : [],
        clearance: role === 'ceo' ? ['internal', 'restricted', 'finance', 'hr', 'contract'] : ['internal'],
        server_url: serverUrl,
        expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    });

    console.log('Auth saved (insecure header mode).');
}

export function status() {
    const auth = getAuth();
    if (!auth) {
        console.log('Not logged in.');
        console.log('Run: brainbase auth login');
        return;
    }

    console.log('Logged in:');
    if (auth.mode === 'insecure_header') {
        console.log(`  Mode: insecure header (dev)`);
        console.log(`  Role: ${auth.role}`);
        console.log(`  Projects: ${auth.projects?.join(', ') || 'none'}`);
    } else {
        console.log(`  Mode: token`);
    }
    console.log(`  Server: ${auth.server_url}`);
    console.log(`  Expires: ${auth.expires_at}`);
}

export function logout() {
    clearAuth();
    console.log('Logged out.');
}
