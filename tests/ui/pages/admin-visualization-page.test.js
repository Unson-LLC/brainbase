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
        expect(JA_LABELS.personalKg).toBe('個人KG');
        expect(JA_LABELS.context).toBe('AI文脈');
        expect(JA_LABELS.health).toBe('設定/ヘルス');
        expect(SOURCE_CLASS_LABELS.graph_ssot).toBe('Graph正本');
        expect(SOURCE_CLASS_LABELS.candidate_store).toBe('候補ストア');
        expect(SOURCE_CLASS_LABELS.personal_kg).toBe('個人KG');
    });

    it('INV-7: getAuthHeaders reuses existing Brainbase auth token without inventing auth state', () => {
        const storage = { getItem: (key) => key === 'brainbase.auth.token' ? 'token-123' : null };
        expect(getAuthHeaders(storage)).toEqual({ Authorization: 'Bearer token-123' });
    });

    it('Contract-6: status codes resolve to Japanese display labels with code fallback', () => {
        expect(formatStatusLabel('available')).toBe('接続済み');
        expect(formatStatusLabel('partial')).toBe('一部不足');
        expect(formatStatusLabel('not_configured')).toBe('未設定');
        expect(formatStatusLabel('connected')).toBe('接続済み');
        expect(formatStatusLabel('not_checked')).toBe('未確認');
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

    it('INV-9 S-11: Graph and candidate-store unavailable states are visible instead of looking empty', async () => {
        const root = document.createElement('div');
        const fetchImpl = async (url) => ({
            ok: true,
            json: async () => {
                if (String(url).startsWith('/api/admin/graph/entities')) {
                    return {
                        source_class: 'graph_ssot',
                        status: 'unavailable',
                        reason: 'InfoSSOTService is not configured',
                        records: []
                    };
                }
                return {
                    source_class: 'candidate_store',
                    status: 'unavailable',
                    reason: 'candidateRepository is not configured',
                    records: []
                };
            }
        });
        const page = new AdminPage({ root, fetchImpl, storage: { getItem: () => null } });
        root.innerHTML = page.shell();

        await page.loadGraph();
        await page.loadCandidates();

        expect(root.textContent).toContain('未接続');
        expect(root.textContent).toContain('Graph正本サービスが未設定です');
        expect(root.textContent).toContain('候補ストアリポジトリが未設定です');
        expect(root.querySelector('[data-graph-list]')?.textContent).not.toContain('表示できるレコードがありません');
        expect(root.querySelector('[data-candidate-list]')?.textContent).not.toContain('表示できるレコードがありません');
    });

    it('INV-5 Contract-7: Personal KG summary and records render in Japanese admin UI', async () => {
        const root = document.createElement('div');
        const fetchImpl = async () => ({
            ok: true,
            json: async () => ({
                source_class: 'personal_kg',
                status: 'available',
                owner_person_id: 'sato_keigo',
                warnings: [],
                summary: { total: 2, returned_count: 1, active_count: 2, sns_ready_count: 1, needs_redaction_count: 0, agency_none_count: 1, latest_seen_at: '2026-06-09T00:00:00.000Z', truncated: true },
                records: [
                    { source_class: 'personal_kg', id: 'cand_kg', memory_layer: 'personal_kg_core', sns_ready: false, promotion_status: 'candidate', redaction_status: 'none', requires_approval: true, cognitive_type: 'insight', agency_level: 'synthesize', source_system: 'codex', created_at: '2026-06-09T00:00:00.000Z', body_preview: '判断基準' }
                ]
            })
        });
        const page = new AdminPage({ root, fetchImpl, storage: { getItem: () => null } });
        root.innerHTML = page.shell();

        await page.loadPersonalKg();

        expect(root.textContent).toContain('個人KG候補');
        expect(root.textContent).toContain('SNS利用可');
        expect(root.textContent).toContain('要レビュー');
        expect(root.textContent).toContain('所有者: sato_keigo');
        expect(root.textContent).toContain('表示: 1 / 2');
        expect(root.textContent).toContain('上限で省略あり');
        expect(root.textContent).toContain('さらに表示');
        expect(root.textContent).toContain('記憶層: personal_kg_core');
        expect(root.textContent).toContain('SNS利用可: いいえ');
        expect(root.textContent).toContain('レビュー: 要');
        expect(root.textContent).toContain('判断基準');
    });

    it('INV-5 Contract-7: Personal KG renders SNS-ready records as usable in Japanese', async () => {
        const root = document.createElement('div');
        const fetchImpl = async () => ({
            ok: true,
            json: async () => ({
                source_class: 'personal_kg',
                status: 'available',
                owner_person_id: 'sato_keigo',
                warnings: [],
                summary: { total: 1, returned_count: 1, active_count: 1, sns_ready_count: 1, review_count: 0, needs_redaction_count: 0, agency_none_count: 0, truncated: false },
                records: [
                    { source_class: 'personal_kg', id: 'cand_sns_ready', memory_layer: 'sns_ready', sns_ready: true, promotion_status: 'approved', redaction_status: 'none', requires_approval: false, cognitive_type: 'insight', agency_level: 'read-only', source_system: 'brainbase', created_at: '2026-06-09T00:00:00.000Z', body_preview: 'SNSに使える候補' }
                ]
            })
        });
        const page = new AdminPage({ root, fetchImpl, storage: { getItem: () => null } });
        root.innerHTML = page.shell();

        await page.loadPersonalKg();

        expect(root.textContent).toContain('記憶層: sns_ready');
        expect(root.textContent).toContain('SNS利用可: はい');
        expect(root.textContent).toContain('反映状態: 承認済み');
        expect(root.textContent).toContain('SNSに使える候補');
    });

    it('INV-5 Contract-7: Personal KG load-more increases the bounded latest-record limit', async () => {
        const root = document.createElement('div');
        const urls = [];
        const fetchImpl = async (url) => {
            urls.push(url);
            const limit = new URL(`http://localhost${url}`).searchParams.get('limit');
            return {
                ok: true,
                json: async () => ({
                    source_class: 'personal_kg',
                    status: 'available',
                    owner_person_id: 'sato_keigo',
                    warnings: [],
                    summary: { total: 120, returned_count: Number(limit), active_count: 120, sns_ready_count: 1, review_count: 1, needs_redaction_count: 0, agency_none_count: 0, truncated: Number(limit) < 120 },
                    records: [{ source_class: 'personal_kg', id: `cand_${limit}`, memory_layer: 'personal_kg_core', sns_ready: false, promotion_status: 'candidate', redaction_status: 'none', requires_approval: false, cognitive_type: 'insight', body_preview: 'bounded' }]
                })
            };
        };
        const page = new AdminPage({ root, fetchImpl, storage: { getItem: () => null } });
        root.innerHTML = page.shell();

        await page.loadPersonalKg();
        root.querySelector('[data-load-more-personal-kg]').click();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(urls[0]).toContain('limit=50');
        expect(urls[1]).toContain('limit=100');
    });

    it('INV-5 Contract-7: Personal KG load-more stops at the bounded 500 record cap', async () => {
        const root = document.createElement('div');
        const fetchImpl = async (url) => {
            const limit = Number(new URL(`http://localhost${url}`).searchParams.get('limit'));
            return {
                ok: true,
                json: async () => ({
                    source_class: 'personal_kg',
                    status: 'available',
                    owner_person_id: 'sato_keigo',
                    warnings: [],
                    summary: { total: 3146, returned_count: limit, active_count: 3146, sns_ready_count: 1, review_count: 1, needs_redaction_count: 0, agency_none_count: 0, truncated: true },
                    records: [{ source_class: 'personal_kg', id: `cand_${limit}`, memory_layer: 'personal_kg_core', sns_ready: false, promotion_status: 'candidate', redaction_status: 'none', requires_approval: false, cognitive_type: 'insight', body_preview: 'bounded' }]
                })
            };
        };
        const page = new AdminPage({ root, fetchImpl, storage: { getItem: () => null } });
        root.innerHTML = page.shell();
        page.personalKgLimit = 500;

        await page.loadPersonalKg();

        expect(root.textContent).toContain('最新500件の上限に達しました');
        expect(root.textContent).toContain('絞り込んでください');
        expect(root.querySelector('[data-load-more-personal-kg]')).toBeNull();
    });

    it('INV-7 Contract-7: Personal KG direct controls render HTTP errors instead of leaving stale records', async () => {
        const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
        const successPayload = {
            source_class: 'personal_kg',
            status: 'available',
            owner_person_id: 'sato_keigo',
            warnings: [],
            summary: { total: 120, returned_count: 50, active_count: 120, sns_ready_count: 1, review_count: 1, needs_redaction_count: 0, agency_none_count: 0, truncated: true },
            records: [{ source_class: 'personal_kg', id: 'cand_visible', memory_layer: 'personal_kg_core', sns_ready: false, promotion_status: 'candidate', redaction_status: 'none', requires_approval: false, cognitive_type: 'insight', body_preview: '古い表示' }]
        };
        const failedResponse = { ok: false, status: 401, text: async () => '{"error":"Authorization token required"}' };

        const filterRoot = document.createElement('div');
        let filterCalls = 0;
        const filterPage = new AdminPage({
            root: filterRoot,
            fetchImpl: async (url) => {
                if (String(url).startsWith('/api/admin/personal-kg')) {
                    filterCalls += 1;
                    return filterCalls === 1 ? { ok: true, json: async () => successPayload } : failedResponse;
                }
                return { ok: true, json: async () => ({ sources: [] }) };
            },
            storage: { getItem: () => null }
        });
        filterPage.active = 'personal-kg';
        filterPage.mount();
        await flush();
        await flush();
        expect(filterRoot.textContent).toContain('cand_visible');

        filterRoot.querySelector('[data-load-personal-kg]').click();
        await flush();
        await flush();

        expect(filterRoot.querySelector('[data-personal-kg-list]')?.textContent).toContain('認証が必要です');
        expect(filterRoot.querySelector('[data-personal-kg-list]')?.textContent).toContain('表示できません');
        expect(filterRoot.querySelector('[data-personal-kg-list]')?.textContent).not.toContain('cand_visible');
        expect(filterRoot.textContent).not.toContain('Authorization token required');

        const loadMoreRoot = document.createElement('div');
        let loadMoreCalls = 0;
        const loadMorePage = new AdminPage({
            root: loadMoreRoot,
            fetchImpl: async () => {
                loadMoreCalls += 1;
                return loadMoreCalls === 1 ? { ok: true, json: async () => successPayload } : failedResponse;
            },
            storage: { getItem: () => null }
        });
        loadMorePage.active = 'personal-kg';
        loadMoreRoot.innerHTML = loadMorePage.shell();
        await loadMorePage.loadPersonalKg();

        loadMoreRoot.querySelector('[data-load-more-personal-kg]').click();
        await flush();
        await flush();

        expect(loadMoreRoot.querySelector('[data-personal-kg-list]')?.textContent).toContain('認証が必要です');
        expect(loadMoreRoot.querySelector('[data-personal-kg-list]')?.textContent).not.toContain('cand_visible');
        expect(loadMorePage.personalKgLimit).toBe(50);
    });

    it('INV-7: API auth failures render Japanese guidance without raw JSON', async () => {
        const root = document.createElement('div');
        const fetchImpl = async () => ({
            ok: false,
            status: 401,
            text: async () => '{"error":"Authorization token required"}'
        });
        const page = new AdminPage({ root, fetchImpl, storage: { getItem: () => null } });
        root.innerHTML = page.shell();

        await page.load();

        expect(root.textContent).toContain('認証が必要です');
        expect(root.textContent).toContain('表示できません');
        expect(root.textContent).not.toContain('Authorization token required');
        expect(root.textContent).not.toContain('{"error"');
    });

    it('INV-7 Contract-7: Personal KG unavailable state is visible instead of looking empty', async () => {
        const root = document.createElement('div');
        const fetchImpl = async () => ({
            ok: true,
            json: async () => ({
                source_class: 'personal_kg',
                status: 'unavailable',
                reason: 'candidate repository unavailable',
                warnings: ['owner_person_idがないため個人KGは表示しません'],
                records: [],
                summary: { total: 0 }
            })
        });
        const page = new AdminPage({ root, fetchImpl, storage: { getItem: () => null } });
        root.innerHTML = page.shell();

        await page.loadPersonalKg();

        expect(root.textContent).toContain('未接続');
        expect(root.textContent).toContain('候補ストアリポジトリが未設定のため個人KGを取得できません');
        expect(root.textContent).not.toContain('candidate repository unavailable');
        expect(root.textContent).toContain('owner_person_idがないため個人KGは表示しません');
        expect(root.textContent).not.toContain('全件表示');
    });

    it('INV-7 Contract-7: denied Personal KG owner filter renders as out of scope, not empty success', async () => {
        const root = document.createElement('div');
        const fetchImpl = async () => ({
            ok: true,
            json: async () => ({
                source_class: 'personal_kg',
                status: 'available',
                owner_person_id: null,
                requested_owner_person_id: 'umeda',
                warnings: ['指定された所有者(umeda)は現在の権限では表示できません'],
                summary: { total: 0, returned_count: 0 },
                records: []
            })
        });
        const page = new AdminPage({ root, fetchImpl, storage: { getItem: () => null } });
        root.innerHTML = page.shell();

        await page.loadPersonalKg();

        expect(root.textContent).toContain('表示対象外');
        expect(root.textContent).toContain('指定された所有者(umeda)は現在の権限では表示できません');
        expect(root.textContent).not.toContain('全件表示');
        expect(root.textContent).not.toContain('個人KG候補');
    });

    it('Contract-6: health view shows DB connection status separately from redacted config keys', async () => {
        const root = document.createElement('div');
        const fetchImpl = async () => ({
            ok: true,
            json: async () => ({
                sources: [{ source_class: 'runtime_config', label: '設定/実行環境', status: 'available' }],
                runtime_config: {
                    database: { source_class: 'runtime_config', label: 'DB接続先', status: 'available', connection_status: 'connected', keys: ['INFO_SSOT_DATABASE_URL', 'INFO_SSOT_DB_URL'], value: null, value_redacted: true },
                    checks: [{ source_class: 'personal_kg', label: '個人KG read path', status: 'unavailable', reason: '個人KG read path確認に失敗しました。migrationまたは権限をサーバーログで確認してください' }],
                    keys: [{ source_class: 'runtime_config', key: 'INFO_SSOT_DATABASE_URL', status: 'present', value: null, value_redacted: true }]
                }
            })
        });
        const page = new AdminPage({ root, fetchImpl, storage: { getItem: () => null } });
        root.innerHTML = page.shell();

        await page.loadHealth();

        expect(root.textContent).toContain('DB接続先');
        expect(root.textContent).toContain('接続: 接続済み');
        expect(root.textContent).toContain('個人KG read path');
        expect(root.textContent).toContain('migrationまたは権限');
        expect(root.textContent).toContain('値: 非表示');
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
