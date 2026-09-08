#!/usr/bin/env node

import { fileURLToPath } from 'node:url';

const defaultSleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

export async function waitForBrainbaseRuntime({
    url,
    expectedSha,
    attempts = 30,
    delayMs = 2000,
    requestTimeoutMs = 10000,
    fetchImpl = globalThis.fetch,
    sleep = defaultSleep,
} = {}) {
    if (!url || typeof fetchImpl !== 'function' || !Number.isInteger(attempts) || attempts < 1) {
        throw new Error('Invalid Brainbase runtime readiness options');
    }
    if (expectedSha !== undefined && !/^[0-9a-f]{40}$/u.test(expectedSha)) {
        throw new Error('Expected SHA must be a 40-character lowercase Git SHA');
    }

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            const response = await fetchImpl(url, {
                signal: AbortSignal.timeout(requestTimeoutMs),
            });
            if (response.ok) {
                if (!expectedSha) return { attempts: attempt };
                const payload = await response.json();
                const git = payload?.runtime?.git;
                if (git?.sha === expectedSha && git?.dirty === false) {
                    return { attempts: attempt };
                }
            }
        } catch {
            // Connection, timeout, and malformed JSON failures are retryable until the bound expires.
        }
        if (attempt < attempts) await sleep(delayMs);
    }

    throw new Error(`Brainbase runtime did not become ready after ${attempts} attempts`);
}

async function main() {
    const [url, expectedSha] = process.argv.slice(2);
    await waitForBrainbaseRuntime({ url, expectedSha });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
