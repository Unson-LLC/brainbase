import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BrowserNotificationService } from '../../../public/modules/domain/browser-notification/browser-notification-service.js';
import { eventBus, EVENTS } from '../../../public/modules/core/event-bus.js';
import { appStore } from '../../../public/modules/core/store.js';

// Notification APIをモック化
const mockNotification = vi.fn();
const mockRequestPermission = vi.fn();
let notificationPermission = 'default';
let lastNotificationInstance = null;
let notificationOnClickHandler = null;

class MockNotification {
    constructor(title, options) {
        this.title = title;
        this.body = options?.body || '';
        this.icon = options?.icon || '';
        this.tag = options?.tag || '';
        this.data = options?.data || null;
        this.onclick = null;
        lastNotificationInstance = this;
        mockNotification(title, options);
    }

    close() {
        // モック実装
    }
}

// グローバルNotificationをモック化
globalThis.Notification = MockNotification;
Object.defineProperty(globalThis.Notification, 'permission', {
    get: () => notificationPermission,
    configurable: true
});
Object.defineProperty(globalThis.Notification, 'requestPermission', {
    value: async () => {
        const result = await mockRequestPermission();
        notificationPermission = result;
        return result;
    },
    configurable: true
});

// window.focusをモック化
globalThis.window = {
    focus: vi.fn()
};

