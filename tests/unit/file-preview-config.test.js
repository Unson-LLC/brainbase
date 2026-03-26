import { describe, expect, it } from 'vitest';
import { getPathExtension, isBrowserPreviewablePath, resolvePreviewRelativePath } from '../../public/modules/file-preview-config.js';

describe('file-preview-config', () => {
    it('コード系テキストファイルをブラウザ内表示対象にする', () => {
        expect(isBrowserPreviewablePath('public/app.js')).toBe(true);
        expect(isBrowserPreviewablePath('server/routes/sessions.ts')).toBe(true);
        expect(isBrowserPreviewablePath('README.md')).toBe(true);
        expect(isBrowserPreviewablePath('config/settings.yaml')).toBe(true);
    });

    it('バイナリ系や拡張子なしは対象にしない', () => {
        expect(isBrowserPreviewablePath('image.png')).toBe(false);
        expect(isBrowserPreviewablePath('LICENSE')).toBe(false);
    });

    it('クエリやハッシュを除いて拡張子を判定する', () => {
        expect(getPathExtension('public/app.js?line=12')).toBe('.js');
        expect(getPathExtension('docs/README.md#heading')).toBe('.md');
    });

    it('workspace 内の絶対パスを relative に変換する', () => {
        expect(resolvePreviewRelativePath(
            '/Users/ksato/workspace/code/brainbase/public/app.js',
            '/Users/ksato/workspace/code/brainbase'
        )).toBe('public/app.js');
    });

    it('workspace 外の絶対パスは browser preview に流さない', () => {
        expect(resolvePreviewRelativePath(
            '/Users/ksato/workspace/code/other-repo/public/app.js',
            '/Users/ksato/workspace/code/brainbase'
        )).toBeNull();
    });

    it('canonical repo の絶対パスは worktree 相対へ変換する', () => {
        expect(resolvePreviewRelativePath(
            '/Users/ksato/workspace/code/brainbase/public/modules/ui/view-navigation.js',
            '/Volumes/UNSON-DRIVE/brainbase-worktrees/session-1774364870566-brainbase',
            'session-1774364870566'
        )).toBe('public/modules/ui/view-navigation.js');
    });

    it('ホーム相対パスも workspace 内なら relative に変換する', () => {
        expect(resolvePreviewRelativePath(
            '~/workspace/code/brainbase/public/app.js',
            '/Users/ksato/workspace/code/brainbase'
        )).toBe('public/app.js');
    });

    it('repo名つきの workspace 相対パスも relative に変換する', () => {
        expect(resolvePreviewRelativePath(
            'brainbase/scripts/ensure_session_runtime.sh',
            '/Users/ksato/workspace/code/brainbase'
        )).toBe('scripts/ensure_session_runtime.sh');
    });
});
