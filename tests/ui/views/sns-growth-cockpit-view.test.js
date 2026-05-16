import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SnsGrowthCockpitView } from '../../../public/modules/ui/views/sns-growth-cockpit-view.js';

describe('SnsGrowthCockpitView', () => {
    let container;
    const posts = [
        {
            id: 'sns_20260513_1_trust_balance',
            date: '2026-05-13',
            time: '09:00',
            title: '生産性を最大化する情報の流れ設計',
            status: 'review_needed',
            account_handle: '@AIBizNavigator',
            lane: 'trust_balance',
            body: 'チームの生産性を最大化するために、最も重要なのは情報の流れを整えること',
            source: { type: 'Personal KG', url: 'https://brainbase.io/blog/information-flow' },
            evidence: {
                persona_brain: { target_person: 'AI導入を任されたPM' },
                graph_check: { status: 'ok' },
                quality_gate: { status: 'pass' },
                reader_affect: '実務に置き換えやすい',
                algorithm_fit: {
                    decision: 'reviewable',
                    candidate_source: 'personal_kg_semantic_anchor',
                    predicted_positive_actions: ['bookmark', 'profile_click', 'dwell'],
                    negative_feedback_risks: [],
                    graph_edge_goal: 'bookmark_or_profile_visit:trust_balance'
                }
            },
            revisions: []
        },
        {
            id: 'sns_20260513_2_peer',
            date: '2026-05-13',
            time: '15:00',
            title: 'プロジェクトの成功率を上げる',
            status: 'review_needed',
            account_handle: '@AIBizNavigator',
            lane: 'peer_circle',
            body: 'これ、Claude Codeを会社で使う時も同じだと思ってる',
            source: { type: 'Peer Circle', url: 'https://x.com/near/status/1' },
            evidence: {
                persona_brain: { target_person: 'AI導入を任されたPM' },
                graph_check: { status: 'ok' },
                quality_gate: { status: 'pass' },
                reader_affect: '現場に接続しやすい'
            },
            revisions: []
        },
        {
            id: 'sns_20260514_1_scheduled',
            date: '2026-05-14',
            time: '18:00',
            title: '良い情報設計とは',
            status: 'scheduled',
            account_handle: '@AIBizNavigator',
            lane: 'philosophy',
            body: '良い情報設計とは、次の判断を速くするための文脈づくり',
            source: { type: 'Personal KG' },
            evidence: {
                persona_brain: { target_person: 'AI導入を任されたPM' },
                graph_check: { status: 'ok' },
                quality_gate: { status: 'pass' },
                reader_affect: '保存しやすい'
            },
            revisions: []
        },
        {
            id: 'sns_20260514_2_posted',
            date: '2026-05-14',
            time: '21:00',
            title: '投稿済みの学習候補',
            status: 'posted',
            account_handle: '@AIBizNavigator',
            lane: 'learn_in_public',
            body: '投稿済みの反応を学習に戻す',
            source: { type: 'News' },
            evidence: {
                persona_brain: { target_person: 'AI導入を任されたPM' },
                graph_check: { status: 'ok' },
                quality_gate: { status: 'pass' },
                reader_affect: '次の仮説につながる'
            },
            revisions: []
        },
        {
            id: 'sns_20260515_1_learning',
            date: '2026-05-15',
            time: '09:00',
            title: 'Learning Readyの投稿',
            status: 'learning_ready',
            account_handle: '@AIBizNavigator',
            lane: 'learn_in_public',
            body: '学習候補化する投稿',
            source: { type: 'Personal KG' },
            evidence: {
                persona_brain: { target_person: 'AI導入を任されたPM' },
                graph_check: { status: 'ok' },
                quality_gate: { status: 'pass' },
                reader_affect: '学習に戻せる'
            },
            revisions: []
        },
        {
            id: 'sns_20260515_2_deleted',
            date: '2026-05-15',
            time: '12:00',
            title: '削除済みの投稿',
            status: 'deleted',
            account_handle: '@AIBizNavigator',
            lane: 'learn_in_public',
            body: '削除済みの投稿を学習対象から外す',
            posted_url: 'https://x.com/AIBizNavigator/status/2055000000000000001',
            deleted_at: '2026-05-15T03:00:00.000Z',
            deletion_source: 'manual_x_delete',
            deletion_reason: 'X上で削除した',
            source: { type: 'Personal KG' },
            evidence: {
                persona_brain: { target_person: 'AI導入を任されたPM' },
                graph_check: { status: 'ok' },
                quality_gate: { status: 'pass' },
                reader_affect: '削除判断を次に活かせる'
            },
            revisions: []
        }
    ];
    const accounts = [
        {
            id: 'acc_x_sato',
            service: 'x',
            display_name: 'Keigo Sato X',
            external_handle: '@AIBizNavigator',
            status: 'connected',
            capabilities: ['post', 'read'],
            credential_ref: {
                provider: 'env',
                path: 'SNS_X_ACCESS_TOKEN',
                env: 'SNS_X_ACCESS_TOKEN',
                env_present: true
            },
            defaults: { sns_posting: true, sns_metrics: true }
        }
    ];

    beforeEach(() => {
        document.body.innerHTML = '<main id="root"></main>';
        container = document.getElementById('root');
        vi.restoreAllMocks();
        vi.useRealTimers();
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    });

    it('Brainbase loop navigation and Ship Calendar surface are rendered', () => {
        const view = new SnsGrowthCockpitView({ posts, today: '2026-05-13' });
        view.mount(container);

        expect(container.textContent).toContain('今日');
        expect(container.textContent).toContain('脳');
        expect(container.textContent).toContain('作る');
        expect(container.textContent).toContain('動かす');
        expect(container.textContent).toContain('学ぶ');
        expect(container.querySelector('.sns-growth-brand')?.getAttribute('href')).toBe('/');
        expect(container.querySelector('[data-nav-item="sns-growth"]')?.classList.contains('active')).toBe(true);
        expect(container.querySelector('.sns-growth-calendar-grid')).toBeTruthy();
        expect(container.textContent).toContain('SNS Posting Ledgerから');
    });

    it('INV-1: mobile decision inbox renders before the weekly calendar surface', () => {
        const view = new SnsGrowthCockpitView({ posts, today: '2026-05-13' });
        view.mount(container);

        const inbox = container.querySelector('.sns-mobile-review-flow');
        const calendar = container.querySelector('.sns-growth-calendar-grid');

        expect(inbox).toBeTruthy();
        expect(inbox.compareDocumentPosition(calendar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(inbox?.textContent).toContain('今日のSNS判断');
        expect(inbox?.textContent).toContain('レビュー');
        expect(inbox?.textContent).toContain('予約済み');
        expect(inbox?.textContent).toContain('投稿済み');
        expect(container.querySelectorAll('.sns-mobile-decision-card').length).toBeGreaterThan(0);
    });

    it('status summary cards and post status badges match the Ship Calendar contract', () => {
        const view = new SnsGrowthCockpitView({ posts, today: '2026-05-13' });
        view.mount(container);

        expect(container.querySelector('[data-summary-status="review_needed"]')?.textContent).toContain('2');
        expect(container.querySelector('[data-summary-status="scheduled"]')?.textContent).toContain('1');
        expect(container.querySelector('[data-summary-status="posted"]')?.textContent).toContain('1');
        expect(container.querySelector('[data-summary-status="learning_ready"]')?.textContent).toContain('1');
        expect(container.querySelector('[data-summary-status="deleted"]')?.textContent).toContain('1');
        expect(container.querySelector('.sns-status-chip.status-review-needed')).toBeTruthy();
        expect(container.querySelector('.sns-status-chip.status-scheduled')).toBeTruthy();
        expect(container.querySelector('.sns-status-chip.status-posted')).toBeTruthy();
        expect(container.querySelector('.sns-status-chip.status-learning-ready')).toBeTruthy();
        expect(container.querySelector('.sns-status-chip.status-deleted')).toBeTruthy();
    });

    it('selected post detail panel shows editable operational fields and collapsed evidence rows', () => {
        const view = new SnsGrowthCockpitView({ posts, today: '2026-05-13' });
        view.mount(container);

        expect(container.textContent).toContain('ポストの詳細');
        expect(container.textContent).toContain('sns_20260513_1_trust_balance');
        expect(container.querySelector('[data-detail-field="body"]')?.textContent).toContain('情報の流れ');
        expect(container.textContent).toContain('スケジュール日時');
        expect(container.textContent).toContain('承認する');
        expect(container.textContent).toContain('Persona Brain');
        expect(container.textContent).toContain('Graph Check');
        expect(container.textContent).toContain('Quality Gate');
        expect(container.textContent).toContain('Reader affect');
        expect(container.textContent).toContain('Algorithm Fit');
        expect(container.textContent).toContain('bookmark, profile_click, dwell');
        expect(container.querySelectorAll('.sns-evidence-row')).toHaveLength(5);
    });

    it('clicking a calendar post updates the selected detail panel', () => {
        const view = new SnsGrowthCockpitView({ posts, today: '2026-05-13' });
        view.mount(container);

        container.querySelector('[data-post-id="sns_20260514_1_scheduled"]')?.click();

        expect(container.querySelector('.sns-calendar-post.selected')?.getAttribute('data-post-id')).toBe('sns_20260514_1_scheduled');
        expect(container.textContent).toContain('良い情報設計とは');
        expect(container.textContent).toContain('sns_20260514_1_scheduled');
    });

    it('S-2: clicking a mobile decision card updates the selected detail panel', () => {
        const view = new SnsGrowthCockpitView({ posts, today: '2026-05-13' });
        view.mount(container);

        container.querySelector('[data-post-id="sns_20260513_2_peer"]')?.click();

        expect(container.querySelector('.sns-mobile-decision-card.selected')?.getAttribute('data-post-id')).toBe('sns_20260513_2_peer');
        expect(container.querySelector('.sns-calendar-post.selected')?.getAttribute('data-post-id')).toBe('sns_20260513_2_peer');
        expect(container.textContent).toContain('プロジェクトの成功率を上げる');
        expect(container.textContent).toContain('sns_20260513_2_peer');
    });

    it('loads posts from the SNS Posting Ledger API when no fixture is injected', async () => {
        const apiClient = {
            listPosts: async ({ startDate, endDate }) => ({
                range: { startDate, endDate },
                posts: [posts[0]],
                summary: { by_status: { review_needed: 1 } }
            }),
            listAccounts: async () => ({ accounts }),
            updatePost: async () => ({ post: posts[0] })
        };
        const view = new SnsGrowthCockpitView({ apiClient, today: '2026-05-13' });
        view.mount(container);
        await Promise.resolve();
        await Promise.resolve();

        expect(container.textContent).toContain('生産性を最大化する情報の流れ設計');
        expect(container.textContent).toContain('SNS Posting Ledgerから1件を表示中');
        expect(container.textContent).toContain('@AIBizNavigator');
        expect(container.textContent).toContain('env ready');
    });

    it('auto-refreshes posts from the SNS Posting Ledger while the page stays mounted', async () => {
        vi.useFakeTimers();
        const refreshedPost = {
            ...posts[1],
            id: 'sns_20260513_3_ohayo_imported',
            title: 'ohayoで追加された投稿',
            body: 'ohayoで作った投稿候補をハードリフレッシュなしで表示する'
        };
        let calls = 0;
        const apiClient = {
            listPosts: async () => {
                calls += 1;
                return { posts: calls === 1 ? [posts[0]] : [posts[0], refreshedPost] };
            },
            listAccounts: async () => ({ accounts }),
            updatePost: async () => ({ post: posts[0] })
        };
        const view = new SnsGrowthCockpitView({ apiClient, today: '2026-05-13', autoRefreshIntervalMs: 50 });
        view.mount(container);
        await Promise.resolve();
        await Promise.resolve();

        expect(container.textContent).toContain('生産性を最大化する情報の流れ設計');
        expect(container.textContent).not.toContain('ohayoで追加された投稿');

        await vi.advanceTimersByTimeAsync(50);
        await Promise.resolve();

        expect(calls).toBeGreaterThanOrEqual(2);
        expect(container.textContent).toContain('ohayoで追加された投稿');
        expect(container.textContent).toContain('SNS Posting Ledgerから2件を表示中');
        view.unmount();
    });

    it('skips auto-refresh while a detail field is being edited', async () => {
        const refreshedPost = {
            ...posts[0],
            body: 'サーバー側で更新された本文'
        };
        let calls = 0;
        const apiClient = {
            listPosts: async () => {
                calls += 1;
                return { posts: calls === 1 ? [posts[0]] : [refreshedPost] };
            },
            listAccounts: async () => ({ accounts }),
            updatePost: async () => ({ post: posts[0] })
        };
        const view = new SnsGrowthCockpitView({ apiClient, today: '2026-05-13', autoRefreshIntervalMs: 0 });
        view.mount(container);
        await Promise.resolve();
        await Promise.resolve();

        const bodyField = container.querySelector('[data-detail-field="body"]');
        bodyField.focus();
        bodyField.value = '編集中の未保存本文';
        await view._refreshFromExternalChange('test');

        expect(calls).toBe(1);
        expect(container.querySelector('[data-detail-field="body"]').value).toBe('編集中の未保存本文');
        expect(container.textContent).not.toContain('サーバー側で更新された本文');
    });

    it('cleans up SNS Ledger auto-refresh listeners on unmount', async () => {
        vi.useFakeTimers();
        let calls = 0;
        const apiClient = {
            listPosts: async () => {
                calls += 1;
                return { posts: [posts[0]] };
            },
            listAccounts: async () => ({ accounts }),
            updatePost: async () => ({ post: posts[0] })
        };
        const view = new SnsGrowthCockpitView({ apiClient, today: '2026-05-13', autoRefreshIntervalMs: 50 });
        view.mount(container);
        await Promise.resolve();
        await Promise.resolve();
        expect(calls).toBe(1);

        view.unmount();
        await vi.advanceTimersByTimeAsync(100);
        window.dispatchEvent(new Event('focus'));
        await Promise.resolve();

        expect(calls).toBe(1);
    });

    it('renders account management status without leaking credential secrets', async () => {
        const apiClient = {
            listPosts: async () => ({ posts: [posts[0]] }),
            listAccounts: async () => ({
                accounts: [{
                    ...accounts[0],
                    credential_ref: {
                        provider: 'env',
                        path: 'SNS_X_ACCESS_TOKEN',
                        env: 'SNS_X_ACCESS_TOKEN',
                        env_present: true
                    }
                }]
            }),
            updatePost: async () => ({ post: posts[0] })
        };
        const view = new SnsGrowthCockpitView({ apiClient, today: '2026-05-13' });
        view.mount(container);
        await Promise.resolve();
        await Promise.resolve();

        expect(container.querySelector('.sns-account-strip')).toBeTruthy();
        expect(container.textContent).toContain('X Account');
        expect(container.textContent).toContain('connected');
        expect(container.textContent).toContain('Posting default');
        expect(container.textContent).toContain('Metrics default');
        expect(container.textContent).toContain('SNS_X_ACCESS_TOKEN');
        expect(container.textContent).not.toContain('secret-token');
    });

    it('runs an X account health check from the account strip', async () => {
        const calls = [];
        const apiClient = {
            listPosts: async () => ({ posts: [posts[0]] }),
            listAccounts: async () => ({ accounts }),
            healthCheckAccount: async (id) => {
                calls.push(id);
                return {
                    account: accounts[0],
                    health: {
                        ok: true,
                        reason: null,
                        rate_limit: { remaining: 299, resetAt: '2026-05-15T12:15:00.000Z' }
                    }
                };
            },
            updatePost: async () => ({ post: posts[0] })
        };
        const view = new SnsGrowthCockpitView({ apiClient, today: '2026-05-13' });
        view.mount(container);
        await Promise.resolve();
        await Promise.resolve();

        container.querySelector('[data-account-action="health-check"]')?.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(calls).toEqual(['acc_x_sato']);
        expect(container.textContent).toContain('Health OK');
        expect(container.textContent).toContain('299 left');
    });

    it('updates the selected post through the SNS Posting Ledger API', async () => {
        const calls = [];
        const apiClient = {
            listPosts: async () => ({ posts }),
            updatePost: async (id, patch) => {
                calls.push({ id, patch });
                return { post: { ...posts[0], ...patch, status: 'approved', revisions: [{ id: 'rev_1' }] } };
            }
        };
        const view = new SnsGrowthCockpitView({ posts: [posts[0]], apiClient, today: '2026-05-13' });
        view.mount(container);

        container.querySelector('[data-detail-field="body"]').value = '会社で使うAIは、レビュー境界まで含めて設計する';
        container.querySelector('[data-sns-action="approve"]')?.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(calls[0].id).toBe('sns_20260513_1_trust_balance');
        expect(calls[0].patch.status).toBe('approved');
        expect(calls[0].patch.body).toContain('レビュー境界');
        expect(container.textContent).toContain('approved');
        expect(container.textContent).toContain('承認しました');
        expect(container.querySelector('[data-sns-action="approve"]')).toBeNull();
        expect(container.querySelector('[data-sns-action="schedule"]')).toBeTruthy();
    });

    it('publishes an approved post through the SNS publish bridge only after browser confirmation', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const calls = [];
        const approvedPost = { ...posts[0], status: 'approved' };
        const apiClient = {
            listPosts: async () => ({ posts: [approvedPost] }),
            updatePost: async () => ({ post: approvedPost }),
            publishPost: async (id, input) => {
                calls.push({ id, input });
                return {
                    post: {
                        ...approvedPost,
                        status: 'posted',
                        posted_url: 'https://x.com/i/web/status/2055000000000000001'
                    },
                    publish_result: { url: 'https://x.com/i/web/status/2055000000000000001' }
                };
            }
        };
        const view = new SnsGrowthCockpitView({ posts: [approvedPost], apiClient, today: '2026-05-13' });
        view.mount(container);

        container.querySelector('[data-sns-action="publish"]')?.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(window.confirm).toHaveBeenCalled();
        expect(calls[0]).toEqual({
            id: approvedPost.id,
            input: { dry_run: false, confirm_public_post: true }
        });
        expect(container.textContent).toContain('posted');
        expect(container.textContent).toContain('https://x.com/i/web/status/2055000000000000001');
    });

    it('marks a posted post as deleted only after confirmation and keeps the X URL visible', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const calls = [];
        const postedPost = {
            ...posts[3],
            posted_url: 'https://x.com/AIBizNavigator/status/2055000000000000001',
            posted_at: '2026-05-14T03:00:00.000Z'
        };
        const apiClient = {
            listPosts: async () => ({ posts: [postedPost] }),
            updatePost: async (id, patch) => {
                calls.push({ id, patch });
                return {
                    post: {
                        ...postedPost,
                        ...patch,
                        status: 'deleted',
                        deletion_source: 'manual_x_delete',
                        deletion_reason: patch.deletion_reason
                    }
                };
            },
            publishPost: async () => ({ post: postedPost })
        };
        const view = new SnsGrowthCockpitView({ posts: [postedPost], apiClient, today: '2026-05-14' });
        view.mount(container);

        container.querySelector('[data-detail-field="memo"]').value = 'X上で削除した';
        container.querySelector('[data-sns-action="mark-deleted"]')?.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(window.confirm).toHaveBeenCalled();
        expect(calls[0].id).toBe(postedPost.id);
        expect(calls[0].patch).toMatchObject({
            status: 'deleted',
            deletion_source: 'manual_x_delete',
            deletion_reason: 'X上で削除した'
        });
        expect(calls[0].patch.deleted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
        expect(container.textContent).toContain('deleted');
        expect(container.textContent).toContain('https://x.com/AIBizNavigator/status/2055000000000000001');
        expect(container.textContent).toContain('X上で削除した');
    });

    it('does not render mutation actions for a terminal deleted post', () => {
        const deletedPost = posts.find((post) => post.status === 'deleted');
        const view = new SnsGrowthCockpitView({ posts: [deletedPost], today: '2026-05-15' });
        view.mount(container);

        expect(container.textContent).toContain('削除記録');
        expect(container.querySelector('[data-sns-action="approve"]')).toBeNull();
        expect(container.querySelector('[data-sns-action="schedule"]')).toBeNull();
        expect(container.querySelector('[data-sns-action="publish"]')).toBeNull();
        expect(container.querySelector('[data-sns-action="mark-deleted"]')).toBeNull();
        expect(container.querySelector('[data-sns-action="skip"]')).toBeNull();
    });

    it('records posted metrics and marks the selected post learning_ready from the detail panel', async () => {
        const calls = [];
        const postedPost = {
            ...posts[3],
            posted_url: 'https://x.com/AIBizNavigator/status/2055000000000000001',
            posted_at: '2026-05-14T03:00:00.000Z'
        };
        const apiClient = {
            listPosts: async () => ({ posts: [postedPost] }),
            updatePost: async () => ({ post: postedPost }),
            recordFeedback: async (id, input) => {
                calls.push({ id, input });
                return {
                    post: {
                        ...postedPost,
                        status: 'learning_ready',
                        metrics_snapshots: [{
                            ...input.metrics_snapshot,
                            captured_at: '2026-05-14T12:00:00.000Z'
                        }]
                    }
                };
            }
        };
        const view = new SnsGrowthCockpitView({ posts: [postedPost], apiClient, today: '2026-05-14' });
        view.mount(container);

        container.querySelector('[data-detail-field="metric-impressions"]').value = '1280';
        container.querySelector('[data-detail-field="metric-likes"]').value = '84';
        container.querySelector('[data-detail-field="metric-reposts"]').value = '9';
        container.querySelector('[data-detail-field="metric-replies"]').value = '18';
        container.querySelector('[data-detail-field="metric-bookmarks"]').value = '21';
        container.querySelector('[data-sns-action="mark-learning-ready"]')?.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(calls[0]).toEqual({
            id: postedPost.id,
            input: {
                metrics_snapshot: {
                    impressions: 1280,
                    likes: 84,
                    reposts: 9,
                    replies: 18,
                    bookmarks: 21
                },
                mark_learning_ready: true
            }
        });
        expect(container.textContent).toContain('learning_ready');
        expect(container.textContent).toContain('1,280 impressions');
        expect(container.textContent).toContain('学習準備にしました');
    });

    it('shows latest polled metrics timestamp and anomaly warning in the detail panel', () => {
        const learningPost = {
            ...posts[3],
            status: 'learning_ready',
            posted_url: 'https://x.com/AIBizNavigator/status/2055000000000000001',
            metrics_snapshots: [{
                impressions: 2000,
                likes: 40,
                reposts: 3,
                replies: 260,
                bookmarks: 5,
                captured_at: '2026-05-15T12:00:00.000Z',
                anomaly: {
                    kind: 'reply_impression_ratio',
                    reason: 'reply-impression-ratio:0.130'
                }
            }]
        };
        const view = new SnsGrowthCockpitView({ posts: [learningPost], today: '2026-05-15' });
        view.mount(container);

        expect(container.textContent).toContain('2,000 impressions');
        expect(container.textContent).toContain('最終取得 2026-05-15T12:00:00.000Z');
        expect(container.textContent).toContain('炎上候補');
        expect(container.textContent).toContain('reply-impression-ratio:0.130');
    });
});