describe('BrowserNotificationService', () => {
    let browserNotificationService;

    beforeEach(() => {
        // テストごとにリセット
        notificationPermission = 'default';
        lastNotificationInstance = null;
        notificationOnClickHandler = null;
        vi.clearAllMocks();

        // ストア初期化
        appStore.setState({
            browserNotificationPermission: 'default'
        });

        // サービスインスタンス作成
        browserNotificationService = new BrowserNotificationService();
    });

    afterEach(() => {
        // イベントリスナーをクリーンアップ
        if (browserNotificationService) {
            browserNotificationService.destroy();
        }
    });

    // UT-041: 通知許可リクエスト
    describe('requestPermission', () => {
        it('UT-041: requestPermission呼び出し時_Notification.requestPermissionが呼ばれる', async () => {
            mockRequestPermission.mockResolvedValue('granted');

            const result = await browserNotificationService.requestPermission();

            expect(mockRequestPermission).toHaveBeenCalled();
            expect(result).toBe('granted');
        });

        it('UT-041: requestPermission呼び出し時_許可されたらStoreにgrantedを保存', async () => {
            mockRequestPermission.mockResolvedValue('granted');

            await browserNotificationService.requestPermission();

            expect(appStore.getState().browserNotificationPermission).toBe('granted');
        });

        it('UT-041: requestPermission呼び出し時_拒否されたらStoreにdeniedを保存', async () => {
            mockRequestPermission.mockResolvedValue('denied');

            await browserNotificationService.requestPermission();

            expect(appStore.getState().browserNotificationPermission).toBe('denied');
        });

        it('UT-041: requestPermission呼び出し時_NOTIFICATION_PERMISSION_CHANGEDイベントが発火', async () => {
            mockRequestPermission.mockResolvedValue('granted');
            const listener = vi.fn();
            eventBus.on(EVENTS.NOTIFICATION_PERMISSION_CHANGED, listener);

            await browserNotificationService.requestPermission();

            expect(listener).toHaveBeenCalled();
            expect(listener.mock.calls[0][0].detail.permission).toBe('granted');
        });
    });

    // UT-042: 通知送信（許可あり）
    describe('notify - with permission', () => {
        it('UT-042: notify呼び出し時_権限がある場合_Notificationインスタンスが作成される', async () => {
            notificationPermission = 'granted';
            appStore.setState({ browserNotificationPermission: 'granted' });

            browserNotificationService.notify('テスト通知', { body: '本文です' });

            expect(mockNotification).toHaveBeenCalledWith('テスト通知', { body: '本文です' });
        });

        it('UT-042: notify呼び出し時_NOTIFICATION_SENTイベントが発火', async () => {
            notificationPermission = 'granted';
            appStore.setState({ browserNotificationPermission: 'granted' });
            const listener = vi.fn();
            eventBus.on(EVENTS.NOTIFICATION_SENT, listener);

            browserNotificationService.notify('テスト通知', { body: '本文' });

            expect(listener).toHaveBeenCalled();
            expect(listener.mock.calls[0][0].detail.title).toBe('テスト通知');
        });
    });

    // UT-043: 通知送信（許可なし）
    describe('notify - without permission', () => {
        it('UT-043: notify呼び出し時_権限がない場合_Inbox通知にフォールバック', async () => {
            notificationPermission = 'denied';
            appStore.setState({ browserNotificationPermission: 'denied' });

            const result = browserNotificationService.notify('テスト通知', { body: '本文' });

            // Notificationが作成されない
            expect(mockNotification).not.toHaveBeenCalled();
            // フォールバック結果を返す
            expect(result.fallback).toBe(true);
            expect(result.type).toBe('inbox');
        });

        it('UT-043: notify呼び出し時_default状態でも_Inbox通知にフォールバック', async () => {
            notificationPermission = 'default';
            appStore.setState({ browserNotificationPermission: 'default' });

            const result = browserNotificationService.notify('テスト通知', { body: '本文' });

            expect(mockNotification).not.toHaveBeenCalled();
            expect(result.fallback).toBe(true);
        });

        it('UT-043: notify呼び出し時_NOTIFICATION_FALLBACKイベントが発火', async () => {
            notificationPermission = 'denied';
            appStore.setState({ browserNotificationPermission: 'denied' });
            const listener = vi.fn();
            eventBus.on(EVENTS.NOTIFICATION_FALLBACK, listener);

            browserNotificationService.notify('テスト通知', { body: '本文' });

            expect(listener).toHaveBeenCalled();
            expect(listener.mock.calls[0][0].detail.title).toBe('テスト通知');
        });
    });

    // UT-044: 通知クリック時のフォーカス処理
    describe('notification click handler', () => {
        it('UT-044: 通知クリック時_window.focusが呼ばれる', async () => {
            notificationPermission = 'granted';
            appStore.setState({ browserNotificationPermission: 'granted' });

            browserNotificationService.notify('テスト通知', { body: '本文' });

            // 通知クリックをシミュレート
            expect(lastNotificationInstance).not.toBeNull();
            lastNotificationInstance.onclick();

            expect(window.focus).toHaveBeenCalled();
        });

        it('UT-044: 通知クリック時_NOTIFICATION_CLICKEDイベントが発火', async () => {
            notificationPermission = 'granted';
            appStore.setState({ browserNotificationPermission: 'granted' });
            const listener = vi.fn();
            eventBus.on(EVENTS.NOTIFICATION_CLICKED, listener);

            browserNotificationService.notify('テスト通知', { body: '本文', data: { url: '/test' } });

            lastNotificationInstance.onclick();

            expect(listener).toHaveBeenCalled();
            expect(listener.mock.calls[0][0].detail.data.url).toBe('/test');
        });

        it('UT-044: 通知クリック時_data.urlがあればそのURLに遷移可能な情報を提供', async () => {
            notificationPermission = 'granted';
            appStore.setState({ browserNotificationPermission: 'granted' });
            const listener = vi.fn();
            eventBus.on(EVENTS.NOTIFICATION_CLICKED, listener);

            browserNotificationService.notify('テスト通知', {
                body: '本文',
                data: { url: '/tasks/123' }
            });

            lastNotificationInstance.onclick();

            expect(listener.mock.calls[0][0].detail.data.url).toBe('/tasks/123');
        });
    });

    // UT-045: 権限状態取得
    describe('getPermissionState', () => {
        it('UT-045: getPermissionState呼び出し時_現在の権限状態を返す', () => {
            notificationPermission = 'granted';
            appStore.setState({ browserNotificationPermission: 'granted' });

            const state = browserNotificationService.getPermissionState();

            expect(state).toBe('granted');
        });

        it('UT-045: getPermissionState呼び出し時_denied状態を正しく返す', () => {
            notificationPermission = 'denied';
            appStore.setState({ browserNotificationPermission: 'denied' });

            const state = browserNotificationService.getPermissionState();

            expect(state).toBe('denied');
        });

        it('UT-045: getPermissionState呼び出し時_default状態を正しく返す', () => {
            notificationPermission = 'default';
            appStore.setState({ browserNotificationPermission: 'default' });

            const state = browserNotificationService.getPermissionState();

            expect(state).toBe('default');
        });
    });

    // UT-046: hasPermission判定
    describe('hasPermission', () => {
        it('UT-046: hasPermission呼び出し時_grantedの場合trueを返す', () => {
            notificationPermission = 'granted';
            appStore.setState({ browserNotificationPermission: 'granted' });

            expect(browserNotificationService.hasPermission()).toBe(true);
        });

        it('UT-046: hasPermission呼び出し時_defaultの場合falseを返す', () => {
            notificationPermission = 'default';

            expect(browserNotificationService.hasPermission()).toBe(false);
        });

        it('UT-046: hasPermission呼び出し時_deniedの場合falseを返す', () => {
            notificationPermission = 'denied';

            expect(browserNotificationService.hasPermission()).toBe(false);
        });
    });

    // UT-047: Service初期化
    describe('initialization', () => {
        it('UT-047: コンストラクタ呼び出し時_Storeの権限状態とNotification.permissionを同期', () => {
            // beforeEachのサービスをdestroy
            browserNotificationService.destroy();

            // 権限をgrantedに設定してから新しいサービスを作成
            notificationPermission = 'granted';

            const service = new BrowserNotificationService();

            expect(service.getPermissionState()).toBe('granted');

            // テスト後にクリーンアップ
            service.destroy();
        });

        it('UT-047: コンストラクタ呼び出し時_既にStoreに権限がある場合はAPI状態を優先', () => {
            // beforeEachのサービスをdestroy
            browserNotificationService.destroy();

            // APIの状態を優先するので、Storeの設定に関わらずAPI状態を使用
            notificationPermission = 'denied';
            appStore.setState({ browserNotificationPermission: 'granted' });

            const service = new BrowserNotificationService();

            // APIの状態が優先される
            expect(service.getPermissionState()).toBe('denied');

            // テスト後にクリーンアップ
            service.destroy();
        });
    });

    // UT-048: イベント購読
    describe('EventBus integration', () => {
        it('UT-048: NOTIFICATION_REQUESTイベントでrequestPermissionが呼ばれる', async () => {
            mockRequestPermission.mockResolvedValue('granted');

            await eventBus.emit(EVENTS.NOTIFICATION_REQUEST, {});

            expect(mockRequestPermission).toHaveBeenCalled();
        });

        it('UT-048: NOTIFICATION_SENDイベントでnotifyが呼ばれる', async () => {
            notificationPermission = 'granted';
            appStore.setState({ browserNotificationPermission: 'granted' });

            await eventBus.emit(EVENTS.NOTIFICATION_SEND, {
                title: 'イベント通知',
                options: { body: '本文' }
            });

            expect(mockNotification).toHaveBeenCalledWith('イベント通知', { body: '本文' });
        });
    });

    // UT-049: destroy処理
    describe('destroy', () => {
        it('UT-049: destroy呼び出し時_イベントリスナーが解除される', async () => {
            mockRequestPermission.mockResolvedValue('granted');
            notificationPermission = 'granted';
            appStore.setState({ browserNotificationPermission: 'granted' });

            // beforeEachで作られたサービスを先にdestroy
            browserNotificationService.destroy();

            // 新しいサービスインスタンスを作成
            const newService = new BrowserNotificationService();

            // destroyしてから
            newService.destroy();

            // イベントを発火しても反応しないことを確認
            mockRequestPermission.mockClear();
            await eventBus.emit(EVENTS.NOTIFICATION_REQUEST, {});

            expect(mockRequestPermission).not.toHaveBeenCalled();
        });
    });

    // UT-050: エラーハンドリング
    describe('error handling', () => {
        it('UT-050: requestPermission呼び出し時_エラーが発生したら_NOTIFICATION_ERRORイベントが発火', async () => {
            const error = new Error('Permission error');
            mockRequestPermission.mockRejectedValue(error);
            const listener = vi.fn();
            eventBus.on(EVENTS.NOTIFICATION_ERROR, listener);

            await browserNotificationService.requestPermission();

            expect(listener).toHaveBeenCalled();
            expect(listener.mock.calls[0][0].detail.error.message).toBe('Permission error');
        });

        it('UT-050: notify呼び出し時_Notification APIが使えない環境でもクラッシュしない', () => {
            // Notification APIを一時的に削除
            const originalNotification = globalThis.Notification;
            delete globalThis.Notification;

            // 新しいサービスインスタンス作成
            const service = new BrowserNotificationService();

            // notifyを呼び出してもクラッシュしない
            const result = service.notify('テスト', { body: '本文' });

            expect(result).toBeDefined();
            expect(result.fallback).toBe(true);

            // 復元
            globalThis.Notification = originalNotification;
            service.destroy();
        });
    });
});
