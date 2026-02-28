import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SettingsPluginRegistry } from '../../../public/modules/settings/settings-plugin-api.js';

describe('SettingsPluginRegistry', () => {
  let registry;
  let mockEventBus;
  let mockStore;

  beforeEach(() => {
    mockEventBus = {
      emit: vi.fn(),
      on: vi.fn()
    };
    mockStore = {
      getState: vi.fn(),
      setState: vi.fn()
    };
    registry = new SettingsPluginRegistry({ eventBus: mockEventBus, store: mockStore });
  });

  describe('register', () => {
    it('register呼び出し時_プラグインが登録される', () => {
      const descriptor = {
        id: 'test-plugin',
        displayName: 'Test Plugin',
        order: 10,
        lifecycle: {
          render: vi.fn()
        }
      };

      registry.register(descriptor);

      expect(registry.plugins.has('test-plugin')).toBe(true);
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'settings:plugin-registered',
        { pluginId: 'test-plugin' }
      );
    });

    it('register呼び出し時_render未定義_エラーが投げられる', () => {
      const descriptor = {
        id: 'invalid-plugin',
        displayName: 'Invalid Plugin',
        order: 10,
        lifecycle: {}
      };

      expect(() => registry.register(descriptor)).toThrow(
        'Plugin must provide render() method'
      );
    });

    it('register呼び出し時_重複ID_警告が出る', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const descriptor = {
        id: 'duplicate',
        displayName: 'Duplicate',
        lifecycle: { render: vi.fn() }
      };

      registry.register(descriptor);
      registry.register(descriptor);

      expect(consoleWarnSpy).toHaveBeenCalledWith('Plugin duplicate already registered');

      consoleWarnSpy.mockRestore();
    });

    it('register呼び出し時_order指定なし_デフォルト100が設定される', () => {
      const descriptor = {
        id: 'no-order',
        displayName: 'No Order',
        lifecycle: { render: vi.fn() }
      };

      registry.register(descriptor);

      const plugin = registry.plugins.get('no-order');
      expect(plugin.order).toBe(100);
    });
  });

  describe('loadAll', () => {
    it('loadAll呼び出し時_全プラグインのloadが実行される', async () => {
      const load1 = vi.fn().mockResolvedValue();
      const load2 = vi.fn().mockResolvedValue();

      registry.register({
        id: 'plugin1',
        displayName: 'Plugin 1',
        lifecycle: { load: load1, render: vi.fn() }
      });

      registry.register({
        id: 'plugin2',
        displayName: 'Plugin 2',
        lifecycle: { load: load2, render: vi.fn() }
      });

      await registry.loadAll();

      expect(load1).toHaveBeenCalled();
      expect(load2).toHaveBeenCalled();
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'settings:plugins-loaded',
        { loaded: 2, failed: 0 }
      );
    });

    it('loadAll呼び出し時_一部load失敗_エラーイベントが発火される', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const load1 = vi.fn().mockResolvedValue();
      const load2 = vi.fn().mockRejectedValue(new Error('Load failed'));

      registry.register({
        id: 'plugin1',
        displayName: 'Plugin 1',
        lifecycle: { load: load1, render: vi.fn() }
      });

      registry.register({
        id: 'plugin2',
        displayName: 'Plugin 2',
        lifecycle: { load: load2, render: vi.fn() }
      });

      await registry.loadAll();

      expect(load1).toHaveBeenCalled();
      expect(load2).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Plugin plugin2 load failed:'),
        expect.any(Error)
      );
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'settings:plugin-load-error',
        {
          pluginId: 'plugin2',
          error: expect.any(Error)
        }
      );
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'settings:plugins-loaded',
        { loaded: 1, failed: 1 }
      );

      consoleErrorSpy.mockRestore();
    });

    it('loadAll呼び出し時_load未定義_スキップされる', async () => {
      registry.register({
        id: 'no-load',
        displayName: 'No Load',
        lifecycle: { render: vi.fn() }
      });

      await registry.loadAll();

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'settings:plugins-loaded',
        { loaded: 1, failed: 0 }
      );
    });
  });

  describe('renderPanel', () => {
    it('renderPanel呼び出し時_プラグインのrenderが実行される', async () => {
      const render = vi.fn();
      const container = document.createElement('div');

      registry.register({
        id: 'test',
        displayName: 'Test',
        lifecycle: { render }
      });

      await registry.renderPanel('test', container);

      expect(render).toHaveBeenCalledWith(container);
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'settings:panel-rendered',
        { pluginId: 'test' }
      );
    });

    it('renderPanel呼び出し時_存在しないプラグイン_エラーが投げられる', async () => {
      const container = document.createElement('div');

      await expect(registry.renderPanel('non-existent', container)).rejects.toThrow(
        'Plugin non-existent not found'
      );
    });

    it('renderPanel呼び出し時_render未定義_警告が出る', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // 特殊ケース: renderを後から削除（通常は起こらないが、防御的プログラミング）
      registry.plugins.set('no-render', {
        id: 'no-render',
        displayName: 'No Render',
        order: 10,
        lifecycle: {}
      });

      const container = document.createElement('div');
      await registry.renderPanel('no-render', container);

      expect(consoleWarnSpy).toHaveBeenCalledWith('Plugin no-render has no render method');

      consoleWarnSpy.mockRestore();
    });
  });

  describe('unregister', () => {
    it('unregister呼び出し時_destroyが実行されプラグインが削除される', () => {
      const destroy = vi.fn();

      registry.register({
        id: 'test',
        displayName: 'Test',
        lifecycle: { render: vi.fn(), destroy }
      });

      registry.unregister('test');

      expect(destroy).toHaveBeenCalled();
      expect(registry.plugins.has('test')).toBe(false);
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'settings:plugin-unregistered',
        { pluginId: 'test' }
      );
    });

    it('unregister呼び出し時_destroy未定義_エラーなく削除される', () => {
      registry.register({
        id: 'no-destroy',
        displayName: 'No Destroy',
        lifecycle: { render: vi.fn() }
      });

      expect(() => registry.unregister('no-destroy')).not.toThrow();
      expect(registry.plugins.has('no-destroy')).toBe(false);
    });

    it('unregister呼び出し時_存在しないプラグイン_何もしない', () => {
      expect(() => registry.unregister('non-existent')).not.toThrow();
    });
  });

  describe('generateTabNavigation', () => {
    it('generateTabNavigation呼び出し時_order順にソートされたタブが返される', () => {
      registry.register({
        id: 'plugin-c',
        displayName: 'Plugin C',
        order: 30,
        lifecycle: { render: vi.fn() }
      });

      registry.register({
        id: 'plugin-a',
        displayName: 'Plugin A',
        order: 10,
        lifecycle: { render: vi.fn() }
      });

      registry.register({
        id: 'plugin-b',
        displayName: 'Plugin B',
        order: 20,
        lifecycle: { render: vi.fn() }
      });

      const tabs = registry.generateTabNavigation();

      expect(tabs).toHaveLength(3);
      expect(tabs[0].id).toBe('plugin-a');
      expect(tabs[1].id).toBe('plugin-b');
      expect(tabs[2].id).toBe('plugin-c');
      expect(tabs[0]).toEqual({
        id: 'plugin-a',
        displayName: 'Plugin A',
        order: 10
      });
    });

    it('generateTabNavigation呼び出し時_プラグインなし_空配列が返される', () => {
      const tabs = registry.generateTabNavigation();

      expect(tabs).toEqual([]);
    });
  });
});
