import { describe, expect, it } from 'vitest';
import {
    buildAdjacentContinuationSegments,
    buildFileLinksForBufferLine,
    buildFileLinksForWrappedLine,
    expandWrappedLinkSegments,
    extractFileMatches,
    pickBestLinkAtPosition
} from '../../public/modules/xterm-file-links.js';

describe('iframe-contextmenu-handler', () => {
    it('相対パスの後ろに矢印や説明が続いてもファイルリンクを抽出する', () => {
        expect(extractFileMatches('public/app.js:1568->コレに関しては下線がでない')).toEqual([
            { path: 'public/app.js', line: '1568', start: 0, end: 18 }
        ]);
    });

    it('絶対パスの後ろに矢印や説明が続いても長い拡張子を正しく抽出する', () => {
        expect(extractFileMatches('/Users/ksato/workspace/code/brainbase/public/index.html->コレをクリック')).toEqual([
            {
                path: '/Users/ksato/workspace/code/brainbase/public/index.html',
                line: null,
                start: 0,
                end: 55
            }
        ]);
    });

    it('折り返しで空白が混ざった absolute path continuation も1本のパスとして抽出する', () => {
        expect(extractFileMatches('/Users/ksato/workspace/code/brainbase/p  ublic/index.html')).toEqual([
            {
                path: '/Users/ksato/workspace/code/brainbase/public/index.html',
                line: null,
                start: 0,
                end: 57
            }
        ]);
    });

    it('日本語句読点の直後でもファイルリンクを抽出する', () => {
        expect(extractFileMatches('て、public/app.js:1568 が link として出るかを見る')).toEqual([
            { path: 'public/app.js', line: '1568', start: 2, end: 20 }
        ]);
    });

    it('フルパスも抽出する', () => {
        expect(extractFileMatches('/Users/ksato/workspace/code/brainbase/public/app.js:1568')).toEqual([
            {
                path: '/Users/ksato/workspace/code/brainbase/public/app.js',
                line: '1568',
                start: 0,
                end: 56
            }
        ]);
    });

    it('ファイル名の直後に識別子が続く場合は誤検出しない', () => {
        expect(extractFileMatches('public/app.jsExtra')).toEqual([]);
    });

    it('xterm link range は exact な buffer line 番号を使う', () => {
        expect(buildFileLinksForBufferLine('public/app.js:1568', 42)).toEqual([
            expect.objectContaining({
                range: {
                    start: { x: 1, y: 42 },
                    end: { x: 18, y: 42 }
                },
                text: 'public/app.js:1568'
            })
        ]);
    });

    it('全角文字が先頭にあっても xterm link range をセル幅で計算する', () => {
        expect(buildFileLinksForBufferLine('日本語 public/app.js:1568', 9)).toEqual([
            expect.objectContaining({
                range: {
                    start: { x: 8, y: 9 },
                    end: { x: 25, y: 9 }
                },
                text: 'public/app.js:1568'
            })
        ]);
    });

    it('右端で折り返すファイルリンクを複数行 range として扱う', () => {
        expect(buildFileLinksForWrappedLine('public/app.js:1568', 5, 10)).toEqual([
            expect.objectContaining({
                range: {
                    start: { x: 1, y: 5 },
                    end: { x: 8, y: 6 }
                },
                text: 'public/app.js:1568'
            })
        ]);
    });

    it('折り返しリンクを各 visual row の hover range に分割する', () => {
        const [link] = buildFileLinksForWrappedLine('public/app.js:1568', 5, 10);
        expect(expandWrappedLinkSegments(link, 10)).toEqual([
            expect.objectContaining({
                text: 'public/app',
                range: {
                    start: { x: 1, y: 5 },
                    end: { x: 10, y: 5 }
                }
            }),
            expect.objectContaining({
                text: '.js:1568',
                range: {
                    start: { x: 1, y: 6 },
                    end: { x: 8, y: 6 }
                }
            })
        ]);
    });

    it('折り返した絶対パスの2行目 segment も hover 対象に分割する', () => {
        const [link] = buildFileLinksForWrappedLine(
            'WRAP /Users/ksato/workspace/code/brainbase/public/index.html->コレをクリック',
            12,
            40
        );
        expect(expandWrappedLinkSegments(link, 40)).toEqual([
            expect.objectContaining({
                range: {
                    start: { x: 6, y: 12 },
                    end: { x: 40, y: 12 }
                }
            }),
            expect.objectContaining({
                text: 'se/public/index.html',
                range: {
                    start: { x: 1, y: 13 },
                    end: { x: 20, y: 13 }
                }
            })
        ]);
    });

    it('repo名つき path から browser preview target を計算する', () => {
        expect(buildFileLinksForBufferLine(
            'brainbase/scripts/ensure_session_runtime.sh',
            7,
            '/Users/ksato/workspace/code/brainbase'
        )).toEqual([
            expect.objectContaining({
                rawPath: 'brainbase/scripts/ensure_session_runtime.sh',
                previewPath: 'scripts/ensure_session_runtime.sh',
                previewable: true
            })
        ]);
    });

    it('前行と次行に分かれた absolute path continuation を1本の full path として扱う', () => {
        expect(buildAdjacentContinuationSegments(
            'テストは tests/server/controllers/session-controller-file-content.test.js と /Users/ksato/workspace/code/brainbase/tests/unit/',
            '  server-session-controller.test.js で 41/41 pass です。',
            10
        )).toEqual([
            expect.objectContaining({
                rawPath: '/Users/ksato/workspace/code/brainbase/tests/unit/server-session-controller.test.js',
                text: '/Users/ksato/workspace/code/brainbase/tests/unit/',
                range: {
                    start: { x: 78, y: 10 },
                    end: { x: 126, y: 10 }
                }
            }),
            expect.objectContaining({
                rawPath: '/Users/ksato/workspace/code/brainbase/tests/unit/server-session-controller.test.js',
                text: 'server-session-controller.test.js',
                range: {
                    start: { x: 3, y: 11 },
                    end: { x: 35, y: 11 }
                }
            })
        ]);
    });

    it('同じ範囲に fragment と full path がある場合は full path を優先する', () => {
        expect(pickBestLinkAtPosition([
            {
                rawPath: 'server-session-controller.test.js',
                range: {
                    start: { x: 3, y: 11 },
                    end: { x: 35, y: 11 }
                }
            },
            {
                rawPath: '/Users/ksato/workspace/code/brainbase/tests/unit/server-session-controller.test.js',
                range: {
                    start: { x: 3, y: 11 },
                    end: { x: 35, y: 11 }
                }
            }
        ], 11, 10)).toEqual(
            expect.objectContaining({
                rawPath: '/Users/ksato/workspace/code/brainbase/tests/unit/server-session-controller.test.js'
            })
        );
    });
});
