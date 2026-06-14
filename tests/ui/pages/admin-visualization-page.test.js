import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { AdminPage, getAuthHeaders, JA_LABELS, SOURCE_CLASS_LABELS, formatStatusLabel } from '../../../public/modules/pages/admin-visualization-page.js';

describe('admin visualization page', () => {
    it('INV-10 Contract-6 S-8: primary labels are Japanese with source class names', () => {
        expect(JA_LABELS.title).toBe('Brainbase 管理画面');
        expect(JA_LABELS.overview).toBe('概要');
        expect(JA_LABELS.graph).toBe('Graph正本');
        expect(JA_LABELS.candidates).toBe('候補ストア');
        expect(JA_LABELS.context).toBe('AI文脈');
        expect(JA_LABELS.health).toBe('設定/ヘルス');
        expect(SOURCE_CLASS_LABELS.graph_ssot).toBe('Graph正本');
        expect(SOURCE_CLASS_LABELS.candidate_store).toBe('候補ストア');
    });

    it('INV-7: getAuthHeaders reuses existing Brainbase auth token without inventing auth state', () => {
        const storage = { getItem: (key) => key === 'brainbase.auth.token' ? 'token-123' : null };
        expect(getAuthHeaders(storage)).toEqual({ Authorization: 'Bearer token-123' });
    });

    it('Contract-6: status codes resolve to Japanese display labels with code fallback', () => {
        expect(formatStatusLabel('available')).toBe('接続済み');
        expect(formatStatusLabel('not_configured')).toBe('未設定');
        expect(formatStatusLabel('not_found')).toBe('未検出');
        expect(formatStatusLabel('pending_approval')).toBe('承認待ち');
        expect(formatStatusLabel('promoted_to_graph')).toBe('Graph反映済み');
        expect(formatStatusLabel('needs_redaction')).toBe('秘匿要');
        expect(formatStatusLabel('rejected')).toBe('却下');
        expect(formatStatusLabel('unknown_code')).toBe('unknown_code');
    });

    it('Contract-4 S-4: mutating admin requests fetch and attach CSRF token with auth headers', async () => {
        const calls = [];
        const fetchImpl = async function (url, options = {}) {
            calls.push({ url, options, thisValue: this });
            if (url === '/api/csrf-token') {
                return { ok: true, json: async () => ({ token: 'csrf-123' }) };
            }
            return { ok: true, json: async () => ({ ok: true }) };
        };
        const page = new AdminPage({
            root: document.createElement('div'),
            fetchImpl,
            storage: { getItem: (key) => key === 'brainbase.auth.token' ? 'token-123' : null }
        });

        await page.request('/api/admin/context-preview', { method: 'POST', body: { project: 'brainbase' } });

        expect(calls[0].url).toBe('/api/csrf-token');
        expect(calls[0].thisValue).toBe(globalThis);
        expect(calls[1].url).toBe('/api/admin/context-preview');
        expect(calls[1].thisValue).toBe(globalThis);
        expect(calls[1].options.headers.Authorization).toBe('Bearer token-123');
        expect(calls[1].options.headers['X-CSRF-Token']).toBe('csrf-123');
    });

    it('Contract-4 S-4: available context preview renders warnings and memory/philosophy state visibly', async () => {
        const root = document.createElement('div');
        const fetchImpl = async (url) => {
            if (url === '/api/csrf-token') return { ok: true, json: async () => ({ token: 'csrf-123' }) };
            return {
                ok: true,
                json: async () => ({
                    source_class: 'ai_context',
                    status: 'available',
                    warnings: ['1件のmemoryは除外されました'],
                    preview: {
                        project_code: 'brainbase',
                        entity_count: 2,
                        edge_count: 1,
                        report_preview: 'Graph report',
                        included: [{ type: 'project', count: 1 }],
                        memory: { included_count: 0, denied_count: 1, denied_reasons: { private_scope_denied: 1 } },
                        philosophy_context: { included_in_agent_context: true }
                    }
                })
            };
        };
        const page = new AdminPage({ root, fetchImpl, storage: { getItem: () => null } });
        root.innerHTML = page.shell();
        root.querySelector('[name="includeMemory"]').checked = true;

        await page.loadContext();

        expect(root.textContent).toContain('1件のmemoryは除外されました');
        expect(root.textContent).toContain('memory denied: 1');
        expect(root.textContent).toContain('含まれた文脈');
        expect(root.textContent).toContain('project: 1');
        expect(root.textContent).toContain('除外理由');
        expect(root.textContent).toContain('private_scope_denied: 1');
        expect(root.textContent).toContain('philosophy: 含む');
    });

    it('INV-7: candidate-store warnings are visible when records are suppressed', async () => {
        const root = document.createElement('div');
        const fetchImpl = async () => ({
            ok: true,
            json: async () => ({
                source_class: 'candidate_store',
                warnings: ['personIdがないため候補ストアは表示しません'],
                records: []
            })
        });
        const page = new AdminPage({ root, fetchImpl, storage: { getItem: () => null } });
        root.innerHTML = page.shell();

        await page.loadCandidates();

        expect(root.textContent).toContain('personIdがないため候補ストアは表示しません');
        expect(root.textContent).toContain('表示できるレコードがありません');
    });

    it('Contract-4: global refresh reruns context preview on the AI context tab', async () => {
        const root = document.createElement('div');
        const calls = [];
        const fetchImpl = async (url, options = {}) => {
            calls.push({ url, options });
            if (url === '/api/csrf-token') return { ok: true, json: async () => ({ token: 'csrf-123' }) };
            return {
                ok: true,
                json: async () => ({
                    source_class: 'ai_context',
                    status: 'available',
                    warnings: [],
                    preview: {
                        project_code: 'brainbase',
                        entity_count: 1,
                        edge_count: 0,
                        report_preview: 'refresh preview',
                        included: [{ type: 'project', count: 1 }],
                        memory: { included_count: 0, denied_count: 0, denied_reasons: {} },
                        philosophy_context: { included_in_agent_context: false }
                    }
                })
            };
        };
        const page = new AdminPage({ root, fetchImpl, storage: { getItem: () => null } });
        root.innerHTML = page.shell();
        page.active = 'context';
        page.state.context = { status: 'available' };

        await page.load(true);

        expect(calls.map((call) => call.url)).toEqual(['/api/csrf-token', '/api/admin/context-preview']);
        expect(root.textContent).toContain('refresh preview');
    });

    it('Contract-6: admin.html mounts the Japanese admin visualization module', () => {
        const html = fs.readFileSync(path.join(process.cwd(), 'public/admin.html'), 'utf-8');
        expect(html).toContain('data-admin-root');
        expect(html).toContain('modules/pages/admin-visualization-page.js');
        expect(html).toContain('lang="ja"');
    });
});
