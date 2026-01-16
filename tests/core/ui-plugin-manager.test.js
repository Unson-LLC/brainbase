import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UIPluginManager, PLUGIN_EVENTS, PLUGIN_LAYERS } from '../../public/modules/core/ui-plugin-manager.js';

describe('UIPluginManager', () => {
    let manager;

    beforeEach(() => {
        manager = new UIPluginManager();
    });

    afterEach(() => {
        // クリーンアップ
        manager = null;
    });

    // ===== Plugin登録 =====

    describe('register()', () => {
        it('register呼び出し時_正常なdescriptor_Pluginが登録される', () => {
            const descriptor = {
                id: 'test-plugin',
                displayName: 'Test Plugin',
                layer: PLUGIN_LAYERS.BUSINESS,
                slots: ['sidebar:test'],
                lifecycle: {
                    load: async () => {},
                    render: async (container) => {},
                    destroy: () => {}
                }
            };

            manager.register(descriptor);

            expect(manager.plugins.has('test-plugin')).toBe(true);
            expect(manager.plugins.get('test-plugin').displayName).toBe('Test Plugin');
        });

        it('register呼び出し時_重複ID_警告が出力される', () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            const descriptor = {
                id: 'test-plugin',
                displayName: 'Test Plugin',
                slots: ['sidebar:test'],
                lifecycle: { render: async () => {} }
            };

            manager.register(descriptor);
            manager.register(descriptor); // 重複登録

            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('already registered'));
            warnSpy.mockRestore();
        });

        it('register呼び出し時_必須フィールド欠落_エラーが投げられる', () => {
            const descriptor = {
                id: 'test-plugin',
                // displayName欠落
                slots: ['sidebar:test'],
                lifecycle: { render: async () => {} }
            };

            expect(() => manager.register(descriptor)).toThrow('missing required fields');
        });

        it('register呼び出し時_lifecycle.render欠落_エラーが投げられる', () => {
            const descriptor = {
                id: 'test-plugin',
                displayName: 'Test Plugin',
                slots: ['sidebar:test'],
                lifecycle: { load: async () => {} } // render欠落
            };

            expect(() => manager.register(descriptor)).toThrow('missing required fields');
        });

        it('register呼び出し時_layerデフォルト_businessが設定される', () => {
            const descriptor = {
                id: 'test-plugin',
                displayName: 'Test Plugin',
                slots: ['sidebar:test'],
                lifecycle: { render: async () => {} }
            };

            manager.register(descriptor);

            expect(manager.plugins.get('test-plugin').layer).toBe(PLUGIN_LAYERS.BUSINESS);
        });

        it('register呼び出し時_priorityデフォルト_100が設定される', () => {
            const descriptor = {
                id: 'test-plugin',
                displayName: 'Test Plugin',
                slots: ['sidebar:test'],
                lifecycle: { render: async () => {} }
            };

            manager.register(descriptor);

            expect(manager.plugins.get('test-plugin').priority).toBe(100);
        });
    });

    // ===== Plugin有効/無効判定 =====

    describe('isEnabled()', () => {
        it('isEnabled呼び出し時_configロード前_未登録Pluginはfalse', () => {
            expect(manager.isEnabled('unknown-plugin')).toBe(false);
        });

        it('isEnabled呼び出し時_登録済みPlugin_configロード前はtrue（Fallback）', () => {
            manager.register({
                id: 'test-plugin',
                displayName: 'Test Plugin',
                slots: ['sidebar:test'],
                lifecycle: { render: async () => {} }
            });

            // configロード前はFallbackとして有効扱い
            expect(manager.isEnabled('test-plugin')).toBe(true);
        });

        it('isEnabled呼び出し時_enabledPluginsに含まれる_trueを返す', () => {
            manager.register({
                id: 'test-plugin',
                displayName: 'Test Plugin',
                slots: ['sidebar:test'],
                lifecycle: { render: async () => {} }
            });

            manager.enabledPlugins.add('test-plugin');
            manager._configLoaded = true;

            expect(manager.isEnabled('test-plugin')).toBe(true);
        });
    });

    // ===== スロットからPlugin取得 =====

    describe('getPluginsForSlot()', () => {
        it('getPluginsForSlot呼び出し時_該当Plugin_配列で返される', () => {
            manager.register({
                id: 'plugin-a',
                displayName: 'Plugin A',
                slots: ['sidebar:test'],
                priority: 10,
                lifecycle: { render: async () => {} }
            });

            manager.register({
                id: 'plugin-b',
                displayName: 'Plugin B',
                slots: ['sidebar:test'],
                priority: 20,
                lifecycle: { render: async () => {} }
            });

            manager.enabledPlugins.add('plugin-a');
            manager.enabledPlugins.add('plugin-b');
            manager._configLoaded = true;

            const plugins = manager.getPluginsForSlot('sidebar:test');

            expect(plugins).toHaveLength(2);
            // priority順にソートされる
            expect(plugins[0].id).toBe('plugin-a');
            expect(plugins[1].id).toBe('plugin-b');
        });

        it('getPluginsForSlot呼び出し時_該当なし_空配列を返す', () => {
            const plugins = manager.getPluginsForSlot('nonexistent:slot');

            expect(plugins).toEqual([]);
        });

        it('getPluginsForSlot呼び出し時_無効なPlugin_除外される', () => {
            manager.register({
                id: 'disabled-plugin',
                displayName: 'Disabled Plugin',
                slots: ['sidebar:test'],
                lifecycle: { render: async () => {} }
            });

            // enabledPluginsに追加しない
            manager._configLoaded = true;

            const plugins = manager.getPluginsForSlot('sidebar:test');

            expect(plugins).toEqual([]);
        });
    });

    // ===== loadAll =====

    describe('loadAll()', () => {
        it('loadAll呼び出し時_有効なPlugin_loadが実行される', async () => {
            const loadFn = vi.fn().mockResolvedValue(undefined);

            manager.register({
                id: 'test-plugin',
                displayName: 'Test Plugin',
                slots: ['sidebar:test'],
                lifecycle: {
                    load: loadFn,
                    render: async () => {}
                }
            });

            manager.enabledPlugins.add('test-plugin');
            manager._configLoaded = true;

            await manager.loadAll();

            expect(loadFn).toHaveBeenCalled();
        });

        it('loadAll呼び出し時_loadでエラー_他のPluginは継続実行', async () => {
            const loadFnA = vi.fn().mockRejectedValue(new Error('Load failed'));
            const loadFnB = vi.fn().mockResolvedValue(undefined);

            manager.register({
                id: 'plugin-a',
                displayName: 'Plugin A',
                slots: ['sidebar:test'],
                lifecycle: { load: loadFnA, render: async () => {} }
            });

            manager.register({
                id: 'plugin-b',
                displayName: 'Plugin B',
                slots: ['sidebar:test'],
                lifecycle: { load: loadFnB, render: async () => {} }
            });

            manager.enabledPlugins.add('plugin-a');
            manager.enabledPlugins.add('plugin-b');
            manager._configLoaded = true;

            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            const result = await manager.loadAll();

            expect(loadFnA).toHaveBeenCalled();
            expect(loadFnB).toHaveBeenCalled();
            expect(result.loaded).toBe(1);
            expect(result.failed).toBe(1);

            errorSpy.mockRestore();
        });
    });

    // ===== mount/unmount =====

    describe('mount()', () => {
        it('mount呼び出し時_有効なPlugin_renderが実行される', async () => {
            const renderFn = vi.fn().mockResolvedValue(undefined);
            const container = document.createElement('div');

            manager.register({
                id: 'test-plugin',
                displayName: 'Test Plugin',
                slots: ['sidebar:test'],
                lifecycle: { render: renderFn }
            });

            manager.enabledPlugins.add('test-plugin');
            manager._configLoaded = true;

            await manager.mount('test-plugin', container);

            expect(renderFn).toHaveBeenCalledWith(container);
        });

        it('mount呼び出し時_無効なPlugin_スキップされる', async () => {
            const renderFn = vi.fn().mockResolvedValue(undefined);
            const container = document.createElement('div');
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

            manager.register({
                id: 'disabled-plugin',
                displayName: 'Disabled Plugin',
                slots: ['sidebar:test'],
                lifecycle: { render: renderFn }
            });

            manager._configLoaded = true;
            // enabledPluginsに追加しない

            await manager.mount('disabled-plugin', container);

            expect(renderFn).not.toHaveBeenCalled();
            logSpy.mockRestore();
        });

        it('mount呼び出し時_存在しないPlugin_エラーが投げられる', async () => {
            const container = document.createElement('div');

            await expect(manager.mount('nonexistent', container)).rejects.toThrow('not found');
        });
    });

    describe('unmount()', () => {
        it('unmount呼び出し時_マウント済みPlugin_destroyが実行される', async () => {
            const destroyFn = vi.fn();
            const container = document.createElement('div');

            manager.register({
                id: 'test-plugin',
                displayName: 'Test Plugin',
                slots: ['sidebar:test'],
                lifecycle: {
                    render: async () => {},
                    destroy: destroyFn
                }
            });

            manager.enabledPlugins.add('test-plugin');
            manager._configLoaded = true;

            await manager.mount('test-plugin', container);
            manager.unmount('test-plugin');

            expect(destroyFn).toHaveBeenCalled();
        });
    });

    // ===== PLUGIN_EVENTS / PLUGIN_LAYERS =====

    describe('exports', () => {
        it('PLUGIN_EVENTSがエクスポートされる', () => {
            expect(PLUGIN_EVENTS.PLUGIN_REGISTERED).toBe('plugin:registered');
            expect(PLUGIN_EVENTS.PLUGIN_MOUNTED).toBe('plugin:mounted');
            expect(PLUGIN_EVENTS.CONFIG_LOADED).toBe('plugin:config-loaded');
        });

        it('PLUGIN_LAYERSがエクスポートされる', () => {
            expect(PLUGIN_LAYERS.CORE).toBe('core');
            expect(PLUGIN_LAYERS.BUSINESS).toBe('business');
            expect(PLUGIN_LAYERS.EXTENSION).toBe('extension');
        });
    });
});
