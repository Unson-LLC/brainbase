import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    appendPendingFallback,
    buildAgentReportPayload,
    buildRunId,
    decodeJwtSubject,
    DEFAULT_REQUIRED_BY,
    isServiceToken,
    resolveReportOwner,
    senderToRoleAgentId,
    submitReport
} from '../../scripts/bin/bb-report-submit.mjs';

function makeJwt(payload) {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' }), 'utf8').toString('base64url');
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    return `${header}.${body}.signature`;
}

describe('senderToRoleAgentId', () => {
    it('agent_ceo呼び出し時_agent_ceoが返される', () => {
        expect(senderToRoleAgentId('agent/ceo')).toBe('agent_ceo');
    });

    it('agent_cso呼び出し時_agent_csoが返される', () => {
        expect(senderToRoleAgentId('agent/cso')).toBe('agent_cso');
    });

    it('agent_retro呼び出し時_agent_retroが返される', () => {
        expect(senderToRoleAgentId('agent/retro')).toBe('agent_retro');
    });

    it('未知のsender呼び出し時_agent_プレフィックス変換でフォールバックする', () => {
        expect(senderToRoleAgentId('agent/unknown-thing')).toBe('agent_unknown_thing');
    });
});

describe('buildRunId', () => {
    it('同じsenderとperiod_同じrun_idが返される（冪等性）', () => {
        const first = buildRunId('agent/ceo', '2026-07');
        const second = buildRunId('agent/ceo', '2026-07');
        expect(first).toBe(second);
        expect(first).toBe('wfr_agent_ceo_2026-07');
    });

    it('periodが異なる_異なるrun_idが返される', () => {
        expect(buildRunId('agent/ceo', '2026-07')).not.toBe(buildRunId('agent/ceo', '2026-08'));
    });
});

describe('buildAgentReportPayload', () => {
    const baseArgs = {
        sender: 'agent/ceo',
        title: 'CEOレビュー完了: モード=Growth, 来月アクション3件',
        period: '2026-07',
        markdown: '# CEOレビュー\n\n本文がここに入ります。'
    };

    it('必須項目が揃っている場合_external_runner_v0準拠のpayloadが組み立てられる', () => {
        const payload = buildAgentReportPayload(baseArgs);

        expect(payload.contract_version).toBe('external_runner.v0');
        expect(payload.runner.type).toBe('agent_report');
        expect(payload.runner.agent_id).toBe('agent/ceo');
        expect(payload.run.role_agent_id).toBe('agent_ceo');
        expect(payload.run.status).toBe('waiting_human');
        expect(payload.run.id).toBe('wfr_agent_ceo_2026-07');
        expect(payload.loop_control.owner_id).toBe('sato_keigo');
        expect(payload.loop_control.approval_owner_id).toBe('sato_keigo');
        expect(payload.human_steps).toHaveLength(1);
        expect(payload.human_steps[0].required_by).toBe('sato_keigo');
        expect(payload.human_steps[0].status).toBe('pending');
        expect(payload.human_steps[0].approval_reason).toBe(baseArgs.title);
        expect(payload.outputs).toHaveLength(1);
        expect(payload.outputs[0].payload.markdown).toBe(baseArgs.markdown);
        expect(payload.outputs[0].preview.length).toBeLessThanOrEqual(240);
        expect(payload.context_sources).toHaveLength(1);
        expect(payload.rounds).toHaveLength(1);
    });

    it('requiredByを指定した場合_loop_controlとhuman_stepsに反映される', () => {
        const payload = buildAgentReportPayload({ ...baseArgs, requiredBy: 'someone_else' });
        expect(payload.loop_control.owner_id).toBe('someone_else');
        expect(payload.human_steps[0].required_by).toBe('someone_else');
    });

    it('markdown本文が長い場合_previewは240字に切り詰められる', () => {
        const longMarkdown = 'あ'.repeat(500);
        const payload = buildAgentReportPayload({ ...baseArgs, markdown: longMarkdown });
        expect(payload.outputs[0].preview).toHaveLength(240);
        expect(payload.outputs[0].payload.markdown).toBe(longMarkdown);
    });

    it('senderが未指定_エラーが投げられる', () => {
        expect(() => buildAgentReportPayload({ ...baseArgs, sender: undefined })).toThrow(/sender is required/);
    });

    it('titleが未指定_エラーが投げられる', () => {
        expect(() => buildAgentReportPayload({ ...baseArgs, title: undefined })).toThrow(/title is required/);
    });

    it('periodが未指定_エラーが投げられる', () => {
        expect(() => buildAgentReportPayload({ ...baseArgs, period: undefined })).toThrow(/period is required/);
    });

    it('markdownが空文字_エラーが投げられる', () => {
        expect(() => buildAgentReportPayload({ ...baseArgs, markdown: '   ' })).toThrow(/markdown body is required/);
    });

    it('同じ引数で複数回呼び出し_同じrun_idが返される（duplicate replay対応の前提）', () => {
        const first = buildAgentReportPayload(baseArgs);
        const second = buildAgentReportPayload(baseArgs);
        expect(first.run.id).toBe(second.run.id);
    });
});

