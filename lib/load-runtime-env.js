import dotenv from 'dotenv';
import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';

export function loadRuntimeEnv({
    explicitPath = process.env.BRAINBASE_ENV_PATH,
    homeDir = os.homedir(),
    cwd = process.cwd()
} = {}) {
    const envPaths = [
        explicitPath,
        path.join(homeDir, 'workspace', '.env'),
        path.join(cwd, '.env')
    ].filter(Boolean);

    for (const envPath of envPaths) {
        if (existsSync(envPath)) dotenv.config({ path: envPath, override: false });
    }

    return envPaths;
}
