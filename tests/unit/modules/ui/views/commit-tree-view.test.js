/**
 * CommitTreeView Test
 * コミットツリービューの1行表示+色分けテスト
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CommitTreeView } from '../../../../../public/modules/ui/views/commit-tree-view.js';
import { appStore } from '../../../../../public/modules/core/store.js';
import { eventBus, EVENTS } from '../../../../../public/modules/core/event-bus.js';

describe('CommitTreeView', () => {
    let view;
    let mockService;
    let container;

    beforeEach(() => {
        // Mock service
        mockService = {
            loadCommitLog: vi.fn(),
            checkCommitNotify: vi.fn().mockResolvedValue(0)
        };

        // Container
        container = document.createElement('div');
        document.body.appendChild(container);
        const panel = document.createElement('div');
        panel.id = 'commit-tree-panel';
        panel.style.display = 'flex';
        document.body.appendChild(panel);

        view = new CommitTreeView({ commitTreeService: mockService });
        view.mount(container);
    });

    describe('1行表示', () => {
        it('コミット行がflex-direction:rowで横並び表示される', () => {
            // Given: 1コミット
            appStore.setState({
                commitLog: {
                    commits: [{
                        hash: 'abc123',
                        description: 'Test commit',
                        author: 'test@example.com',
                        timestamp: '2026-02-28T10:00:00Z',
                        parents: [],
                        bookmarks: [],
                        isWorkingCopy: false
                    }],
                    repoType: 'jj',
                    repoName: 'test-repo'
                }
            });

            // When: レンダリング
            view.render();

            // Then: commit-rowがflex-direction: rowで表示される（CSSで検証）
            const commitRow = container.querySelector('.commit-row');
            expect(commitRow).not.toBeNull();

            // HTMLが1行構造（span要素のみ、commit-header/meta divなし）
            const header = commitRow.querySelector('.commit-header');
            const meta = commitRow.querySelector('.commit-meta');
            expect(header).toBeNull(); // ❌ commit-headerは削除される
            expect(meta).toBeNull();   // ❌ commit-metaは削除される

            // 各要素がspan（インライン）
            const hash = commitRow.querySelector('.commit-hash');
            const author = commitRow.querySelector('.commit-author');
            const time = commitRow.querySelector('.commit-time');
            const desc = commitRow.querySelector('.commit-desc');

            expect(hash.tagName).toBe('SPAN');
            expect(author.tagName).toBe('SPAN');
            expect(time.tagName).toBe('SPAN');
            expect(desc.tagName).toBe('SPAN');
        });

        it('順序が desc → hash → bookmark → author → time になる', () => {
            // Given: ブックマーク付きコミット
            appStore.setState({
                commitLog: {
                    commits: [{
                        hash: 'abc123',
                        description: 'Test commit',
                        author: 'test@example.com',
                        timestamp: '2026-02-28T10:00:00Z',
                        parents: [],
                        bookmarks: ['main'],
                        isWorkingCopy: false
                    }],
                    repoType: 'jj',
                    repoName: 'test-repo'
                }
            });

            // When: レンダリング
            view.render();

            // Then: 順序が正しい
            const commitRow = container.querySelector('.commit-row');
            const children = Array.from(commitRow.children).filter(el => el.tagName === 'SPAN');

            expect(children[0].className).toContain('commit-desc');
            expect(children[1].className).toContain('commit-hash');
            expect(children[2].className).toContain('commit-bookmark');
            expect(children[3].className).toContain('commit-author');
            expect(children[4].className).toContain('commit-time');
        });
    });

    describe('色分け', () => {
        it('各コミットがレーンの色で表示される', () => {
            // Given: レーン0（青 #4a9eff）のコミット
            appStore.setState({
                commitLog: {
                    commits: [{
                        hash: 'abc123',
                        description: 'Test commit',
                        author: 'test@example.com',
                        timestamp: '2026-02-28T10:00:00Z',
                        parents: [],
                        bookmarks: [],
                        isWorkingCopy: false
                    }],
                    repoType: 'jj',
                    repoName: 'test-repo'
                }
            });

            // When: レンダリング
            view.render();

            // Then: レーン0の色（現在は #7db3ff）が適用される
            const commitRow = container.querySelector('.commit-row');
            const style = commitRow.getAttribute('style');
            expect(style).toContain('color:');
            expect(style).toContain('#7db3ff'); // COLORS[0]
        });

        it('複数レーンのコミットがそれぞれの色で表示される', () => {
            // Given: レーン0（青）とレーン1（赤 #ff6b6b）のコミット
            appStore.setState({
                commitLog: {
                    commits: [
                        {
                            hash: 'commit1',
                            description: 'Commit 1',
                            author: 'author1',
                            timestamp: '2026-02-28T10:00:00Z',
                            parents: ['commit2'],
                            bookmarks: [],
                            isWorkingCopy: false
                        },
                        {
                            hash: 'commit2',
                            description: 'Commit 2',
                            author: 'author2',
                            timestamp: '2026-02-28T09:00:00Z',
                            parents: [],
                            bookmarks: [],
                            isWorkingCopy: false
                        }
                    ],
                    repoType: 'jj',
                    repoName: 'test-repo'
                }
            });

            // When: レンダリング
            view.render();

            // Then: 各コミットに色が設定される
            const rows = container.querySelectorAll('.commit-row');
            expect(rows.length).toBe(2);

            const style0 = rows[0].getAttribute('style');
            expect(style0).toContain('color:');
            expect(style0).toContain('#7db3ff');

            const style1 = rows[1].getAttribute('style');
            expect(style1).toContain('color:');
            expect(style1).toContain('#7db3ff');
        });
    });

    describe('visibility aware loading', () => {
        it('panelが閉じているとき_SESSION_CHANGEDでcommit logを読まない', async () => {
            const panel = document.getElementById('commit-tree-panel');
            panel.style.display = 'none';

            await eventBus.emit(EVENTS.SESSION_CHANGED, { sessionId: 'session-1' });

            expect(mockService.loadCommitLog).not.toHaveBeenCalled();
        });

        it('panel再表示時_pending sessionのcommit logを読む', async () => {
            const panel = document.getElementById('commit-tree-panel');
            panel.style.display = 'none';

            await eventBus.emit(EVENTS.SESSION_CHANGED, { sessionId: 'session-2' });
            panel.style.display = 'flex';
            await eventBus.emit(EVENTS.COMMIT_TREE_PANEL_TOGGLED, { collapsed: false });

            expect(mockService.loadCommitLog).toHaveBeenCalledWith('session-2');
        });
    });
});
