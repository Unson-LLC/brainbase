#!/usr/bin/env node

// Record-only canary: deliberately has no dependency on SQLite, the Resolver,
// or business services. It never resolves a contract or blocks a conversation.
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const events = new Set(['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop']);
let observation;
try {
    const payload = JSON.parse(readFileSync(0, 'utf8'));
    const event = payload?.hook_event_name ?? payload?.hookEventName;
    const present = (key) => typeof payload?.[key] === 'string' && payload[key].trim().length > 0;
    observation = {
        schema_version: 'brainbase-judgment-hook-observation-v1',
        recorded_at: new Date().toISOString(),
        mode: 'record_only',
        event: events.has(event) ? event : 'unknown',
        session_ref: present('session_id') ? hash(payload.session_id) : null,
        turn_ref: present('turn_id') ? hash(payload.turn_id.trim()) : null,
        input_shape: {
            prompt_present: typeof payload?.prompt === 'string',
            prompt_nonempty: present('prompt'),
            transcript_path_present: present('transcript_path'),
            session_id_present: present('session_id'),
            turn_id_present: present('turn_id')
        },
        stop_hook_active: payload?.stop_hook_active === true,
        node_version: process.version,
        architecture: process.arch,
        audit_status: 'not_evaluated',
        action_authorized: false
    };
    const root = process.env.BRAINBASE_JUDGMENT_JOURNAL_DIR
        ? resolve(process.env.BRAINBASE_JUDGMENT_JOURNAL_DIR)
        : join(homedir(), '.codex', 'var', 'judgment-resolver');
    const directory = join(root, 'hook-observations', observation.session_ref ?? 'unknown', observation.turn_ref ?? 'unknown');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(join(directory, `${randomUUID()}.json`), `${JSON.stringify(observation)}\n`, { mode: 0o600, flag: 'wx' });
} catch {
    process.stderr.write(`${JSON.stringify({
        schema_version: 'brainbase-judgment-hook-observation-failure-v1',
        mode: 'record_only',
        reason: observation ? 'observation_persist_failed' : 'hook_payload_invalid',
        observation: observation ?? null,
        diagnostic_persisted: false
    })}\n`);
}
process.stdout.write('{}\n');
