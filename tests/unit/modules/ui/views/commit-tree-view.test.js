/**
 * CommitTreeView Test
 * コミットツリービューの1行表示+色分けテスト
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CommitTreeView } from '../../../../../public/modules/ui/views/commit-tree-view.js';
import { appStore } from '../../../../../public/modules/core/store.js';
import { eventBus } from '../../../../../public/modules/core/event-bus.js';

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

        it('順序が desc(先頭にbookmark) → hash → author → time になる', () => {
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
            expect(children[2].className).toContain('commit-author');
            expect(children[3].className).toContain('commit-time');

            // bookmarkは独立列ではなく、desc内の先頭プレフィックスとして表示
            const desc = children[0];
            const bookmark = desc.querySelector('.commit-bookmark');
            const descText = desc.querySelector('.commit-desc-text');
            expect(bookmark).not.toBeNull();
            expect(descText).not.toBeNull();
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

            // Then: レーン0の色（#4a9eff）が適用される
            const commitRow = container.querySelector('.commit-row');
            const style = commitRow.getAttribute('style');
            expect(style).toContain('color:');
            expect(style).toContain('#4a9eff'); // COLORS[0]
        });

        it('同じレーンのコミットは同じ色で表示される', () => {
            // Given: 直線履歴（同一レーン）2コミット
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

            // Then: 同一レーンなので同じ色
            const rows = container.querySelectorAll('.commit-row');
            expect(rows.length).toBe(2);

            // レーン0（青）
            const style0 = rows[0].getAttribute('style');
            expect(style0).toContain('color:');

            // 同一レーンなので同色
            const style1 = rows[1].getAttribute('style');
            expect(style1).toContain('color:');
            expect(style0).toBe(style1);
        });
    });
});
