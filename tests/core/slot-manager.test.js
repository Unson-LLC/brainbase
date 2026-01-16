import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlotManager, SLOTS, createSlotManager } from '../../public/modules/core/slot-manager.js';
import { UIPluginManager, PLUGIN_LAYERS } from '../../public/modules/core/ui-plugin-manager.js';

describe('SlotManager', () => {
    let slotManager;
    let pluginManager;
    let root;

    beforeEach(() => {
        // テスト用のDOM構造を作成
        root = document.createElement('div');
        root.innerHTML = `
            <div data-plugin-slot="sidebar:focus" id="focus-task"></div>
            <div data-plugin-slot="sidebar:next-tasks" id="next-tasks-list"></div>
            <div data-plugin-slot="sidebar:schedule" id="timeline-list"></div>
        `;
        document.body.appendChild(root);

        pluginManager = new UIPluginManager();
        slotManager = new SlotManager({ pluginManager, root });
    });

    afterEach(() => {
        document.body.removeChild(root);
        slotManager = null;
        pluginManager = null;
    });

    // ===== スロット発見 =====

    describe('discoverSlots()', () => {
        it('discoverSlots呼び出し時_data-plugin-slot属性を検出', () => {
            slotManager.discoverSlots();

            expect(slotManager.slots.has('sidebar:focus')).toBe(true);
            expect(slotManager.slots.has('sidebar:next-tasks')).toBe(true);
            expect(slotManager.slots.has('sidebar:schedule')).toBe(true);
        });

        it('discoverSlots呼び出し時_要素が正しくマッピングされる', () => {
            slotManager.discoverSlots();

            const focusElement = slotManager.slots.get('sidebar:focus');
            expect(focusElement.id).toBe('focus-task');
        });
    });

    // ===== スロット登録 =====

    describe('registerSlot()', () => {
        it('registerSlot呼び出し時_手動登録が可能', () => {
            const element = document.createElement('div');
            element.id = 'custom-slot';

            slotManager.registerSlot('custom:slot', element);

            expect(slotManager.slots.has('custom:slot')).toBe(true);
            expect(slotManager.slots.get('custom:slot').id).toBe('custom-slot');
        });

        it('registerSlot呼び出し時_上書き登録が可能', () => {
            const element1 = document.createElement('div');
            element1.id = 'slot-1';
            const element2 = document.createElement('div');
            element2.id = 'slot-2';

            slotManager.registerSlot('test:slot', element1);
            slotManager.registerSlot('test:slot', element2);

            expect(slotManager.slots.get('test:slot').id).toBe('slot-2');
        });
    });

    // ===== 既存要素マッピング =====

    describe('mapExistingElements()', () => {
        it('mapExistingElements呼び出し時_ID→スロットマッピングが適用される', () => {
            slotManager.mapExistingElements({
                'focus-task': 'sidebar:focus',
                'next-tasks-list': 'sidebar:next-tasks'
            });

            expect(slotManager.slots.has('sidebar:focus')).toBe(true);
            expect(slotManager.slots.has('sidebar:next-tasks')).toBe(true);
        });

        it('mapExistingElements呼び出し時_存在しないID_スキップされる', () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            slotManager.mapExistingElements({
                'nonexistent-id': 'test:slot'
            });

            expect(slotManager.slots.has('test:slot')).toBe(false);
            warnSpy.mockRestore();
        });
    });

    // ===== Fallback登録 =====

    describe('registerFallback()', () => {
        it('registerFallback呼び出し時_Fallback関数が登録される', () => {
            const fallbackFn = vi.fn();

            slotManager.registerFallback('sidebar:focus', fallbackFn);

            expect(slotManager.fallbacks.has('sidebar:focus')).toBe(true);
        });
    });

    // ===== スロットマウント =====

    describe('mountSlot()', () => {
        beforeEach(() => {
            slotManager.discoverSlots();
        });

        it('mountSlot呼び出し時_有効なPlugin_renderが実行される', async () => {
            const renderFn = vi.fn().mockResolvedValue(undefined);

            pluginManager.register({
                id: 'test-plugin',
                displayName: 'Test Plugin',
                slots: ['sidebar:focus'],
                lifecycle: { render: renderFn }
            });

            pluginManager.enabledPlugins.add('test-plugin');
            pluginManager._configLoaded = true;

            await slotManager.mountSlot('sidebar:focus');

            expect(renderFn).toHaveBeenCalled();
        });

        it('mountSlot呼び出し時_無効なPlugin_Fallbackが実行される', async () => {
            const fallbackFn = vi.fn().mockResolvedValue(undefined);

            pluginManager.register({
                id: 'disabled-plugin',
                displayName: 'Disabled Plugin',
                slots: ['sidebar:focus'],
                lifecycle: { render: async () => {} }
            });

            // enabledPluginsに追加しない
            pluginManager._configLoaded = true;

            slotManager.registerFallback('sidebar:focus', fallbackFn);

            await slotManager.mountSlot('sidebar:focus');

            expect(fallbackFn).toHaveBeenCalled();
        });

        it('mountSlot呼び出し時_存在しないスロット_エラーログが出力される', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            await slotManager.mountSlot('nonexistent:slot');

            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
            warnSpy.mockRestore();
        });
    });

    // ===== 全スロットマウント =====

    describe('mountAllSlots()', () => {
        it('mountAllSlots呼び出し時_全スロットがマウントされる', async () => {
            const renderFn1 = vi.fn().mockResolvedValue(undefined);
            const renderFn2 = vi.fn().mockResolvedValue(undefined);

            pluginManager.register({
                id: 'plugin-1',
                displayName: 'Plugin 1',
                slots: ['sidebar:focus'],
                lifecycle: { render: renderFn1 }
            });

            pluginManager.register({
                id: 'plugin-2',
                displayName: 'Plugin 2',
                slots: ['sidebar:next-tasks'],
                lifecycle: { render: renderFn2 }
            });

            pluginManager.enabledPlugins.add('plugin-1');
            pluginManager.enabledPlugins.add('plugin-2');
            pluginManager._configLoaded = true;

            slotManager.discoverSlots();
            await slotManager.mountAllSlots();

            expect(renderFn1).toHaveBeenCalled();
            expect(renderFn2).toHaveBeenCalled();
        });
    });

    // ===== Factory関数 =====

    describe('createSlotManager()', () => {
        it('createSlotManager呼び出し時_SlotManagerインスタンスが返される', () => {
            const manager = createSlotManager({ pluginManager, root });

            expect(manager).toBeInstanceOf(SlotManager);
        });
    });

    // ===== SLOTS定数 =====

    describe('SLOTS', () => {
        it('SLOTS定数がエクスポートされる', () => {
            expect(SLOTS.VIEW_DASHBOARD).toBe('view:dashboard');
            expect(SLOTS.SIDEBAR_FOCUS).toBe('sidebar:focus');
            expect(SLOTS.SIDEBAR_NEXT_TASKS).toBe('sidebar:next-tasks');
            expect(SLOTS.SIDEBAR_SCHEDULE).toBe('sidebar:schedule');
            expect(SLOTS.SIDEBAR_INBOX).toBe('sidebar:inbox');
        });
    });
});