describe('appendPendingFallback', () => {
    let tmpDir;

    afterEach(() => {
        if (tmpDir && fs.existsSync(tmpDir)) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('送信失敗時_pending_mdにfrontmatter形式で追記される', () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-report-submit-test-'));
        const pendingPath = path.join(tmpDir, '_inbox', 'pending.md');

        const result = appendPendingFallback({
            sender: 'agent/ceo',
            title: 'CEOレビュー完了',
            reasonDetail: 'ingest failed: HTTP 401',
            pendingPath
        });

        expect(fs.existsSync(pendingPath)).toBe(true);
        const content = fs.readFileSync(pendingPath, 'utf8');
        expect(content).toContain(`id: ${result.id}`);
        expect(content).toContain('channel: ceo');
        expect(content).toContain('sender: agent/ceo');
        expect(content).toContain('status: pending');
        expect(content).toContain('CEOレビュー完了');
        expect(content).toContain('ingest failed: HTTP 401');
    });

    it('sender_agent_retro_channelはretroになる', () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-report-submit-test-'));
        const pendingPath = path.join(tmpDir, '_inbox', 'pending.md');

        appendPendingFallback({ sender: 'agent/retro', title: '週次レトロ完了', pendingPath });

        const content = fs.readFileSync(pendingPath, 'utf8');
        expect(content).toContain('channel: retro');
    });

    it('agentプレフィックスなしのsender_channelはsystemになる', () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-report-submit-test-'));
        const pendingPath = path.join(tmpDir, '_inbox', 'pending.md');

        appendPendingFallback({ sender: 'cron', title: '定期ジョブ', pendingPath });

        const content = fs.readFileSync(pendingPath, 'utf8');
        expect(content).toContain('channel: system');
        expect(content).toContain('sender: cron');
    });

    it('既存ファイルがある場合_追記される（既存内容を壊さない）', () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-report-submit-test-'));
        const pendingPath = path.join(tmpDir, '_inbox', 'pending.md');
        fs.mkdirSync(path.dirname(pendingPath), { recursive: true });
        fs.writeFileSync(pendingPath, '---\nid: INBOX-1\nchannel: system\nsender: agent\nstatus: pending\nmessage: "既存"\n---\n');

        appendPendingFallback({ sender: 'agent/cso', title: '新規エントリ', pendingPath });

        const content = fs.readFileSync(pendingPath, 'utf8');
        expect(content).toContain('既存');
        expect(content).toContain('新規エントリ');
    });
});

