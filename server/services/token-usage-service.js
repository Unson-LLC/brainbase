import fs from 'fs/promises';
import { createReadStream } from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function asNumber(value) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : 0;
}

function createBucket(source) {
    return {
        source,
        totalTokens: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        events: 0,
        filesScanned: 0
    };
}

function addUsage(bucket, usage) {
    const inputTokens = asNumber(usage.input_tokens);
    const cachedInputTokens = asNumber(usage.cached_input_tokens);
    const cacheCreationInputTokens = asNumber(usage.cache_creation_input_tokens);
    const cacheReadInputTokens = asNumber(usage.cache_read_input_tokens);
    const outputTokens = asNumber(usage.output_tokens);
    const reasoningOutputTokens = asNumber(usage.reasoning_output_tokens);
    const explicitTotal = asNumber(usage.total_tokens);
    const computedTotal = inputTokens
        + cachedInputTokens
        + cacheCreationInputTokens
        + cacheReadInputTokens
        + outputTokens
        + reasoningOutputTokens;

    bucket.inputTokens += inputTokens;
    bucket.cachedInputTokens += cachedInputTokens;
    bucket.cacheCreationInputTokens += cacheCreationInputTokens;
    bucket.cacheReadInputTokens += cacheReadInputTokens;
    bucket.outputTokens += outputTokens;
    bucket.reasoningOutputTokens += reasoningOutputTokens;
    bucket.totalTokens += explicitTotal || computedTotal;
    bucket.events += 1;
}

export function getLocalWeekStart(date = new Date()) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const daysSinceMonday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - daysSinceMonday);
    return start;
}

export class TokenUsageService {
    constructor({
        codexSessionsDir = path.join(os.homedir(), '.codex', 'sessions'),
        claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects'),
        cacheTtlMs = 60_000
    } = {}) {
        this.codexSessionsDir = codexSessionsDir;
        this.claudeProjectsDir = claudeProjectsDir;
        this.cacheTtlMs = cacheTtlMs;
        this._cache = null;
        this._cacheAt = 0;
    }

    async getWeeklyUsage({ now = new Date(), force = false } = {}) {
        const nowMs = now.getTime();
        if (!force && this._cache && nowMs - this._cacheAt < this.cacheTtlMs) {
            return this._cache;
        }

        const weekStart = getLocalWeekStart(now);
        const weekStartMs = weekStart.getTime();
        const codex = createBucket('codex');
        const claude = createBucket('claude');

        const [codexFiles, claudeFiles] = await Promise.all([
            this._collectJsonlFiles(this.codexSessionsDir, weekStartMs - ONE_DAY_MS),
            this._collectJsonlFiles(this.claudeProjectsDir, weekStartMs - ONE_DAY_MS)
        ]);

        for (const filePath of codexFiles) {
            await this._scanCodexFile(filePath, codex, weekStartMs, nowMs);
        }
        for (const filePath of claudeFiles) {
            await this._scanClaudeFile(filePath, claude, weekStartMs, nowMs);
        }

        const total = createBucket('total');
        for (const bucket of [codex, claude]) {
            total.totalTokens += bucket.totalTokens;
            total.inputTokens += bucket.inputTokens;
            total.cachedInputTokens += bucket.cachedInputTokens;
            total.cacheCreationInputTokens += bucket.cacheCreationInputTokens;
            total.cacheReadInputTokens += bucket.cacheReadInputTokens;
            total.outputTokens += bucket.outputTokens;
            total.reasoningOutputTokens += bucket.reasoningOutputTokens;
            total.events += bucket.events;
            total.filesScanned += bucket.filesScanned;
        }

        const summary = {
            period: {
                start: weekStart.toISOString(),
                end: now.toISOString(),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null
            },
            totalTokens: total.totalTokens,
            inputTokens: total.inputTokens,
            cachedInputTokens: total.cachedInputTokens,
            cacheCreationInputTokens: total.cacheCreationInputTokens,
            cacheReadInputTokens: total.cacheReadInputTokens,
            outputTokens: total.outputTokens,
            reasoningOutputTokens: total.reasoningOutputTokens,
            events: total.events,
            filesScanned: total.filesScanned,
            engines: { codex, claude },
            updatedAt: new Date().toISOString()
        };

        this._cache = summary;
        this._cacheAt = nowMs;
        return summary;
    }

    async _collectJsonlFiles(rootDir, minMtimeMs) {
        const files = [];
        const stack = [rootDir];

        while (stack.length > 0) {
            const dir = stack.pop();
            let entries;
            try {
                entries = await fs.readdir(dir, { withFileTypes: true });
            } catch {
                continue;
            }

            for (const entry of entries) {
                const entryPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    stack.push(entryPath);
                    continue;
                }
                if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;

                try {
                    const stat = await fs.stat(entryPath);
                    if (stat.mtimeMs >= minMtimeMs) files.push(entryPath);
                } catch {
                    // Ignore files that disappear during scan.
                }
            }
        }

        return files;
    }

    async _scanCodexFile(filePath, bucket, weekStartMs, nowMs) {
        let stream;
        try {
            stream = createReadStream(filePath);
            const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
            for await (const line of rl) {
                let data;
                try {
                    data = JSON.parse(line);
                } catch {
                    continue;
                }
                if (data.type !== 'event_msg' || data.payload?.type !== 'token_count') continue;
                const timestampMs = Date.parse(data.timestamp || '');
                if (!Number.isFinite(timestampMs) || timestampMs < weekStartMs || timestampMs > nowMs) continue;
                const usage = data.payload?.info?.last_token_usage;
                if (!usage) continue;
                addUsage(bucket, usage);
            }
            bucket.filesScanned += 1;
        } catch {
            // Ignore unreadable logs.
        } finally {
            if (stream && !stream.destroyed) stream.destroy();
        }
    }

    async _scanClaudeFile(filePath, bucket, weekStartMs, nowMs) {
        let stream;
        const seenRequests = new Set();
        try {
            stream = createReadStream(filePath);
            const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
            for await (const line of rl) {
                let data;
                try {
                    data = JSON.parse(line);
                } catch {
                    continue;
                }
                if (data.type !== 'assistant') continue;
                const timestampMs = Date.parse(data.timestamp || '');
                if (!Number.isFinite(timestampMs) || timestampMs < weekStartMs || timestampMs > nowMs) continue;

                const usage = data.message?.usage || data.usage;
                if (!usage) continue;
                const requestKey = data.requestId || data.message?.id || data.uuid;
                if (requestKey && seenRequests.has(requestKey)) continue;
                if (requestKey) seenRequests.add(requestKey);
                addUsage(bucket, usage);
            }
            bucket.filesScanned += 1;
        } catch {
            // Ignore unreadable logs.
        } finally {
            if (stream && !stream.destroyed) stream.destroy();
        }
    }
}
