import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const roots = [];
const hash = (value) => createHash('sha256').update(value).digest('hex');
function run(payload, invalidJournal = false) {
    const root = mkdtempSync(join(tmpdir(), 'judgment-observe-'));
    roots.push(root);
    const journal = invalidJournal ? join(root, 'not-directory') : root;
    if (invalidJournal) writeFileSync(journal, 'fixture');
    const result = spawnSync('bash', ['scripts/codex-hooks/judgment-resolver-entry.sh'], {
        encoding: 'utf8', timeout: 5000, input: typeof payload === 'string' ? payload : JSON.stringify(payload),
        env: { ...process.env, BRAINBASE_JUDGMENT_HOOK_MODE: 'record_only', BRAINBASE_JUDGMENT_JOURNAL_DIR: journal,
            BRAINBASE_JUDGMENT_HOST_URL: 'http://127.0.0.1:1/never-contact' }
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({});
    return { ...result, root };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe('record-only Hook entrypoint', () => {
    it.each(['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop'])('%sは本文なしの観測だけを保存し、停止もHTTPも行わない', (event) => {
        const payload = { session_id: 'test-session', turn_id: 'test-turn', hook_event_name: event,
            prompt: 'secret input', tool_input: { password: 'do-not-record' }, transcript_path: '/private/secret-file' };
        const result = run(payload);
        expect(result.stderr).toBe('');
        expect(readdirSync(result.root)).toEqual(['hook-observations']);
        const path = join(result.root, 'hook-observations', hash(payload.session_id), hash(payload.turn_id));
        const files = readdirSync(path);
        expect(files).toHaveLength(1);
        const text = readFileSync(join(path, files[0]), 'utf8');
        expect(JSON.parse(text)).toMatchObject({ event, mode: 'record_only', audit_status: 'not_evaluated',
            input_shape: { prompt_present: true, prompt_nonempty: true }, action_authorized: false });
        for (const value of ['secret input', 'do-not-record', '/private/secret-file', 'test-session', 'test-turn']) expect(text).not.toContain(value);
    });
    it('本文欠落と空本文を観測し、補完して成功にしない', () => {
        for (const prompt of [undefined, '']) {
            const result = run({ session_id: 's', turn_id: 't', hook_event_name: 'UserPromptSubmit', prompt });
            const path = join(result.root, 'hook-observations', hash('s'), hash('t'));
            expect(JSON.parse(readFileSync(join(path, readdirSync(path)[0]), 'utf8')).input_shape).toMatchObject({
                prompt_present: prompt !== undefined, prompt_nonempty: false
            });
        }
    });
    it('保存不能や不正入力でも会話を止めず、安全な失敗だけを返す', () => {
        expect(run({ prompt: 'secret input' }, true).stderr).toContain('observation_persist_failed');
        const invalid = run('{secret input');
        expect(invalid.stderr).toContain('hook_payload_invalid');
        expect(invalid.stderr).not.toContain('secret input');
    });
});