describe('submitReport（送信＋フォールバック制御フロー）', () => {
    const silentLogger = { log: () => {}, error: () => {} };
    let tmpDir;

    afterEach(() => {
        if (tmpDir && fs.existsSync(tmpDir)) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    function buildPayload() {
        return buildAgentReportPayload({
            sender: 'agent/cso',
            title: 'CSOレビュー 2026-07',
            period: '2026-07',
            markdown: '# 本文'
        });
    }

    it('送信成功時_okと statusが返されfallbackは書かれない', async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-report-submit-test-'));
        const pendingPath = path.join(tmpDir, '_inbox', 'pending.md');
        const calls = [];
        const fetchImpl = async (url, options) => {
            calls.push({ url, options });
            return { ok: true, status: 201, text: async () => '{"run":{}}' };
        };

        const result = await submitReport({
            payload: buildPayload(),
            baseUrl: 'http://localhost:31013',
            sender: 'agent/cso',
            title: 'CSOレビュー 2026-07',
            pendingPath,
            fetchImpl,
            tokenReader: () => 'test-token',
            logger: silentLogger
        });

        expect(result).toMatchObject({ ok: true, status: 201 });
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('http://localhost:31013/api/external-runner/ingest');
        expect(calls[0].options.headers.Authorization).toBe('Bearer test-token');
        expect(fs.existsSync(pendingPath)).toBe(false);
    });

    it('fetch失敗時_catch経路でpending_mdフォールバックが書かれる', async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-report-submit-test-'));
        const pendingPath = path.join(tmpDir, '_inbox', 'pending.md');
        const fetchImpl = async () => { throw new Error('ECONNREFUSED 127.0.0.1:31013'); };

        const result = await submitReport({
            payload: buildPayload(),
            baseUrl: 'http://localhost:31013',
            sender: 'agent/cso',
            title: 'CSOレビュー 2026-07',
            pendingPath,
            fetchImpl,
            tokenReader: () => 'test-token',
            logger: silentLogger
        });

        expect(result.ok).toBe(false);
        expect(result.reasonDetail).toContain('ECONNREFUSED');
        const content = fs.readFileSync(pendingPath, 'utf8');
        expect(content).toContain('channel: cso');
        expect(content).toContain('sender: agent/cso');
        expect(content).toContain('ECONNREFUSED');
    });

    it('HTTP非2xx時_catch経路でpending_mdフォールバックが書かれる', async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-report-submit-test-'));
        const pendingPath = path.join(tmpDir, '_inbox', 'pending.md');
        const fetchImpl = async () => ({ ok: false, status: 401, text: async () => 'token expired' });

        const result = await submitReport({
            payload: buildPayload(),
            baseUrl: 'http://localhost:31013',
            sender: 'agent/cso',
            title: 'CSOレビュー 2026-07',
            pendingPath,
            fetchImpl,
            tokenReader: () => 'stale-token',
            logger: silentLogger
        });

        expect(result.ok).toBe(false);
        expect(result.reasonDetail).toContain('HTTP 401');
        const content = fs.readFileSync(pendingPath, 'utf8');
        expect(content).toContain('status: pending');
        expect(content).toContain('HTTP 401');
    });

    it('tokenReader失敗時_catch経路でpending_mdフォールバックが書かれる', async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-report-submit-test-'));
        const pendingPath = path.join(tmpDir, '_inbox', 'pending.md');
        let fetchCalled = false;

        const result = await submitReport({
            payload: buildPayload(),
            baseUrl: 'http://localhost:31013',
            sender: 'agent/cso',
            title: 'CSOレビュー 2026-07',
            pendingPath,
            fetchImpl: async () => { fetchCalled = true; throw new Error('should not reach'); },
            tokenReader: () => { throw new Error('access_token is missing from ~/.brainbase/tokens.json'); },
            logger: silentLogger
        });

        expect(result.ok).toBe(false);
        expect(fetchCalled).toBe(false);
        expect(fs.readFileSync(pendingPath, 'utf8')).toContain('access_token is missing');
    });
});

