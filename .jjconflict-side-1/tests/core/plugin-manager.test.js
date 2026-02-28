import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PluginManager } from '../../public/modules/core/plugin-manager.js';
import { EVENTS } from '../../public/modules/core/event-bus.js';

describe('PluginManager', () => {
    let mockEventBus;
    let mockStore;
    let mockApiClient;

    beforeEach(() => {
        document.body.innerHTML = '';
        mockEventBus = {
            emit: vi.fn().mockResolvedValue({ success: 0, errors: [] })
        };
        mockStore = {
            setState: vi.fn(),
            getState: vi.fn().mockReturnValue({ plugins: {} })
        };
        mockApiClient = {
            getConfig: vi.fn().mockResolvedValue({
                plugins: { enabled: [], disabled: [] }
            }),
            getEnvStatus: vi.fn().mockResolvedValue({})
        };
    });

    it('registerSlotsFromDOM呼び出し時_data-slotが登録される', () => {
        document.body.innerHTML = `
            <div data-slot="view:dashboard"></div>
            <div data-slot="sidebar:today"></div>
        `;

        const manager = new PluginManager({
            eventBus: mockEventBus,
            store: mockStore,
            apiClient: mockApiClient
        });

        manager.registerSlotsFromDOM();

        expect(manager.getSlot('view:dashboard')).not.toBeNull();
        expect(manager.getSlot('sidebar:today')).not.toBeNull();
    });

    it('registerPlugin呼び出し時_プラグインが登録される', () => {
        const manager = new PluginManager({
            eventBus: mockEventBus,
            store: mockStore,
            apiClient: mockApiClient
        });

        manager.registerPlugin({
            id: 'bb-dashboard',
            layer: 'business',
            slots: {}
        });

        expect(manager.getPlugin('bb-dashboard')).toBeDefined();
        expect(mockEventBus.emit).toHaveBeenCalledWith(
            EVENTS.PLUGIN_REGISTERED,
            { pluginId: 'bb-dashboard' }
        );
    });

    it('enableConfiguredPlugins呼び出し時_有効プラグインがマウントされる', async () => {
        document.body.innerHTML = '<div data-slot="view:dashboard"></div>';

        const mount = vi.fn().mockReturnValue(() => {});
        mockApiClient.getConfig.mockResolvedValue({
            plugins: { enabled: ['bb-dashboard'], disabled: [] }
        });

        const manager = new PluginManager({
            eventBus: mockEventBus,
            store: mockStore,
            apiClient: mockApiClient
        });

        manager.registerSlotsFromDOM();
        manager.registerPlugin({
            id: 'bb-dashboard',
            layer: 'business',
            slots: {
                'view:dashboard': { mount }
            }
        });

        await manager.loadConfig();
        await manager.enableConfiguredPlugins();

        expect(mount).toHaveBeenCalledTimes(1);
        expect(mockEventBus.emit).toHaveBeenCalledWith(
            EVENTS.PLUGIN_ENABLED,
            { pluginId: 'bb-dashboard' }
        );
    });

    it('enableConfiguredPlugins呼び出し時_config未定義_全プラグインが有効扱いになる', async () => {
        document.body.innerHTML = '<div data-slot="view:dashboard"></div>';

        const mount = vi.fn().mockReturnValue(() => {});
        mockApiClient.getConfig.mockResolvedValue({});

        const manager = new PluginManager({
            eventBus: mockEventBus,
            store: mockStore,
            apiClient: mockApiClient
        });

        manager.registerSlotsFromDOM();
        manager.registerPlugin({
            id: 'bb-dashboard',
            layer: 'business',
            slots: {
                'view:dashboard': { mount }
            }
        });

        await manager.loadConfig();
        await manager.enableConfiguredPlugins();

        expect(mount).toHaveBeenCalledTimes(1);
    });

    it('enableConfiguredPlugins呼び出し時_要件未達成_マウントされない', async () => {
        document.body.innerHTML = '<div data-slot="nav:inbox"></div>';

        const mount = vi.fn();
        mockApiClient.getConfig.mockResolvedValue({
            plugins: { enabled: ['bb-inbox'], disabled: [] },
            slack: null
        });
        mockApiClient.getEnvStatus.mockResolvedValue({
            SLACK_BOT_TOKEN: false
        });

        const manager = new PluginManager({
            eventBus: mockEventBus,
            store: mockStore,
            apiClient: mockApiClient
        });

        manager.registerSlotsFromDOM();
        manager.registerPlugin({
            id: 'bb-inbox',
            layer: 'business',
            requirements: {
                configKeys: ['slack'],
                envKeys: ['SLACK_BOT_TOKEN']
            },
            slots: {
                'nav:inbox': { mount }
            }
        });

        await manager.loadConfig();
        await manager.enableConfiguredPlugins();

        expect(mount).not.toHaveBeenCalled();
        expect(mockEventBus.emit).toHaveBeenCalledWith(
            EVENTS.PLUGIN_REQUIREMENTS_FAILED,
            expect.objectContaining({ pluginId: 'bb-inbox' })
        );
    });
});
