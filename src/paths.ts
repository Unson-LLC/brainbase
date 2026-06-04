import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function defaultDataDir(): string {
  return resolve(process.env.BRAINBASE_PERSONAL_OS_DIR ?? join(homedir(), '.brainbase', 'personal-os'));
}

export function resolveDataDir(input?: string): string {
  return resolve(input ?? defaultDataDir());
}
