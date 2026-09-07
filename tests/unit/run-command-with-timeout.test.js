import { describe, expect, it } from 'vitest';
import { runCommandWithTimeout } from '../../scripts/run-command-with-timeout.mjs';

describe('runCommandWithTimeout', () => {
    it('returns the child exit code when the command completes', async () => {
        const result = await runCommandWithTimeout(process.execPath, ['-e', 'process.exit(7)'], {
            stdio: 'ignore',
            timeoutMs: 1_000
        });

        expect(result).toMatchObject({ exitCode: 7, timedOut: false });
    });

    it('terminates an unresponsive command at the deadline', async () => {
        const result = await runCommandWithTimeout(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], {
            stdio: 'ignore',
            timeoutMs: 50
        });

        expect(result).toMatchObject({ exitCode: 124, timedOut: true });
    });
});
