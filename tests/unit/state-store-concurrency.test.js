/**
 * StateStore - Concurrency Test
 * ファイル競合・外部編集検知・リロード機構のunit test
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StateStore } from '../../lib/state-store.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

async function closeWatcher(watcher) {
    if (!watcher) return;

    await Promise.race([
        watcher.close(),
        new Promise((resolve) => setTimeout(resolve, 1000))
    ]);
}

async function cleanupTempDir(tempDir) {
    if (!tempDir) return;

    await Promise.race([
        fs.rm(tempDir, { recursive: true, force: true }),
        new Promise((resolve) => setTimeout(resolve, 1000))
    ]);
}

describe('StateStore - Concurrency', () => {
    let stateStore;
    let tempDir;
    let stateFilePath;

    beforeEach(async () => {
        // 一時ディレクトリ作成
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'state-store-test-'));
        stateFilePath = path.join(tempDir, 'state.json');

        // StateStore初期化
        stateStore = new StateStore(stateFilePath, '/test/workspace');
        await stateStore.init();
    });

    afterEach(async () => {
        // watcher停止
        await closeWatcher(stateStore._watcher);

        // 一時ディレクトリ削除
        await cleanupTempDir(tempDir);
    });

    describe('外部編集検知', () => {
        it('外部編集を検知してリロードする', async () => {
            // 初回persist
            await stateStore.persist();

            // 外部編集をシミュレート（ファイルを直接書き換え）
            const externalState = {
                ...stateStore.state,
                sessions: [
                    { id: 'external-session', name: 'External Session', path: '/external' }
                ]
            };
            await fs.writeFile(stateFilePath, JSON.stringify(externalState, null, 2));

            // chokidarのawaitWriteFinishを待つ
            await new Promise(resolve => setTimeout(resolve, 200));

            // リロードされたことを確認
            expect(stateStore.state.sessions).toHaveLength(1);
            expect(stateStore.state.sessions[0].id).toBe('external-session');
        });

        it('リロード中は重複リロードしない', async () => {
            const reloadSpy = vi.spyOn(stateStore, '_reloadFromFile');

            // 複数回の外部編集をシミュレート
            await stateStore.persist();
            stateStore._isReloading = true; // リロード中フラグを立てる

            await fs.writeFile(stateFilePath, JSON.stringify(stateStore.state, null, 2));
            await new Promise(resolve => setTimeout(resolve, 200));

            // リロードが呼ばれないことを確認
            expect(reloadSpy).not.toHaveBeenCalled();

            stateStore._isReloading = false;
            reloadSpy.mockRestore();
        });
    });

    describe('persist()の競合検出', () => {
        it('persist()中に外部編集があった場合、エラーを投げる', async () => {
            // 初回persist
            await stateStore.persist();

            // 外部編集をシミュレート（mtimeを変更）
            await fs.writeFile(stateFilePath, JSON.stringify(stateStore.state, null, 2));
            await new Promise(resolve => setTimeout(resolve, 100));

            // persist()を実行（競合検出されるべき）
            await expect(stateStore.persist()).rejects.toThrow('State conflict detected');
        });

        it('競合なしの場合はpersist()が成功する', async () => {
            // 初回persist
            await stateStore.persist();

            // 状態変更
            stateStore.state.sessions.push({
                id: 'new-session',
                name: 'New Session',
                path: '/new'
            });

            // persist()を実行（競合なし）
            await expect(stateStore.persist()).resolves.not.toThrow();

            // ファイルに書き込まれたことを確認
            const content = await fs.readFile(stateFilePath, 'utf-8');
            const parsed = JSON.parse(content);
            expect(parsed.sessions).toHaveLength(2);
        });

        it('ファイルが存在しない場合はpersist()が成功する', async () => {
            // beforeEachのwatcherを先に閉じる（ファイル操作の干渉防止）
            await closeWatcher(stateStore._watcher);

            // state.jsonを削除
            await fs.rm(stateFilePath, { force: true });

            // persist()を実行（新規作成）
            await expect(stateStore.persist()).resolves.not.toThrow();

            // ファイルが作成されたことを確認
            const exists = await fs.access(stateFilePath).then(() => true).catch(() => false);
            expect(exists).toBe(true);
        });
    });

    describe('リロード機構', () => {
        it('_reloadFromFile()で有効な状態をリロードする', async () => {
            // 外部から有効な状態を書き込み
            const externalState = {
                schemaVersion: 2,
                sessions: [
                    { id: 'external-1', name: 'External 1', path: '/external1' },
                    { id: 'external-2', name: 'External 2', path: '/external2' }
                ]
            };
            await fs.writeFile(stateFilePath, JSON.stringify(externalState, null, 2));

            // リロード実行
            await stateStore._reloadFromFile();

            // 状態がリロードされたことを確認
            expect(stateStore.state.sessions).toHaveLength(2);
            expect(stateStore.state.sessions[0].id).toBe('external-1');
        });

        it('_reloadFromFile()で無効な状態は無視する', async () => {
            // 初期状態を保存
            const initialSessions = [...stateStore.state.sessions];

            // 外部から無効な状態を書き込み（sessionsが空）
            const invalidState = {
                schemaVersion: 2,
                sessions: []
            };
            await fs.writeFile(stateFilePath, JSON.stringify(invalidState, null, 2));

            // リロード実行
            await stateStore._reloadFromFile();

            // 状態が変更されていないことを確認
            expect(stateStore.state.sessions).toEqual(initialSessions);
        });

        it('_reloadFromFile()でJSONパースエラーは無視する', async () => {
            // 初期状態を保存
            const initialSessions = [...stateStore.state.sessions];

            // 外部から壊れたJSONを書き込み
            await fs.writeFile(stateFilePath, '{ invalid json }');

            // リロード実行（エラーが投げられないことを確認）
            await expect(stateStore._reloadFromFile()).resolves.not.toThrow();

            // 状態が変更されていないことを確認
            expect(stateStore.state.sessions).toEqual(initialSessions);
        });
    });

    describe('mtimeトラッキング', () => {
        it('init()で初回のmtimeを記録する', async () => {
            // 新しいStateStoreを作成
            const newStateStore = new StateStore(stateFilePath, '/test/workspace');
            await newStateStore.init();

            // mtimeが記録されたことを確認
            expect(newStateStore._mtime).not.toBeNull();
            expect(typeof newStateStore._mtime).toBe('number');

            await closeWatcher(newStateStore._watcher);
        });

        it('persist()後にmtimeを更新する', async () => {
            await stateStore.persist();
            const mtimeBefore = stateStore._mtime;

            // 状態変更
            stateStore.state.sessions.push({
                id: 'new-session',
                name: 'New Session',
                path: '/new'
            });

            await new Promise(resolve => setTimeout(resolve, 10)); // mtimeが変わるのを待つ

            // persist()を実行
            await stateStore.persist();
            const mtimeAfter = stateStore._mtime;

            // mtimeが更新されたことを確認
            expect(mtimeAfter).toBeGreaterThan(mtimeBefore);
        });
    });

    describe('バックアップチェーン', () => {
        it('primary state.jsonが存在する場合、それを使用する', async () => {
            // state.jsonを作成（brainbaseも含める）
            const primaryState = {
                schemaVersion: 3,
                sessions: [
                    { id: 'brainbase', name: 'brainbase', path: '/test/workspace' },
                    { id: 'primary-session', name: 'Primary', path: '/primary' }
                ]
            };
            await fs.writeFile(stateFilePath, JSON.stringify(primaryState, null, 2));

            // 新しいStateStoreを作成
            const newStateStore = new StateStore(stateFilePath, '/test/workspace');
            await newStateStore.init();

            // primaryから読み込まれたことを確認
            expect(newStateStore.state.sessions).toHaveLength(2);
            expect(newStateStore.state.sessions[1].id).toBe('primary-session');

            await closeWatcher(newStateStore._watcher);
        });

        it('primaryが存在しない場合、.bakから復旧する', async () => {
            // beforeEachのwatcherを先に閉じる（ファイル操作の干渉防止）
            await closeWatcher(stateStore._watcher);

            // state.jsonを削除（存在しない状態）
            await fs.rm(stateFilePath, { force: true });

            // state.json.bakを作成（brainbaseも含める）
            const bakState = {
                schemaVersion: 3,
                sessions: [
                    { id: 'brainbase', name: 'brainbase', path: '/test/workspace' },
                    { id: 'backup-session', name: 'Backup', path: '/backup' }
                ]
            };
            await fs.writeFile(stateFilePath + '.bak', JSON.stringify(bakState, null, 2));

            // 新しいStateStoreを作成
            const newStateStore = new StateStore(stateFilePath, '/test/workspace');
            await newStateStore.init();

            // .bakから復旧されたことを確認
            expect(newStateStore.state.sessions).toHaveLength(2);
            expect(newStateStore.state.sessions[1].id).toBe('backup-session');

            await closeWatcher(newStateStore._watcher);
        });

        it('primaryと.bakが存在しない場合、.cleanから復旧する', async () => {
            // beforeEachのwatcherを先に閉じる（ファイル操作の干渉防止）
            await closeWatcher(stateStore._watcher);

            // state.jsonと.bakを削除
            await fs.rm(stateFilePath, { force: true });
            await fs.rm(stateFilePath + '.bak', { force: true });

            // state.json.cleanを作成（brainbaseも含める）
            const cleanState = {
                schemaVersion: 3,
                sessions: [
                    { id: 'brainbase', name: 'brainbase', path: '/test/workspace' },
                    { id: 'clean-session-1', name: 'Clean 1', path: '/clean1' },
                    { id: 'clean-session-2', name: 'Clean 2', path: '/clean2' }
                ]
            };
            await fs.writeFile(stateFilePath + '.clean', JSON.stringify(cleanState, null, 2));

            // 新しいStateStoreを作成
            const newStateStore = new StateStore(stateFilePath, '/test/workspace');
            await newStateStore.init();

            // .cleanから復旧されたことを確認
            expect(newStateStore.state.sessions).toHaveLength(3);
            expect(newStateStore.state.sessions[1].id).toBe('clean-session-1');
            expect(newStateStore.state.sessions[2].id).toBe('clean-session-2');

            await closeWatcher(newStateStore._watcher);
        });

        it('全てのバックアップが存在しない場合、デフォルトstateを使用する', async () => {
            // beforeEachのwatcherを先に閉じる（ファイル操作の干渉防止）
            await closeWatcher(stateStore._watcher);

            // 全てのバックアップを削除
            await fs.rm(stateFilePath, { force: true });
            await fs.rm(stateFilePath + '.bak', { force: true });
            await fs.rm(stateFilePath + '.clean', { force: true });

            // 新しいStateStoreを作成
            const newStateStore = new StateStore(stateFilePath, '/test/workspace');
            await newStateStore.init();

            // デフォルトstate（brainbaseセッション）が使用されたことを確認
            expect(newStateStore.state.sessions).toHaveLength(1);
            expect(newStateStore.state.sessions[0].id).toBe('brainbase');

            await newStateStore._watcher.close();
        });
    });
});