describe('isServiceToken', () => {
    it('bbsvc_プレフィックスのトークン_trueが返される', () => {
        expect(isServiceToken('bbsvc_abc123')).toBe(true);
    });

    it('bbsvc_プレフィックスなしのトークン_falseが返される', () => {
        expect(isServiceToken(makeJwt({ sub: 'per_01KGYC7NNS0VXADK7NP48W4VR5' }))).toBe(false);
    });

    it('文字列以外の入力_falseが返される', () => {
        expect(isServiceToken(undefined)).toBe(false);
        expect(isServiceToken(null)).toBe(false);
    });
});

describe('decodeJwtSubject', () => {
    it('個人JWT_subクレーム（personId）が返される', () => {
        const token = makeJwt({ sub: 'per_01KGYC7NNS0VXADK7NP48W4VR5' });
        expect(decodeJwtSubject(token)).toBe('per_01KGYC7NNS0VXADK7NP48W4VR5');
    });

    it('ドット区切りが3つでない文字列_nullが返される', () => {
        expect(decodeJwtSubject('bbsvc_abc123')).toBeNull();
        expect(decodeJwtSubject('not-a-jwt')).toBeNull();
    });

    it('payload部がJSONとしてデコード不能_nullが返される', () => {
        const token = 'header.not-valid-base64url-json.signature';
        expect(decodeJwtSubject(token)).toBeNull();
    });

    it('subクレームが存在しない_nullが返される', () => {
        const token = makeJwt({ typ: 'service', personId: 'svc_123' });
        expect(decodeJwtSubject(token)).toBeNull();
    });

    it('文字列以外の入力_nullが返される', () => {
        expect(decodeJwtSubject(undefined)).toBeNull();
        expect(decodeJwtSubject(null)).toBeNull();
    });
});

describe('resolveReportOwner', () => {
    it('個人トークン（bbsvc_で始まらないJWT、sub=per_XXX）_token自身のpersonIdが返される', () => {
        const token = makeJwt({ sub: 'per_01KGYC7NNS0VXADK7NP48W4VR5' });
        const owner = resolveReportOwner({ tokenReader: () => token });
        expect(owner).toBe('per_01KGYC7NNS0VXADK7NP48W4VR5');
    });

    it('サービストークン（bbsvc_...）_defaultOwner（sato_keigo）のまま', () => {
        const owner = resolveReportOwner({ tokenReader: () => 'bbsvc_someservicetoken' });
        expect(owner).toBe(DEFAULT_REQUIRED_BY);
    });

    it('overrideを指定した場合_トークンの中身に関わらずoverrideが使われる', () => {
        const token = makeJwt({ sub: 'per_01KGYC7NNS0VXADK7NP48W4VR5' });
        const owner = resolveReportOwner({ override: 'someone_else', tokenReader: () => token });
        expect(owner).toBe('someone_else');
    });

    it('環境変数相当のoverrideが空文字_トークン解決にフォールバックする', () => {
        const token = makeJwt({ sub: 'per_01KGYC7NNS0VXADK7NP48W4VR5' });
        const owner = resolveReportOwner({ override: '', tokenReader: () => token });
        expect(owner).toBe('per_01KGYC7NNS0VXADK7NP48W4VR5');
    });

    it('デコード不能なトークン_例外を投げずdefaultOwnerにフォールバックする', () => {
        const owner = resolveReportOwner({ tokenReader: () => 'not-a-jwt-at-all' });
        expect(owner).toBe(DEFAULT_REQUIRED_BY);
    });

    it('tokenReaderが例外を投げる場合_例外を投げずdefaultOwnerにフォールバックする', () => {
        const owner = resolveReportOwner({
            tokenReader: () => { throw new Error('access_token is missing from ~/.brainbase/tokens.json'); }
        });
        expect(owner).toBe(DEFAULT_REQUIRED_BY);
    });

    it('defaultOwnerをカスタム指定した場合_サービストークンでその値が返される', () => {
        const owner = resolveReportOwner({ tokenReader: () => 'bbsvc_x', defaultOwner: 'custom_owner' });
        expect(owner).toBe('custom_owner');
    });
});
