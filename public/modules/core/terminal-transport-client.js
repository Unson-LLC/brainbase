// @ts-check
import { httpClient } from './http-client.js';
import { loadXterm } from './xterm-loader.js';
import { DEFAULT_TERMINAL_THEME } from '../terminal/terminal-theme.js';
import { MessageQueue } from './message-queue.js';
import { inputTelemetry } from './input-telemetry.js';

const SNAPSHOT_LINES = 400;
export const TERMINAL_SCROLLBACK_LINES = 5000;
const CONNECT_TIMEOUT_MS = 15000;

// WebSocket reconnection settings (CommandMate pattern)
const MAX_RECONNECT_RETRIES = 10;
const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
const KEEPALIVE_INTERVAL_MS = 30000;
const INITIAL_RESET_SNAPSHOT_WAIT_MS = 1500;
const TEXT_BATCH_WINDOW_MS = 8;
const TEXT_BATCH_MAX_BYTES = 64 * 1024;
const FOCUS_ESCAPE_GRACE_MS = 12;
const LOCAL_ECHO_SNAPSHOT_DEFER_MS = 1200;
const SCROLL_MIN_DELTA_PX = 12;
const SCROLL_STEP_PX = 40;
const MAX_SCROLL_STEPS = 8;
const SCROLL_FLUSH_MS = 16;
const TOUCH_STEP_PX = 18;
const TOUCH_FLUSH_MS = 30;
const CONTROL_KEYS_WITHOUT_INPUT_PROBE = new Set(['C-c', 'C-d', 'C-l', 'C-u', 'Escape', 'M-Enter', 'S-Enter']);
const OSC_SEQUENCE_PATTERN = /\x1b\](?:[^\x07\x1b]|\x1b(?!\\))*?(?:\x07|\x1b\\)/gi;
const BARE_OSC_COLOR_RESPONSE_PATTERN = /\]1[012];rgb:[0-9a-f]{1,4}\/[0-9a-f]{1,4}\/[0-9a-f]{1,4}(?:\x07|\x1b\\)?/gi;
const FOCUS_REPORT_PATTERN = /\x1b\[(?:I|O)/g;

// Custom close code: ownership was taken over by another viewer
const WS_CLOSE_BLOCKED = 4001;
// Custom close code: superseded by another tab of the same viewer (multi-tab).
// 同一viewerの新しいタブが接続を引き継いだ場合。所有権は同一viewerのままなので
// blocked扱いにはせず、旧タブが再接続して引き継ぎ合戦になるのも避けるため再接続しない。
const WS_CLOSE_SUPERSEDED = 4002;

// Expected close codes that should NOT trigger reconnection
const EXPECTED_CLOSE_CODES = new Set([
    1000, // Normal Closure
    1001, // Going Away (browser navigation)
    WS_CLOSE_SUPERSEDED, // 同一viewerの別タブに引き継がれた
]);

function isTtcDebugEnabled() {
    if (typeof window === 'undefined') return false;
    try {
        const debugWindow = /** @type {Window & { __BB_TTC_DEBUG__?: boolean }} */ (window);
        return debugWindow.__BB_TTC_DEBUG__ === true || window.localStorage?.getItem('brainbase.ttcDebug') === '1';
    } catch {
        return false;
    }
}

function ttcDebug(...args) {
    if (isTtcDebugEnabled() && typeof console !== 'undefined' && console.log) {
        console.log(...args);
    }
}

function ttcWarn(...args) {
    if (isTtcDebugEnabled() && typeof console !== 'undefined' && console.warn) {
        console.warn(...args);
    }
}

function stripTerminalControlResponses(value) {
    if (typeof value !== 'string' || !value) return value;
    return value
        .replace(OSC_SEQUENCE_PATTERN, '')
        .replace(BARE_OSC_COLOR_RESPONSE_PATTERN, '')
        .replace(FOCUS_REPORT_PATTERN, '');
}

function readTerminalAppearance(hostEl) {
    if (typeof window === 'undefined' || !hostEl) {
        return {
            fontFamily: 'Menlo, Monaco, monospace',
            fontSize: 14,
            lineHeight: 1.35,
            theme: { ...DEFAULT_TERMINAL_THEME }
        };
    }

    const styles = window.getComputedStyle(hostEl);
    const rootStyles = window.getComputedStyle(document.documentElement);
    const readValue = (name, fallback) => {
        const value = rootStyles.getPropertyValue(name).trim();
        return value || fallback;
    };
    const parsedFontSize = Number.parseFloat(readValue('--terminal-font-size', '14px'));
    const parsedLineHeight = Number.parseFloat(readValue('--terminal-line-height', '1.35'));

    return {
        fontFamily: readValue('--terminal-font-family', styles.fontFamily || 'Menlo, Monaco, monospace'),
        fontSize: Number.isFinite(parsedFontSize) ? parsedFontSize : 14,
        lineHeight: Number.isFinite(parsedLineHeight) ? parsedLineHeight : 1.35,
        theme: {
            ...DEFAULT_TERMINAL_THEME,
            background: readValue('--terminal-bg', DEFAULT_TERMINAL_THEME.background),
            foreground: readValue('--terminal-fg', DEFAULT_TERMINAL_THEME.foreground),
            cursor: readValue('--terminal-cursor', DEFAULT_TERMINAL_THEME.cursor),
            selectionBackground: readValue('--terminal-selection-bg', DEFAULT_TERMINAL_THEME.selectionBackground)
        }
    };
}

export function shouldUseXtermTransport() {
    if (typeof window === 'undefined') return false;
    const userAgent = typeof navigator !== 'undefined' ? (navigator.userAgent || '') : '';
    if (/jsdom/i.test(userAgent) || typeof /** @type {any} */ (window).__vitest_worker__ !== 'undefined') {
        return false;
    }
    return window.innerWidth > 768;
}

export class TerminalTransportClient {
    constructor({ viewerId, viewerLabel, onStatusChange = null, onSnapshotChange = null, onConnectMetric = null, getCurrentSessionId = null }) {
        this.viewerId = viewerId;
        this.viewerLabel = viewerLabel;
        this.onStatusChange = onStatusChange;
        this.onSnapshotChange = onSnapshotChange;
        this.onConnectMetric = typeof onConnectMetric === 'function' ? onConnectMetric : null;
        this.getCurrentSessionId = typeof getCurrentSessionId === 'function' ? getCurrentSessionId : null;
        this.hostEl = null;
        this.terminal = null;
        this.fitAddon = null;
        this.ws = null;
        this.sessionId = null;
        this.status = {
            mode: 'idle',
            copyMode: false,
            blockedAccess: null,
            terminalAccess: null,
            runtimeState: 'stopped',
            inputReady: false,
            connected: false,
            isFocused: false,
            lastSnapshotAt: null,
            transport: 'snapshot'
        };
        this._resizeHandler = null;
        this._reconnectTimer = null;
        this._retryCount = 0;
        this._manualClose = false;
        this._connectToken = 0;
        this._keepaliveTimer = null;
        this._messageQueue = new MessageQueue();
        this._isViewportPinnedToBottom = true;
        this._pendingSnapshotText = null;
        this._pendingSnapshotOptions = null;
        this._lastSnapshotText = null;
        this._lastPlainSnapshotText = '';
        this._pendingEchoText = '';
        this._pendingEchoSince = 0;
        this._pendingEchoExpiryTimer = null;
        this._pendingBackspaceEchoCount = 0;
        this._deferredSnapshotWhileEchoPending = null;
        this._forceApplyNextSnapshot = false;
        this._hiddenDisconnect = false;
        this._visibilityHandler = null;
        this._pendingTextBuffer = '';
        this._pendingTextFlushTimer = null;
        this._pendingFocusEscape = null;
        this._pendingFocusEscapeTimer = null;
        this._textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
        this._lastSentCols = 0;
        this._lastSentRows = 0;
        this._hostResizeObserver = null;
        this._hostResizeRaf = null;
        this._lastObservedHostWidth = 0;
        this._lastObservedHostHeight = 0;
        this._wheelDelta = 0;
        this._touchDelta = 0;
        this._wheelFlushTimer = null;
        this._touchFlushTimer = null;
        this._lastTouchY = null;
        this._boundWheelHandler = null;
        this._boundTouchStartHandler = null;
        this._boundTouchMoveHandler = null;
        this._boundTouchEndHandler = null;
        this._boundPasteHandler = null;
        // xterm.js 5.x: short IME commit後にbare EnterでonData('\r')が発火しない場合がある。
        // IME確定Enter(isComposing=true)でフラグを立て、直後のbare Enter(isComposing=false)を
        // xtermが握り潰したと判断できるタイマーで\rを補完する。IME確定Enter自体は\rを送らない。
        this._imeJustCommittedWithEnter = false;
        this._imePostEnterPending = false;
        this._imePostEnterTimer = null;
        this._imeCursorSettleActive = false;
        this._cursorDebugPanel = null;
        // loadXterm() の dynamic import が完了する前に WS スナップショットが
        // 到着した場合に保存しておくバッファ。init() で terminal が準備でき次第 flush。
        this._preTerminalSnapshot = null;
        this._resetTerminalOnNextSnapshot = false;
        // After a session-switch snapshot (a static preview), the live stream (tmux
        // attach) repaints the screen. If that repaint is shorter than the snapshot, the
        // snapshot's trailing lines linger -> duplicated menu / ruler ghost rows. Clear
        // once on the first live output after such a snapshot. Set by _applySnapshot.
        this._liveResetPendingAfterSnapshot = false;
        this._terminalWriteQueue = [];
        this._terminalWriteActive = false;
        this._terminalWriteGeneration = 0;
        this._terminalRenderRefreshRaf = null;
        this._pendingTerminalRenderRefreshMode = null;
    }

    async init(hostEl) {
        this.hostEl = hostEl;
        this._syncCursorDebugClass();
        const { Terminal, FitAddon, WebLinksAddon, Unicode11Addon, WebglAddon } = await loadXterm();
        if (this.terminal) return;
        const appearance = readTerminalAppearance(hostEl);
        this._syncTerminalMetricVars(appearance);

        this.terminal = new Terminal({
            fontFamily: appearance.fontFamily,
            fontSize: appearance.fontSize,
            lineHeight: appearance.lineHeight,
            scrollback: TERMINAL_SCROLLBACK_LINES,
            convertEol: true,
            allowTransparency: false,
            allowProposedApi: true,
            cursorBlink: true,
            theme: appearance.theme
        });
        this.fitAddon = new FitAddon();
        this.terminal.loadAddon(this.fitAddon);
        if (WebLinksAddon) {
            this.terminal.loadAddon(new WebLinksAddon());
        }
        if (Unicode11Addon) {
            this.terminal.loadAddon(new Unicode11Addon());
            this.terminal.unicode.activeVersion = '11';
        }
        this.terminal.open(hostEl);
        // Activate the GPU (WebGL) renderer after open(). The default DOM renderer leaves the xterm
        // region unpainted under heavy continuous output — the screen freezes on the latest frame and
        // only repaints on a resize (e.g. opening devtools). WebGL renders to a canvas and is not
        // subject to that DOM-paint stall. On GPU context loss it disposes itself and xterm reverts to
        // the DOM renderer, so a lost context degrades rather than breaks.
        this._activateWebglRenderer(WebglAddon);
        this.fitAddon.fit();
        // dynamic import 中に届いた snapshot があれば適用する。これがないと
        // init() 完了前に着いた snapshot が drop され、画面が永遠に空白になる。
        if (this._preTerminalSnapshot !== null) {
            const saved = this._preTerminalSnapshot;
            this._preTerminalSnapshot = null;
            this._queueOrApplySnapshot(saved.text, saved.cursor, saved.options || {});
        }
        if (typeof this.terminal.attachCustomKeyEventHandler === 'function') {
            this.terminal.attachCustomKeyEventHandler((event) => this._handleCustomKeyEvent(event));
        }
        this.hostEl.addEventListener('compositionstart', () => {
            this._setImeComposing(true);
        }, true);
        this.hostEl.addEventListener('compositionend', () => {
            this._setImeComposing(false, { settleCursor: true });
        }, true);
        this._boundPasteHandler = (event) => this._handlePasteEvent(event);
        this.hostEl.addEventListener('paste', this._boundPasteHandler, true);
        this._inputQueue = Promise.resolve();
        this.terminal.onData((data) => {
            const token = this._connectToken;
            // xterm が自然に '\r' を発火した場合はタイマー補完をキャンセルする
            if (data === '\r' && this._imePostEnterPending) {
                this._imePostEnterPending = false;
                clearTimeout(this._imePostEnterTimer);
                ttcDebug('[TTC-PROBE][onData] IME post-Enter: natural \\r arrived, timer cancelled');
            }
            if (this._isImeCommitText(data)) {
                this._setImeComposing(false, { settleCursor: true });
            }
            ttcDebug('[TTC-PROBE][onData] fired', {
                len: data.length,
                preview: data.slice(0, 20),
                token,
                currentToken: this._connectToken,
                mode: this.status.mode,
                isFocused: this.status.isFocused,
                activeEl: document.activeElement?.tagName + (document.activeElement?.className ? '.' + document.activeElement.className.split(' ')[0] : '')
            });
            const enqueueAt = performance.now();
            this._inputQueue = this._inputQueue
                .then(() => {
                    const resumedAt = performance.now();
                    ttcDebug('[TTC-PROBE][onData] chain resumed', {
                        len: data.length,
                        waitMs: Math.round(resumedAt - enqueueAt),
                        capturedToken: token,
                        currentToken: this._connectToken
                    });
                    if (this._connectToken !== token) {
                        ttcWarn('[TTC-PROBE][onData] DROPPED token mismatch', {
                            len: data.length,
                            preview: data.slice(0, 20),
                            capturedToken: token,
                            currentToken: this._connectToken
                        });
                        inputTelemetry.dropped('INPUT_QUEUE_TOKEN_MISMATCH', { len: data.length });
                        return;
                    }
                    return this.sendText(data);
                })
                .catch((err) => {
                    console.error('[TTC-PROBE][onData] chain error', err);
                    inputTelemetry.dropped('INPUT_QUEUE_CHAIN_ERROR', { err: String(err?.message || err) });
                });
        });
        this.terminal.onResize(({ cols, rows }) => {
            // Skip bad dimensions that occur when the container is hidden or during layout transitions
            if (cols < 40 || rows < 10) return;
            void this.resize(cols, rows);
        });
        this.terminal.onScroll(() => {
            this._handleTerminalScroll();
        });
        this.hostEl.addEventListener('focusin', (e) => {
            this.status.isFocused = true;
            ttcDebug('[TTC-PROBE][focus] focusin', { target: e.target?.tagName, mode: this.status.mode });
            this._emitStatus();
        });
        // hostEl 配下の keydown を capture で監視。onData が来ない時にキーが届いているか確認する。
        // xterm.js 5.x: IME確定Enter(isComposing=true)の後に来るbare Enter(isComposing=false)を
        // xtermが握り潰す場合がある。bare Enterを検知してタイマーで\rを補完する。
        // IME確定Enter自体では\rを送らない（確定だけで送信しない）。
        this.hostEl.addEventListener('keydown', (e) => {
            ttcDebug('[TTC-PROBE][hostEl-keydown]', {
                key: e.key.slice(0, 10),
                isComposing: e.isComposing,
                target: e.target?.tagName,
                activeEl: document.activeElement?.tagName
            });
            if (e.key === 'Enter' && e.isComposing) {
                this._imeJustCommittedWithEnter = true;
            }
            // bare Enter (isComposing=false) では常に rescue timer を仕掛ける。
            // xterm.js が IME 後の状態のまま \r を握り潰すケースが、IME confirm 直後だけ
            // でなく「過去にIMEを使った後に通常文字を打って最後にEnter」のシナリオでも
            // 起きるため、Enter は modifier 無しのときのみ常に保証する。
            // dedup (onData で natural \r が来ればタイマーキャンセル) で重複は防ぐ。
            // Shift/Ctrl/Alt/Meta+Enter は別の意味 (S-Enter等) なので除外。
            if (e.key === 'Enter' && !e.isComposing
                && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
                this._imeJustCommittedWithEnter = false;
                const capturedToken = this._connectToken;
                clearTimeout(this._imePostEnterTimer);
                this._imePostEnterPending = true;
                this._imePostEnterTimer = setTimeout(() => {
                    if (!this._imePostEnterPending) return;
                    if (this._connectToken !== capturedToken) {
                        this._imePostEnterPending = false;
                        inputTelemetry.dropped('IME_TIMER_TOKEN_MISMATCH', {});
                        return;
                    }
                    this._imePostEnterPending = false;
                    ttcDebug('[TTC-PROBE][hostEl-keydown] Enter rescue: sending \\r');
                    this._inputQueue = this._inputQueue.then(() => this.sendText('\r')).catch(() => {
                        inputTelemetry.dropped('INPUT_QUEUE_CHAIN_ERROR', { source: 'enter-rescue' });
                    });
                }, 50);
            }
        }, true);
        this.hostEl.addEventListener('focusout', (e) => {
            this.status.isFocused = false;
            this._setImeComposing(false);
            ttcDebug('[TTC-PROBE][focus] focusout', {
                target: e.target?.tagName,
                relatedTarget: e.relatedTarget?.tagName,
                mode: this.status.mode
            });
            this._emitStatus();
        });
        // ウィンドウが前面に戻った時、live セッションのフォーカスを復元する。
        // relatedTarget===undefined の focusout はウィンドウレベルのフォーカス喪失で発生し、
        // ブラウザは window.focus 後も textarea のフォーカスを自動復元しない。
        this._focusLostToIframe = false;
        this._windowBlurHandler = () => {
            this._focusLostToIframe = document.activeElement?.tagName === 'IFRAME';
            ttcDebug('[TTC-PROBE][window] blur, isFocused:', this.status.isFocused, 'mode:', this.status.mode, 'activeEl:', document.activeElement?.tagName, 'iframeCaused:', this._focusLostToIframe);
        };
        window.addEventListener('blur', this._windowBlurHandler);

        this._windowFocusHandler = () => {
            const wasIframeCaused = this._focusLostToIframe;
            this._focusLostToIframe = false;
            ttcDebug('[TTC-PROBE][window] focus, isFocused:', this.status.isFocused, 'mode:', this.status.mode, 'wasIframeCaused:', wasIframeCaused);
            if (!wasIframeCaused && !this.status.isFocused && (this.status.mode === 'live' || this.status.mode === 'waiting')) {
                ttcDebug('[TTC-PROBE][window] refocusing terminal');
                this.terminal?.focus();
            }
        };
        window.addEventListener('focus', this._windowFocusHandler);
        // xterm canvas / container クリック時も確実に textarea にフォーカスを渡す。
        // xterm.js は内部で処理するはずだが、overlay 等で届かない場合の保険。
        this._hostPointerFocusHandler = () => {
            const hadDomFocus = this.hasDomFocus();
            ttcDebug('[TTC-PROBE][focus-recovery] host interaction, focusing terminal', {
                statusFocused: this.status.isFocused,
                hadDomFocus,
                activeEl: document.activeElement?.tagName
            });
            this.terminal?.focus();
        };
        this.hostEl.addEventListener('pointerdown', this._hostPointerFocusHandler, true);
        this.hostEl.addEventListener('click', this._hostPointerFocusHandler);
        this._attachScrollHandlers();

        this._resizeHandler = () => {
            // Skip fit when host element has no usable height (e.g. panel is hidden during file viewer)
            if (this.hostEl) {
                const rect = this.hostEl.getBoundingClientRect();
                if (rect.height < 50 || rect.width < 100) return;
            }
            void this.syncViewportSize();
        };
        window.addEventListener('resize', this._resizeHandler);
        this._setupHostResizeObserver();

        this._visibilityHandler = () => {
            if (document.hidden) {
                if (this.ws?.readyState === WebSocket.OPEN) {
                    this._hiddenDisconnect = true;
                    this.disconnect({ preserveView: true });
                    this._manualClose = false;
                }
                return;
            }

            if (this._hiddenDisconnect && this.sessionId) {
                this._hiddenDisconnect = false;
                void this.connect(this.sessionId).catch(() => {});
            }
        };
        document.addEventListener('visibilitychange', this._visibilityHandler);
    }

    destroy() {
        this._stopKeepalive();
        this.disconnect();
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
            this._resizeHandler = null;
        }
        this._teardownHostResizeObserver();
        if (this._visibilityHandler) {
            document.removeEventListener('visibilitychange', this._visibilityHandler);
            this._visibilityHandler = null;
        }
        if (this._windowBlurHandler) {
            window.removeEventListener('blur', this._windowBlurHandler);
            this._windowBlurHandler = null;
        }
        if (this._windowFocusHandler) {
            window.removeEventListener('focus', this._windowFocusHandler);
            this._windowFocusHandler = null;
        }
        if (this._hostPointerFocusHandler) {
            this.hostEl?.removeEventListener('pointerdown', this._hostPointerFocusHandler, true);
            this.hostEl?.removeEventListener('click', this._hostPointerFocusHandler);
            this._hostPointerFocusHandler = null;
        }
        if (this._boundPasteHandler) {
            this.hostEl?.removeEventListener('paste', this._boundPasteHandler, true);
            this._boundPasteHandler = null;
        }
        this._detachScrollHandlers();
        this._cancelTerminalRenderRefresh();
        this._clearPendingFocusEscape();
        this._removeCursorDebugPanel();
        try { this._webglAddon?.dispose(); } catch (e) { /* noop */ }
        this._webglAddon = null;
        this.terminal?.dispose();
        this.terminal = null;
        this.fitAddon = null;
    }

    _setupHostResizeObserver() {
        this._teardownHostResizeObserver();
        if (!this.hostEl || typeof ResizeObserver === 'undefined') return;
        const rect = this.hostEl.getBoundingClientRect();
        this._lastObservedHostWidth = Math.round(rect.width || 0);
        this._lastObservedHostHeight = Math.round(rect.height || 0);
        this._hostResizeObserver = new ResizeObserver((entries) => {
            const entry = Array.isArray(entries)
                ? entries.find((item) => item.target === this.hostEl) || entries[0]
                : null;
            const contentRect = entry?.contentRect || this.hostEl?.getBoundingClientRect?.();
            if (!contentRect) return;
            this._handleHostResize(contentRect);
        });
        this._hostResizeObserver.observe(this.hostEl);
    }

    _teardownHostResizeObserver() {
        if (this._hostResizeObserver) {
            this._hostResizeObserver.disconnect();
            this._hostResizeObserver = null;
        }
        if (this._hostResizeRaf != null) {
            if (typeof cancelAnimationFrame === 'function' && typeof this._hostResizeRaf === 'number') {
                cancelAnimationFrame(this._hostResizeRaf);
            } else {
                clearTimeout(this._hostResizeRaf);
            }
            this._hostResizeRaf = null;
        }
    }

    _handleHostResize(rect) {
        const width = Math.round(Number(rect.width) || 0);
        const height = Math.round(Number(rect.height) || 0);
        if (width < 100 || height < 50) return;
        if (width === this._lastObservedHostWidth && height === this._lastObservedHostHeight) return;
        this._lastObservedHostWidth = width;
        this._lastObservedHostHeight = height;
        this._scheduleHostResizeSync();
    }

    _scheduleHostResizeSync() {
        if (this._hostResizeRaf != null) return;
        const run = () => {
            this._hostResizeRaf = null;
            void this.syncViewportSize();
        };
        this._hostResizeRaf = typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame(run)
            : setTimeout(run, 16);
    }

    getStatus() {
        return { ...this.status, reconnectAttempts: this._retryCount };
    }

    isActiveForSession(sessionId) {
        return this.sessionId === sessionId && (this.status.mode === 'live' || this.status.mode === 'snapshot' || this.status.mode === 'blocked');
    }

    _isCurrentAppSession(sessionId = this.sessionId) {
        if (!this.getCurrentSessionId) return true;
        const currentSessionId = this.getCurrentSessionId();
        return !currentSessionId || currentSessionId === sessionId;
    }

    canSendInput(sessionId) {
        return this.sessionId === sessionId
            && this._isCurrentAppSession(sessionId)
            && this.status.mode !== 'blocked'
            && this.status.terminalAccess?.state === 'owner'
            && this.status.inputReady === true
            && this.ws?.readyState === WebSocket.OPEN;
    }

    _canDispatchInputForOwnershipReclaim(sessionId) {
        return this.sessionId === sessionId
            && this._isCurrentAppSession(sessionId)
            && this.status.mode === 'live'
            && this.status.terminalAccess?.state === 'available'
            && this.status.inputReady === true
            && this.ws?.readyState === WebSocket.OPEN;
    }

    isBlockedForSession(sessionId) {
        return this.sessionId === sessionId
            && (this.status.mode === 'blocked' || this.status.blockedAccess?.state === 'blocked');
    }

    show() {
        this.hostEl?.classList.remove('hidden');
    }

    hide() {
        this.hostEl?.classList.add('hidden');
    }

    focus() {
        if (typeof this.terminal?.focus === 'function') {
            this.terminal.focus();
        }
        this.status.isFocused = true;
        this._emitStatus();
    }

    hasDomFocus() {
        if (typeof document === 'undefined' || !this.hostEl) return false;
        const activeEl = document.activeElement;
        if (!activeEl) return false;
        return this.hostEl.contains(activeEl);
    }

    _handleCustomKeyEvent(event) {
        if (!event || event.type !== 'keydown') return true;

        if (event.key === 'Enter' && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
            void this.sendKey('S-Enter');
            if (typeof event.preventDefault === 'function') {
                event.preventDefault();
            }
            return false;
        }

        // Ctrl+L (clear screen, 0x0c). Browsers hijack Ctrl+L to focus the address bar, so the key
        // never reaches the pty and apps like Claude Code don't clear. Send \f explicitly and
        // preventDefault so it works inside the terminal.
        if ((event.key === 'l' || event.key === 'L')
            && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
            void this.sendText('\x0c');
            if (typeof event.preventDefault === 'function') {
                event.preventDefault();
            }
            return false;
        }

        return true;
    }

    _handlePasteEvent(event) {
        const text = event?.clipboardData?.getData?.('text/plain') || '';
        if (!text) return;
        if (typeof event.preventDefault === 'function') {
            event.preventDefault();
        }
        if (typeof event.stopPropagation === 'function') {
            event.stopPropagation();
        }
        const token = this._connectToken;
        this._inputQueue = this._inputQueue
            .then(() => {
                if (this._connectToken !== token) {
                    inputTelemetry.dropped('PASTE_QUEUE_TOKEN_MISMATCH', { len: text.length });
                    return;
                }
                return this.sendPasteText(text);
            })
            .catch((err) => {
                console.error('[TTC-PROBE][paste] chain error', err);
                inputTelemetry.dropped('INPUT_QUEUE_CHAIN_ERROR', { source: 'paste', err: String(err?.message || err) });
            });
    }

    async connect(sessionId, {
        skipInitialResize = false,
        waitForInitialResetSnapshot = false,
        initialResetSnapshotTimeoutMs = INITIAL_RESET_SNAPSHOT_WAIT_MS
    } = {}) {
        // A still-pending connect() from a previous call must settle now. Its
        // CONNECT_TIMEOUT_MS guard is gated on _connectToken; once we bump the token below,
        // that guard no-ops and the old promise would hang forever — the awaiting
        // switchSession -> _connectXtermTransport never returns (observed >5min frozen
        // snapshot). Reject it as superseded so the existing snapshot_fallback path runs.
        if (this._supersedeConnect) {
            const supersede = this._supersedeConnect;
            this._supersedeConnect = null;
            supersede();
        }
        const connectStartedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const switchingSessions = Boolean(this.sessionId && this.sessionId !== sessionId);
        const prevToken = this._connectToken;
        this._connectToken += 1;
        const connectToken = this._connectToken;
        ttcWarn('[TTC-PROBE] connectToken++', {
            from: prevToken,
            to: connectToken,
            switchingSessions,
            fromSession: this.sessionId,
            toSession: sessionId
        });
        this._manualClose = false;
        // セッション切り替え前に未送信バッファを同期的に送信する。
        // _flushBufferedTextはawaitなしだとthis.sessionId更新後に_dispatchTextMessageが走り
        // canSendInputチェックが新セッション文脈で失敗してバッファ内容が消える。
        const bufferedBeforeSwitch = this._drainBufferedText();
        if (bufferedBeforeSwitch) {
            if (this.ws?.readyState === WebSocket.OPEN && this.canSendInput(this.sessionId)) {
                this.ws.send(JSON.stringify({ type: 'input', inputType: 'text', value: bufferedBeforeSwitch }));
                ttcDebug('[TTC-PROBE] connect drain flushed', { len: bufferedBeforeSwitch.length });
            } else {
                ttcWarn('[TTC-PROBE] connect drain DROPPED', {
                    len: bufferedBeforeSwitch.length,
                    preview: bufferedBeforeSwitch.slice(0, 40),
                    wsState: this.ws?.readyState,
                    canSend: this.canSendInput(this.sessionId),
                    mode: this.status.mode,
                    inputReady: this.status.inputReady
                });
                inputTelemetry.dropped('CONNECT_DRAIN_DROPPED', { len: bufferedBeforeSwitch.length });
            }
        }
        this.sessionId = sessionId;
        this.status.mode = 'reconnecting';
        this.status.connected = false;
        this.status.blockedAccess = null;
        this.status.terminalAccess = null;
        this.status.inputReady = false;
        this.status.runtimeState = 'transport_connected';
        this.status.transport = 'streaming';
        this._emitStatus();
        this._resetTerminalOnNextSnapshot = true;

        this._clearReconnectTimer();
        this._closeWs();

        // 再接続時もsnapshot状態をリセット。ただし同一セッションのhidden復帰では
        // 未確認のlocal echoを保持する。ここで消すと復帰直後のeager snapshotが
        // まだtmux snapshotに反映されていない入力表示を上書きして消す。
        this._lastSnapshotText = null;
        this._pendingSnapshotText = null;
        this._pendingSnapshotOptions = null;
        this._deferredSnapshotWhileEchoPending = null;
        if (switchingSessions) {
            this._clearPendingEchoState();
        }

        if (switchingSessions) {
            this._prepareForSessionSwitch();
        }

        // Fire-and-forget: `_ensureAuthenticated()` is a best-effort GET /api/auth/verify whose
        // result is DISCARDED (it swallows its own errors), and the WS upgrade handler does its
        // own auth. Awaiting it added ~847ms (median) of pure dead-weight latency to EVERY session
        // switch's connect critical path. Run it without blocking — verify still fires (any
        // server-side side-effect is preserved) but the WS connect no longer waits on it.
        void this._ensureAuthenticated();

        // When skipInitialResize is true (element hidden), don't measure — wrong dimensions
        // would resize the tmux pane to ~1 column. syncViewportSize() handles it after showing.
        const initialDimensions = skipInitialResize ? null : this._measureViewport();
        const wsUrl = this._buildWsUrl(sessionId, initialDimensions);
        const ws = new WebSocket(wsUrl);
        this.ws = ws;

        return await new Promise((resolve, reject) => {
            let readyReceived = false;
            let connectSettled = false;
            let initialResetSnapshotApplied = false;
            let initialResetSnapshotTimerId = null;

            // Publish a timing + outcome metric on every settle so the connect phase — the
            // black hole where switches used to hang invisibly — is observable.
            const recordConnectMetric = (outcome) => {
                const endedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
                this._lastConnectMetric = {
                    outcome,
                    durationMs: Math.round(endedAt - connectStartedAt),
                    sessionId,
                    token: connectToken,
                    switchingSessions
                };
                try { this.onConnectMetric?.(this._lastConnectMetric); } catch { /* metric is best-effort */ }
            };

            // Superseded during our async auth gap: a newer connect() already bumped the
            // token before this executor ran. settle()'s token guard would strand us, so
            // reject straight away.
            if (this._connectToken !== connectToken) {
                connectSettled = true;
                recordConnectMetric('superseded');
                reject(new Error('Terminal transport connect superseded'));
                return;
            }

            const timeoutId = setTimeout(() => {
                if (this._connectToken !== connectToken) return;
                settle('reject', new Error('Terminal transport connect timeout'));
            }, CONNECT_TIMEOUT_MS);

            const cleanup = () => {
                clearTimeout(timeoutId);
                if (initialResetSnapshotTimerId != null) {
                    clearTimeout(initialResetSnapshotTimerId);
                    initialResetSnapshotTimerId = null;
                }
            };

            // Reject this pending connect when a later connect() supersedes it. Deliberately
            // bypasses settle()'s _connectToken guard — that guard is exactly what would
            // otherwise leave this promise unsettled forever.
            this._supersedeConnect = () => {
                if (connectSettled) return;
                connectSettled = true;
                cleanup();
                recordConnectMetric('superseded');
                reject(new Error('Terminal transport connect superseded'));
            };

            const settle = (type, value) => {
                if (connectSettled || this._connectToken !== connectToken) return;
                connectSettled = true;
                this._supersedeConnect = null;
                cleanup();
                if (type === 'reject') {
                    recordConnectMetric(/timeout/i.test(value?.message) ? 'timeout' : 'error');
                    reject(value);
                    return;
                }
                recordConnectMetric(value?.mode || 'resolved');
                resolve(value);
            };
            const maybeResolveLive = (initialResetSnapshot = null) => {
                if (!readyReceived) return;
                if (!waitForInitialResetSnapshot || initialResetSnapshotApplied) {
                    settle('resolve', initialResetSnapshot
                        ? { mode: 'live', initialResetSnapshot }
                        : { mode: 'live' });
                    return;
                }
                if (initialResetSnapshotTimerId != null) return;
                const timeoutMs = Number.isFinite(initialResetSnapshotTimeoutMs)
                    ? Math.max(0, initialResetSnapshotTimeoutMs)
                    : INITIAL_RESET_SNAPSHOT_WAIT_MS;
                initialResetSnapshotTimerId = setTimeout(() => {
                    if (this._connectToken !== connectToken) return;
                    settle('resolve', { mode: 'live', initialResetSnapshot: 'timeout' });
                }, timeoutMs);
            };
            const markInitialResetSnapshotApplied = () => {
                if (initialResetSnapshotApplied) return;
                initialResetSnapshotApplied = true;
                maybeResolveLive('applied');
            };

            ws.addEventListener('message', (event) => {
                if (this._connectToken !== connectToken) return;
                const message = this._parseMessage(event.data);
                if (!message) return;

                switch (message.type) {
                    case 'ready':
                        readyReceived = true;
                        this._retryCount = 0;
                        this.status.mode = 'live';
                        this.status.connected = true;
                        this._applyRuntimeStatus(message);
                        ttcDebug('[TTC] ready received');
                        this._emitStatus();
                        this._startKeepalive();
                        void this.syncViewportSize();
                        if (typeof requestAnimationFrame === 'function') {
                            requestAnimationFrame(() => void this.syncViewportSize());
                        }
                        void this.verifyInputReady().then(() => {
                            this._flushMessageQueue();
                        });
                        maybeResolveLive();
                        break;
                    case 'snapshot': {
                        const snapshotLen = (message.colorText || message.text || '').length;
                        ttcDebug(`[TTC] snapshot received: len=${snapshotLen}, connected=${this.status.connected}`);
                        const resolvesInitialResetSnapshot = waitForInitialResetSnapshot && this._resetTerminalOnNextSnapshot;
                        this._queueOrApplySnapshot(message.colorText || message.text || '', message.cursor || null, {
                            plainText: message.text || '',
                            visibleText: message.visibleColorText || message.visibleText || null,
                            visiblePlainText: message.visibleText || null,
                            screenOnly: message.screenOnly === true,
                            afterWrite: resolvesInitialResetSnapshot ? markInitialResetSnapshotApplied : null
                        });
                        this.status.lastSnapshotAt = message.capturedAt || new Date().toISOString();
                        if (!this.status.connected) {
                            this.status.mode = 'snapshot';
                            this.status.transport = 'snapshot';
                        }
                        this._emitStatus();
                        break;
                    }
                    case 'output': {
                        const outputData = typeof message.data === 'string' ? message.data : '';
                        // One-shot after a session-switch snapshot, before the first live
                        // output. Clear the SCROLLBACK only (\x1b[3J) — the original intent
                        // (prevent a shorter repaint leaving ghost rows below). Do NOT clear
                        // the visible screen or home the cursor (\x1b[2J / \x1b[H), and do NOT
                        // terminal.reset():
                        //   - The snapshot preview established the visible frame AND the cursor
                        //     position. An interactive TUI's first live output is a RELATIVE-
                        //     cursor redraw (e.g. \x1b[2D\x1b[6B...), which can only reconstruct
                        //     the frame if that frame + cursor are still there. \x1b[2J\x1b[3J\x1b[H
                        //     wiped them, so the relative redraw produced a near-blank/garbled
                        //     screen (the reported "描画が重複/空白"); #911's reset() also exited
                        //     the alternate screen and blanked it.
                        //   - A full-repaint app emits its own clear (\x1b[2J / \x1b[H), so
                        //     \x1b[3J before it is safe — it cannot leave ghost rows.
                        // Disarm on the FIRST output message regardless of whether it carries
                        // data: \x1b[3J (scrollback only) is benign on an empty repaint, so this
                        // avoids the stale-flag leak where an empty first output would defer the
                        // one-shot onto a later, unrelated output.
                        // Verified deterministically against a captured real handoff byte stream
                        // (tests/unit/terminal-snapshot-handoff.test.js): \x1b[2J\x1b[3J\x1b[H ->
                        // 1 non-empty line, \x1b[3J -> 13 (≈ the 12-line snapshot frame); plus
                        // a full-repaint case (its own \x1b[2J wins) and an empty-first-output case.
                        if (this._liveResetPendingAfterSnapshot) {
                            this._liveResetPendingAfterSnapshot = false;
                            this._writeToTerminal('\x1b[3J');
                        }
                        this._applyOutput(outputData);
                        break;
                    }
                    case 'status':
                        this._applyRuntimeStatus(message);
                        this.status.copyMode = Boolean(message.copyMode);
                        if (typeof message.mode === 'string') {
                            this.status.mode = message.mode;
                            this.status.connected = message.mode === 'live';
                        }
                        if (typeof message.transport === 'string') {
                            this.status.transport = message.transport;
                        }
                        this._emitStatus();
                        break;
                    case 'blocked':
                        this.status.mode = 'blocked';
                        this.status.blockedAccess = message.terminalAccess || null;
                        this.status.terminalAccess = message.terminalAccess || null;
                        this.status.inputReady = false;
                        this.status.runtimeState = 'blocked_by_owner';
                        this.status.connected = false;
                        this.status.transport = 'snapshot';
                        this._emitStatus();
                        settle('resolve', { mode: 'blocked', terminalAccess: message.terminalAccess || null });
                        break;
                    case 'error': {
                        this._manualClose = true;
                        const error = /** @type {Error & { code?: string }} */ (new Error(message.message || 'Terminal transport error'));
                        error.code = message.code || 'TERMINAL_TRANSPORT_ERROR';
                        settle('reject', error);
                        break;
                    }
                    default:
                        break;
                }
            });

            ws.addEventListener('close', (closeEvent) => {
                const closeCode = closeEvent?.code;
                ttcWarn('[TTC-PROBE] ws close', {
                    code: closeCode,
                    reason: closeEvent?.reason,
                    wasClean: closeEvent?.wasClean,
                    pendingBufferLen: this._pendingTextBuffer.length,
                    pendingBufferPreview: this._pendingTextBuffer.slice(0, 40),
                    messageQueueSize: this._messageQueue.size(),
                    mode: this.status.mode,
                    inputReady: this.status.inputReady,
                    manualClose: this._manualClose,
                    sessionId: this.sessionId
                });
                ttcDebug(`[TTC] ws close: code=${closeCode}, stale=${this._connectToken !== connectToken}`);
                if (this._connectToken !== connectToken || this.ws !== ws) {
                    cleanup();
                    return;
                }
                cleanup();
                this._stopKeepalive();
                this.status.connected = false;

                // 4001 = ownership taken over: treat as blocked even if blocked message was missed
                if (closeCode === WS_CLOSE_BLOCKED) {
                    this.status.mode = 'blocked';
                } else if (this.status.mode !== 'blocked') {
                    this.status.mode = this.status.lastSnapshotAt ? 'snapshot' : 'disconnected';
                }
                this._emitStatus();

                const isExpected = closeCode != null && this._isExpectedClose(closeCode);

                if (!this._manualClose && !isExpected && this.sessionId === sessionId && this.status.mode !== 'blocked') {
                    void this._refreshSnapshot({ preserveMode: true });
                    this._scheduleReconnect(sessionId);
                }
            }, { once: true });

            ws.addEventListener('error', () => {
                cleanup();
            }, { once: true });
        });
    }

    disconnect({ preserveView = false } = {}) {
        this._manualClose = true;
        this._clearReconnectTimer();
        this._stopKeepalive();
        // closeWs前に同期送信（非同期flushだとclose後に実行されてデータが消える）
        const bufferedOnDisconnect = this._drainBufferedText();
        if (bufferedOnDisconnect && this.ws?.readyState === WebSocket.OPEN && this.canSendInput(this.sessionId)) {
            this.ws.send(JSON.stringify({ type: 'input', inputType: 'text', value: bufferedOnDisconnect }));
        } else if (bufferedOnDisconnect) {
            inputTelemetry.dropped('DISCONNECT_BUFFER_DRAINED', {
                len: bufferedOnDisconnect.length,
                wsState: this.ws?.readyState
            });
        }
        const queuedBeforeClear = this._messageQueue.size?.() ?? 0;
        if (queuedBeforeClear > 0) {
            inputTelemetry.dropped('DISCONNECT_QUEUE_CLEARED', { count: queuedBeforeClear });
        }
        this._messageQueue.clear();
        this._clearPendingFocusEscape();
        this._closeWs();
        this.status.connected = false;
        this.status.copyMode = false;
        // セッション切り替え時は次接続で必ずresizeを送る（新セッションは別tmuxウィンドウ）
        this._lastSentCols = 0;
        this._lastSentRows = 0;
        if (!preserveView) {
            this.status.mode = 'idle';
            this.status.lastSnapshotAt = null;
            this.status.blockedAccess = null;
            this.status.terminalAccess = null;
            this.status.inputReady = false;
            this.status.runtimeState = 'stopped';
            this.status.transport = 'snapshot';
            this._pendingSnapshotText = null;
            this._pendingSnapshotOptions = null;
            this._clearPendingEchoState();
            this._isViewportPinnedToBottom = true;
            this._lastSnapshotText = null;
            this._cancelTerminalWriteQueue();
            this.terminal?.reset();
        }
        this._emitStatus();
    }

    async sendText(value) {
        value = await this._resolvePotentialFocusEscape(value);
        if (!value) return;
        const sanitizedValue = stripTerminalControlResponses(value);
        if (!sanitizedValue && value) {
            inputTelemetry.dropped('TERMINAL_CONTROL_RESPONSE', { len: value.length });
            return;
        }
        value = sanitizedValue;
        if (value === '\x1b' && !this._pendingTextBuffer) {
            this._schedulePotentialFocusEscape();
            return;
        }
        const capturedToken = this._connectToken;
        const capturedSessionId = this.sessionId;
        if (!this._isCurrentAppSession(capturedSessionId)) {
            ttcWarn('[TTC-PROBE] sendText dropped: stale app session', {
                len: value.length,
                clientSessionId: capturedSessionId,
                currentSessionId: this.getCurrentSessionId?.()
            });
            inputTelemetry.dropped('STALE_APP_SESSION', { len: value.length });
            return;
        }
        ttcDebug('[TTC-PROBE][sendText] entered', {
            len: value?.length,
            canSend: this.canSendInput(this.sessionId),
            mode: this.status.mode,
            inputReady: this.status.inputReady,
            isNavKey: this._isNavigationEscape(value),
            bypassProbe: this._canBypassInputReadyProbe(value)
        });
        if (!value) return;
        inputTelemetry.inc('appended');
        const segments = this._splitFocusEvents(value);
        // probe 前にローカルエコーを適用して視覚フィードバックを即時にする。
        // probe が 300ms 以上かかる場合でもユーザーは自分の入力が見える。
        // probe 失敗 (drop) 時はエコーが残るが稀なケースなので許容する。
        for (const seg of segments) {
            if (!seg.isFocusEvent) {
                this._applyLocalEcho(seg.value);
            }
        }
        // 矢印・Tab・Escape・Function key 等のナビゲーション系 escape sequence は
        // probe を待たずに送信する。Codex の選択画面 (CLI state が READY/WAITING にならない)
        // などで矢印が効かなくなる問題を回避。
        const skipProbe = this._canBypassInputReadyProbe(value);
        if (!skipProbe
            && !this.canSendInput(this.sessionId)
            && !this._canDispatchInputForOwnershipReclaim(this.sessionId)
        ) {
            ttcDebug('[TTC-PROBE][sendText] probe needed (canSendInput=false)');
            const probeStart = performance.now();
            const ok = await this._ensureInputReadyForUserInput();
            const probeMs = Math.round(performance.now() - probeStart);
            ttcDebug('[TTC-PROBE][sendText] probe returned', { ok, probeMs });
            // probe 中にセッション切り替えが発生した場合は別セッションに誤送しない。
            if (this._connectToken !== capturedToken || this.sessionId !== capturedSessionId) {
                ttcWarn('[TTC-PROBE] sendText dropped: session changed during probe', {
                    capturedToken, currentToken: this._connectToken,
                    capturedSession: capturedSessionId, currentSession: this.sessionId
                });
                inputTelemetry.dropped('SEND_TEXT_SESSION_CHANGED', { len: value.length });
                void this._refreshSnapshot({ preserveMode: true });
                return;
            }
            if (!ok) {
                // 再接続中・blocked等で probe が失敗した場合、即dropせず messageQueue に積む。
                // 再接続完了 (ready msg) で _flushMessageQueue が走り、順序維持で送信される。
                // これにより 'reconnecting' 中の paste / typing が消失するバグを防ぐ。
                const isRecoverable = this.status.mode === 'reconnecting'
                    || this.ws?.readyState !== WebSocket.OPEN
                    || this.status.terminalAccess?.state === 'owner';
                if (isRecoverable && this.sessionId === capturedSessionId
                    && this._connectToken === capturedToken) {
                    const message = { type: 'input', inputType: 'text', value };
                    this._messageQueue.enqueue(message);
                    inputTelemetry.inc('queued');
                    ttcWarn('[TTC-PROBE] sendText queued (probe failed, will flush on reconnect)', {
                        len: value.length,
                        mode: this.status.mode,
                        inputReady: this.status.inputReady,
                        owner: this.status.terminalAccess?.state,
                        wsState: this.ws?.readyState,
                        queueSize: this._messageQueue.size?.() ?? 0
                    });
                    return;
                }
                ttcWarn('[TTC-PROBE] sendText dropped: canSendInput=false after ensure', {
                    len: value.length,
                    mode: this.status.mode,
                    inputReady: this.status.inputReady,
                    owner: this.status.terminalAccess?.state,
                    wsState: this.ws?.readyState,
                    sessionId: this.sessionId
                });
                inputTelemetry.dropped('SEND_TEXT_PROBE_FAILED', {
                    len: value.length,
                    mode: this.status.mode,
                    inputReady: this.status.inputReady
                });
                inputTelemetry.inc('ghostEcho');
                // ゴーストエコーを pty スナップショットで上書きしてクリアする。
                // preserveMode:true で mode を 'live' から 'snapshot' に変えない。
                void this._refreshSnapshot({ preserveMode: true });
                return;
            }
        }
        ttcDebug('[TTC-PROBE] sendText accepted', {
            len: value.length,
            pendingBefore: this._pendingTextBuffer.length,
            mode: this.status.mode,
            wsState: this.ws?.readyState
        });

        for (const seg of segments) {
            if (seg.isFocusEvent) {
                await this._flushBufferedText({ enqueueIfUnavailable: true });
                await this._dispatchTextMessage(seg.value, { enqueueIfUnavailable: true });
                continue;
            }
            // local echo は sendText 先頭で適用済みのためスキップ

            if (this._shouldSendTextImmediately(seg.value)) {
                const allowInputNotReady = this._isControlTextInput(seg.value);
                await this._flushBufferedText({
                    enqueueIfUnavailable: true,
                    allowInputNotReady
                });
                if (this._hasSubmitText(seg.value)) {
                    this._applySubmitFeedback(seg.value);
                }
                await this._dispatchTextMessage(seg.value, {
                    enqueueIfUnavailable: true,
                    allowInputNotReady
                });
                continue;
            }

            this._pendingTextBuffer += seg.value;
            this._scheduleBufferedTextFlush();
        }
    }

    async sendPasteText(value) {
        const sanitizedValue = stripTerminalControlResponses(value);
        if (!sanitizedValue && value) {
            inputTelemetry.dropped('TERMINAL_CONTROL_RESPONSE', { len: value.length, source: 'paste' });
            return;
        }
        const text = sanitizedValue;
        if (!text) return;
        if (!this._hasSubmitText(text)) {
            await this.sendText(text);
            return;
        }

        await this._flushBufferedText({ enqueueIfUnavailable: true, ensureInteractive: true });
        await this._dispatchPasteMessage(text);
    }

    async sendKey(value) {
        if (!value) return;
        if (!this.canSendInput(this.sessionId) && !this._canSendControlKey(value) && !await this._ensureInputReadyForUserInput()) {
            inputTelemetry.dropped('SEND_KEY_NOT_READY', { value });
            return;
        }
        await this._flushBufferedText({ enqueueIfUnavailable: true, ensureInteractive: true });
        const message = { type: 'input', inputType: 'key', value };
        if (this.ws?.readyState !== WebSocket.OPEN) {
            this._messageQueue.enqueue(message);
            inputTelemetry.inc('queued');
            return;
        }
        await this._ensureInteractiveMode();
        this.ws.send(JSON.stringify(message));
        inputTelemetry.inc('sentOk');
    }

    /**
     * セッション中断（CommandMateのInterruptButtonパターン）
     * AI処理中にCtrl+Cを送信して中断する
     */
    async interrupt() {
        await this._flushBufferedText({ enqueueIfUnavailable: true, ensureInteractive: true });
        if (!this.canSendInput(this.sessionId) && !this._canSendControlKey('C-c')) {
            inputTelemetry.dropped('SEND_KEY_NOT_READY', { value: 'C-c (interrupt)' });
            return;
        }
        if (this.ws?.readyState !== WebSocket.OPEN) {
            inputTelemetry.dropped('INTERRUPT_WS_CLOSED', { wsState: this.ws?.readyState });
            return;
        }
        await this._ensureInteractiveMode();
        this.ws.send(JSON.stringify({
            type: 'input',
            inputType: 'key',
            value: 'C-c'
        }));
    }

    async scroll(direction, steps = 1) {
        if (this.ws?.readyState !== WebSocket.OPEN) return;
        if (this.status.terminalAccess?.state !== 'owner') return;
        const safeDirection = direction === 'down' ? 'down' : direction === 'up' ? 'up' : null;
        if (!safeDirection) return;
        const safeSteps = Math.min(MAX_SCROLL_STEPS, Math.max(1, Number(steps) || 1));
        this.ws.send(JSON.stringify({
            type: 'scroll',
            direction: safeDirection,
            steps: safeSteps
        }));
        this.status.copyMode = true;
        this._emitStatus();
    }

    _attachScrollHandlers() {
        if (!this.hostEl || this._boundWheelHandler) return;

        this._boundWheelHandler = (event) => {
            if (!this._shouldInterceptTmuxScroll(event.target)) return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            this._queueWheelDelta(event.deltaY || 0);
        };
        this._boundTouchStartHandler = (event) => {
            if (!event.touches || event.touches.length !== 1) return;
            this._lastTouchY = event.touches[0].clientY;
            this._touchDelta = 0;
        };
        this._boundTouchMoveHandler = (event) => {
            if (!this._shouldInterceptTmuxScroll(event.target)) return;
            if (!event.touches || event.touches.length !== 1) return;
            const currentY = event.touches[0].clientY;
            const previousY = this._lastTouchY;
            this._lastTouchY = currentY;
            if (!Number.isFinite(previousY)) return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
            this._queueTouchDelta(currentY - previousY);
        };
        this._boundTouchEndHandler = () => {
            this._lastTouchY = null;
            this._touchDelta = 0;
            if (this._touchFlushTimer) {
                clearTimeout(this._touchFlushTimer);
                this._touchFlushTimer = null;
            }
        };

        this.hostEl.addEventListener('wheel', this._boundWheelHandler, { passive: false, capture: true });
        this.hostEl.addEventListener('touchstart', this._boundTouchStartHandler, { passive: true, capture: true });
        this.hostEl.addEventListener('touchmove', this._boundTouchMoveHandler, { passive: false, capture: true });
        this.hostEl.addEventListener('touchend', this._boundTouchEndHandler, { passive: true, capture: true });
        this.hostEl.addEventListener('touchcancel', this._boundTouchEndHandler, { passive: true, capture: true });
    }

    _detachScrollHandlers() {
        if (!this.hostEl) return;
        if (this._boundWheelHandler) {
            this.hostEl.removeEventListener('wheel', this._boundWheelHandler, true);
            this._boundWheelHandler = null;
        }
        if (this._boundTouchStartHandler) {
            this.hostEl.removeEventListener('touchstart', this._boundTouchStartHandler, true);
            this._boundTouchStartHandler = null;
        }
        if (this._boundTouchMoveHandler) {
            this.hostEl.removeEventListener('touchmove', this._boundTouchMoveHandler, true);
            this._boundTouchMoveHandler = null;
        }
        if (this._boundTouchEndHandler) {
            this.hostEl.removeEventListener('touchend', this._boundTouchEndHandler, true);
            this.hostEl.removeEventListener('touchcancel', this._boundTouchEndHandler, true);
            this._boundTouchEndHandler = null;
        }
        if (this._wheelFlushTimer) {
            clearTimeout(this._wheelFlushTimer);
            this._wheelFlushTimer = null;
        }
        if (this._touchFlushTimer) {
            clearTimeout(this._touchFlushTimer);
            this._touchFlushTimer = null;
        }
        this._wheelDelta = 0;
        this._touchDelta = 0;
        this._lastTouchY = null;
    }

    _shouldInterceptTmuxScroll(target) {
        if (this.status.mode !== 'live') return false;
        if (this.status.terminalAccess?.state !== 'owner') return false;
        if (!this._isAlternateBufferActive()) return false;
        return !target || !this.hostEl || this.hostEl.contains(target);
    }

    _isAlternateBufferActive() {
        const terminal = this.terminal;
        try {
            return Boolean(
                terminal
                && terminal.buffer
                && terminal.buffer.alternate
                && terminal.buffer.active === terminal.buffer.alternate
            );
        } catch {
            return false;
        }
    }

    _queueWheelDelta(delta) {
        if (!Number.isFinite(delta) || delta === 0) return;
        this._wheelDelta += delta;
        if (Math.abs(this._wheelDelta) < SCROLL_MIN_DELTA_PX) return;
        if (this._wheelFlushTimer) return;
        this._wheelFlushTimer = setTimeout(() => {
            this._wheelFlushTimer = null;
            const pendingDelta = this._wheelDelta;
            this._wheelDelta = 0;
            void this._flushScrollDelta(pendingDelta, {
                thresholdPx: SCROLL_STEP_PX,
                positiveDirection: 'down'
            });
        }, SCROLL_FLUSH_MS);
    }

    _queueTouchDelta(delta) {
        if (!Number.isFinite(delta) || delta === 0) return;
        this._touchDelta += delta;
        if (Math.abs(this._touchDelta) < TOUCH_STEP_PX) return;
        if (this._touchFlushTimer) return;
        this._touchFlushTimer = setTimeout(() => {
            this._touchFlushTimer = null;
            const pendingDelta = this._touchDelta;
            this._touchDelta = 0;
            void this._flushScrollDelta(pendingDelta, {
                thresholdPx: TOUCH_STEP_PX,
                positiveDirection: 'up'
            });
        }, TOUCH_FLUSH_MS);
    }

    async _flushScrollDelta(delta, { thresholdPx, positiveDirection }) {
        if (!Number.isFinite(delta) || delta === 0) return;
        const steps = Math.min(MAX_SCROLL_STEPS, Math.max(1, Math.round(Math.abs(delta) / thresholdPx)));
        const direction = delta > 0 ? positiveDirection : (positiveDirection === 'down' ? 'up' : 'down');
        await this.scroll(direction, steps);
    }

    async resize(cols, rows) {
        if (this.ws?.readyState !== WebSocket.OPEN) return;
        if (cols === this._lastSentCols && rows === this._lastSentRows) return;
        this._lastSentCols = cols;
        this._lastSentRows = rows;
        this.ws.send(JSON.stringify({
            type: 'resize',
            cols,
            rows
        }));
    }

    async syncViewportSize({ refresh = false } = {}) {
        const dims = this._measureViewport();
        if (!dims) return;
        await this.resize(dims.cols, dims.rows);
        if (refresh) {
            this.refreshVisibleRows();
        }
    }

    async restoreAfterReveal() {
        this.focus();
        await this.syncViewportSize({ refresh: true });
        const refreshAgain = () => {
            this.focus();
            this.refreshVisibleRows();
            void this.syncViewportSize({ refresh: true });
        };
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(refreshAgain);
        } else {
            setTimeout(refreshAgain, 0);
        }
    }

    refreshVisibleRows() {
        if (!this.terminal) return;
        const rows = Number(this.terminal.rows) || 0;
        if (rows <= 0) return;
        this._refreshTerminalRows(0, rows - 1);
    }

    _refreshTerminalRows(start, end) {
        if (!this.terminal) return;
        const rows = Number(this.terminal.rows) || 0;
        if (rows <= 0) return;
        const safeStart = Math.max(0, Math.min(rows - 1, Math.floor(start)));
        const safeEnd = Math.max(safeStart, Math.min(rows - 1, Math.floor(end)));
        try {
            if (typeof this.terminal.refresh === 'function') {
                this.terminal.refresh(safeStart, safeEnd);
                return;
            }
            const renderService = this.terminal?._core?._renderService;
            if (typeof renderService?.refreshRows === 'function') {
                renderService.refreshRows(safeStart, safeEnd);
            }
        } catch (error) {
            console.warn('[TerminalTransportClient] Failed to refresh terminal rows', error);
        }
    }

    _activateWebglRenderer(WebglAddon) {
        if (!WebglAddon || !this.terminal || this._webglAddon) return;
        try {
            const addon = new WebglAddon();
            // GPU context loss (tab backgrounded for long, driver reset, etc.): dispose the addon so
            // xterm transparently falls back to the DOM renderer instead of showing a dead canvas.
            if (typeof addon.onContextLoss === 'function') {
                addon.onContextLoss(() => {
                    try { addon.dispose(); } catch (e) { /* noop */ }
                    if (this._webglAddon === addon) this._webglAddon = null;
                });
            }
            this.terminal.loadAddon(addon);
            this._webglAddon = addon;
        } catch (error) {
            // No WebGL (software/blocked GPU, headless, etc.) — keep the default DOM renderer.
            this._webglAddon = null;
            ttcWarn('[TTC-PROBE] WebGL renderer unavailable, using DOM renderer', { err: String(error?.message || error) });
        }
    }

    _scheduleTerminalRenderRefresh(mode = 'bottom') {
        if (!this.terminal) return;
        if (mode === 'all' || this._pendingTerminalRenderRefreshMode !== 'all') {
            this._pendingTerminalRenderRefreshMode = mode === 'all' ? 'all' : 'bottom';
        }
        if (this._terminalRenderRefreshRaf != null) return;

        const run = () => {
            this._terminalRenderRefreshRaf = null;
            const refreshMode = this._pendingTerminalRenderRefreshMode || 'bottom';
            this._pendingTerminalRenderRefreshMode = null;
            const rows = Number(this.terminal?.rows) || 0;
            if (rows <= 0) return;
            if (refreshMode === 'all') {
                this._refreshTerminalRows(0, rows - 1);
                return;
            }
            const start = Math.max(0, rows - 12);
            this._refreshTerminalRows(start, rows - 1);
        };

        this._terminalRenderRefreshRaf = typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame(run)
            : setTimeout(run, 16);
    }

    _cancelTerminalRenderRefresh() {
        if (this._terminalRenderRefreshRaf != null) {
            if (typeof cancelAnimationFrame === 'function' && typeof this._terminalRenderRefreshRaf === 'number') {
                cancelAnimationFrame(this._terminalRenderRefreshRaf);
            } else {
                clearTimeout(this._terminalRenderRefreshRaf);
            }
            this._terminalRenderRefreshRaf = null;
        }
        this._pendingTerminalRenderRefreshMode = null;
    }

    async reconnect() {
        if (!this.sessionId) return;
        await this.connect(this.sessionId);
    }

    async verifyInputReady() {
        if (!this.sessionId || this.status.terminalAccess?.state !== 'owner') return false;
        if (this.status.connected && this.status.inputReady === true) {
            return true;
        }
        try {
            const res = await httpClient.post(`/api/sessions/${encodeURIComponent(this.sessionId)}/terminal/probe-input`, {
                viewerId: this.viewerId,
                viewerLabel: this.viewerLabel
            }, { suppressAuthError: true, timeout: 5000 });
            this.status.inputReady = Boolean(res?.inputReady);
            this.status.runtimeState = this.status.inputReady ? 'interactive_ready' : (res?.code ? 'degraded' : this.status.runtimeState);
            this._emitStatus();
            return this.status.inputReady;
        } catch {
            this.status.inputReady = false;
            this.status.runtimeState = 'degraded';
            this._emitStatus();
            return false;
        }
    }

    async refreshSnapshot() {
        await this._refreshSnapshot();
    }

    async _ensureInputReadyForUserInput() {
        if (this.ws?.readyState !== WebSocket.OPEN) {
            ttcWarn('[TTC-PROBE][ensureInputReady] early-return ws not open', { wsState: this.ws?.readyState });
            return false;
        }
        if (this._canDispatchInputForOwnershipReclaim(this.sessionId)) {
            return true;
        }
        if (this.status.mode === 'blocked' || this.status.terminalAccess?.state !== 'owner') {
            ttcWarn('[TTC-PROBE][ensureInputReady] early-return blocked', {
                mode: this.status.mode,
                owner: this.status.terminalAccess?.state
            });
            return false;
        }
        ttcDebug('[TTC-PROBE][ensureInputReady] calling verifyInputReady');
        const vStart = performance.now();
        const result = await this.verifyInputReady();
        ttcDebug('[TTC-PROBE][ensureInputReady] verifyInputReady returned', {
            result,
            ms: Math.round(performance.now() - vStart)
        });
        return result;
    }

    async _refreshSnapshot({ preserveMode = false } = {}) {
        if (!this.sessionId) return;
        try {
            const isBlockedSnapshot = this.status.mode === 'blocked'
                || this.status.terminalAccess?.state === 'blocked'
                || this.status.blockedAccess?.state === 'blocked';
            const visibleOnly = isBlockedSnapshot ? '0' : '1';
            const res = await httpClient.get(`/api/sessions/${encodeURIComponent(this.sessionId)}/terminal/snapshot?viewerId=${encodeURIComponent(this.viewerId)}&viewerLabel=${encodeURIComponent(this.viewerLabel)}&lines=${SNAPSHOT_LINES}&visibleOnly=${visibleOnly}`);
            if (typeof res?.text === 'string') {
                this._queueOrApplySnapshot(res.colorText || res.text, res.cursor || null);
                this.status.lastSnapshotAt = res.capturedAt || new Date().toISOString();
                this.status.copyMode = Boolean(res.copyMode);
                if (!preserveMode) {
                    this.status.mode = 'snapshot';
                    this.status.transport = 'snapshot';
                }
                if (typeof this.onSnapshotChange === 'function') {
                    this.onSnapshotChange({
                        sessionId: this.sessionId,
                        text: res.text,
                        colorText: res.colorText || null,
                        capturedAt: this.status.lastSnapshotAt
                    });
                }
                this._emitStatus();
            }
        } catch (error) {
            // best effort only
        }
    }

    _scheduleReconnect(sessionId) {
        if (!this._shouldRetry()) return;
        const delay = this._getReconnectDelay(this._retryCount);
        this._retryCount += 1;
        this.status.mode = 'reconnecting';
        this._emitStatus();
        this._reconnectTimer = setTimeout(() => {
            if (this.sessionId !== sessionId) return;
            void this.connect(sessionId).catch(() => {});
        }, delay);
    }

    /**
     * 指数バックオフ + ジッター（CommandMateパターン）
     * base * 2^attempt + random jitter (0-50% of base delay)
     */
    _getReconnectDelay(attempt) {
        const exponential = Math.min(
            BASE_RECONNECT_DELAY_MS * Math.pow(2, attempt),
            MAX_RECONNECT_DELAY_MS
        );
        const jitter = exponential * 0.5 * Math.random();
        return exponential + jitter;
    }

    /**
     * リトライ可能かどうか判定
     */
    _shouldRetry() {
        return this._retryCount < MAX_RECONNECT_RETRIES;
    }

    /**
     * Expected close codeかどうか判定
     * 正常クローズやブラウザナビゲーションではリトライしない
     */
    _isExpectedClose(code) {
        return EXPECTED_CLOSE_CODES.has(code);
    }

    /**
     * Keepalive pingの開始
     */
    _startKeepalive() {
        this._stopKeepalive();
        this._keepaliveTimer = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, KEEPALIVE_INTERVAL_MS);
    }

    /**
     * キューに保存されたメッセージを再接続後に送信
     */
    _flushMessageQueue() {
        if (this._messageQueue.isEmpty()) return;
        if (!this.canSendInput(this.sessionId)) {
            // 永久 stuck の可能性: queue は空にならないが drain も走らない。観測のみ。
            inputTelemetry.dropped('FLUSH_QUEUE_CAN_SEND_FALSE', {
                queueSize: this._messageQueue.size?.() ?? 0,
                mode: this.status.mode,
                inputReady: this.status.inputReady
            });
            return;
        }
        const messages = this._messageQueue.drain();
        let sent = 0;
        for (const msg of messages) {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify(msg));
                sent += 1;
            } else {
                inputTelemetry.dropped('FLUSH_QUEUE_WS_NOT_OPEN', { wsState: this.ws?.readyState });
            }
        }
        if (sent > 0) inputTelemetry.inc('queueDrained', sent);
    }

    /**
     * Keepalive pingの停止
     */
    _stopKeepalive() {
        if (this._keepaliveTimer) {
            clearInterval(this._keepaliveTimer);
            this._keepaliveTimer = null;
        }
    }

    _clearPendingTextFlushTimer() {
        if (!this._pendingTextFlushTimer) return;
        clearTimeout(this._pendingTextFlushTimer);
        this._pendingTextFlushTimer = null;
    }

    _clearPendingEchoExpiryTimer() {
        if (!this._pendingEchoExpiryTimer) return;
        clearTimeout(this._pendingEchoExpiryTimer);
        this._pendingEchoExpiryTimer = null;
    }

    _clearPendingEchoState({ clearDeferred = true } = {}) {
        this._clearPendingEchoExpiryTimer();
        this._pendingEchoText = '';
        this._pendingEchoSince = 0;
        this._pendingBackspaceEchoCount = 0;
        if (clearDeferred) {
            this._deferredSnapshotWhileEchoPending = null;
        }
    }

    _schedulePendingEchoExpiry() {
        this._clearPendingEchoExpiryTimer();
        if (!this._pendingEchoText) return;
        this._pendingEchoExpiryTimer = setTimeout(() => {
            this._expirePendingEcho();
        }, LOCAL_ECHO_SNAPSHOT_DEFER_MS);
    }

    _expirePendingEcho() {
        if (!this._pendingEchoText) {
            this._clearPendingEchoState();
            return;
        }

        const deferred = this._deferredSnapshotWhileEchoPending;
        ttcWarn('[TTC-PROBE] pending local echo expired; releasing snapshot gate', {
            echoLen: this._pendingEchoText.length,
            hasDeferredSnapshot: Boolean(deferred)
        });
        this._clearPendingEchoState({ clearDeferred: false });
        this._deferredSnapshotWhileEchoPending = null;
        if (!deferred || !this.terminal) return;
        this._applySnapshot(deferred.text, {
            resetTerminal: deferred.resetTerminal,
            screenOnly: deferred.screenOnly,
            afterWrite: deferred.afterWrite
        });
    }

    _scheduleBufferedTextFlush() {
        this._clearPendingTextFlushTimer();
        this._pendingTextFlushTimer = setTimeout(() => {
            this._flushBufferedText({ enqueueIfUnavailable: true }).catch(() => {});
        }, TEXT_BATCH_WINDOW_MS);
    }

    _drainBufferedText() {
        this._clearPendingTextFlushTimer();
        if (!this._pendingTextBuffer) return '';
        const buffered = this._pendingTextBuffer;
        this._pendingTextBuffer = '';
        return buffered;
    }

    _clearPendingFocusEscape() {
        if (this._pendingFocusEscapeTimer) {
            clearTimeout(this._pendingFocusEscapeTimer);
            this._pendingFocusEscapeTimer = null;
        }
        this._pendingFocusEscape = null;
    }

    _schedulePotentialFocusEscape() {
        this._clearPendingFocusEscape();
        const pending = {
            connectToken: this._connectToken,
            sessionId: this.sessionId
        };
        this._pendingFocusEscape = pending;
        this._pendingFocusEscapeTimer = setTimeout(() => {
            this._pendingFocusEscapeTimer = null;
            if (this._pendingFocusEscape !== pending) return;
            this._pendingFocusEscape = null;
            this._sendResolvedEscape(pending).catch((error) => {
                ttcWarn('[TTC-PROBE] failed to send deferred escape', { error: String(error?.message || error) });
            });
        }, FOCUS_ESCAPE_GRACE_MS);
    }

    async _resolvePotentialFocusEscape(value) {
        if (!this._pendingFocusEscape) return value;
        const pending = this._pendingFocusEscape;
        this._clearPendingFocusEscape();

        if (typeof value === 'string' && (value.startsWith('[I') || value.startsWith('[O'))) {
            inputTelemetry.dropped('SPLIT_FOCUS_RESPONSE', { len: 1 + Math.min(value.length, 2) });
            return value.slice(2);
        }

        if (value === '\x1b') {
            await this._sendResolvedEscape(pending);
            await this._sendResolvedEscape({
                connectToken: this._connectToken,
                sessionId: this.sessionId
            });
            return '';
        }

        await this._sendResolvedEscape(pending);
        return value;
    }

    async _sendResolvedEscape(pending) {
        if (pending
            && (this._connectToken !== pending.connectToken || this.sessionId !== pending.sessionId)) {
            inputTelemetry.dropped('DEFERRED_ESCAPE_SESSION_CHANGED', { len: 1 });
            return;
        }
        await this._flushBufferedText({
            enqueueIfUnavailable: true,
            allowInputNotReady: true
        });
        await this._dispatchTextMessage('\x1b', {
            enqueueIfUnavailable: true,
            allowInputNotReady: true
        });
    }

    async _flushBufferedText({
        enqueueIfUnavailable = false,
        ensureInteractive = false,
        allowInputNotReady = false
    } = {}) {
        const buffered = this._drainBufferedText();
        if (!buffered) return;
        await this._dispatchTextMessage(buffered, {
            enqueueIfUnavailable,
            ensureInteractive,
            allowInputNotReady
        });
    }

    async _dispatchTextMessage(value, {
        enqueueIfUnavailable = false,
        ensureInteractive = false,
        allowInputNotReady = false
    } = {}) {
        const sanitizedValue = stripTerminalControlResponses(value);
        if (!sanitizedValue && value) {
            inputTelemetry.dropped('TERMINAL_CONTROL_RESPONSE', { len: value.length });
            return;
        }
        value = sanitizedValue;
        const message = { type: 'input', inputType: 'text', value };
        if (this.ws?.readyState !== WebSocket.OPEN) {
            if (enqueueIfUnavailable) {
                this._messageQueue.enqueue(message);
                inputTelemetry.inc('queued');
                ttcWarn('[TTC-PROBE] dispatch queued (ws not open)', {
                    len: value.length,
                    wsState: this.ws?.readyState,
                    queueSize: this._messageQueue.size()
                });
            } else {
                ttcWarn('[TTC-PROBE] dispatch DROPPED (ws not open, no enqueue)', {
                    len: value.length,
                    wsState: this.ws?.readyState,
                    enqueueIfUnavailable,
                    inputReady: this.status.inputReady,
                    mode: this.status.mode
                });
                inputTelemetry.dropped('DISPATCH_WS_NOT_OPEN_NO_QUEUE', {
                    len: value.length,
                    inputReady: this.status.inputReady,
                    enqueueIfUnavailable
                });
            }
            return;
        }
        const canSend = this.canSendInput(this.sessionId)
            || this._canDispatchInputForOwnershipReclaim(this.sessionId)
            || (allowInputNotReady && this._canSendInputWithoutReady(this.sessionId));
        if (!canSend) {
            if (enqueueIfUnavailable) {
                this._messageQueue.enqueue(message);
                inputTelemetry.inc('queued');
                ttcWarn('[TTC-PROBE] dispatch queued (canSendInput=false)', {
                    len: value.length,
                    mode: this.status.mode,
                    inputReady: this.status.inputReady,
                    owner: this.status.terminalAccess?.state,
                    sessionId: this.sessionId,
                    queueSize: this._messageQueue.size?.() ?? 0
                });
                return;
            }
            ttcWarn('[TTC-PROBE] dispatch DROPPED (canSendInput=false, ws OPEN)', {
                len: value.length,
                mode: this.status.mode,
                inputReady: this.status.inputReady,
                owner: this.status.terminalAccess?.state,
                sessionId: this.sessionId
            });
            inputTelemetry.dropped('DISPATCH_CAN_SEND_INPUT_FALSE', {
                len: value.length,
                mode: this.status.mode,
                inputReady: this.status.inputReady
            });
            return;
        }
        if (ensureInteractive) {
            await this._ensureInteractiveMode();
        }
        this.ws.send(JSON.stringify(message));
        inputTelemetry.inc('sentOk');
        ttcDebug('[TTC-PROBE] dispatch sent', { len: value.length });
    }

    async _dispatchPasteMessage(value) {
        const message = { type: 'input', inputType: 'paste', value };
        if (this.ws?.readyState !== WebSocket.OPEN) {
            this._messageQueue.enqueue(message);
            inputTelemetry.inc('queued');
            return;
        }
        if (!this.canSendInput(this.sessionId) && !await this._ensureInputReadyForUserInput()) {
            this._messageQueue.enqueue(message);
            inputTelemetry.inc('queued');
            return;
        }
        await this._ensureInteractiveMode();
        this.ws.send(JSON.stringify(message));
        inputTelemetry.inc('sentOk');
    }

    _canSendInputWithoutReady(sessionId) {
        return this.ws?.readyState === WebSocket.OPEN
            && Boolean(sessionId)
            && this.sessionId === sessionId
            && this.status.mode !== 'blocked'
            && this.status.terminalAccess?.state === 'owner';
    }

    _splitFocusEvents(value) {
        if (typeof value !== 'string' || !value) return [{ value, isFocusEvent: false }];
        const FOCUS_RE = FOCUS_REPORT_PATTERN;
        FOCUS_RE.lastIndex = 0;
        const segments = [];
        let lastIndex = 0;
        let match;
        while ((match = FOCUS_RE.exec(value)) !== null) {
            if (match.index > lastIndex) {
                segments.push({ value: value.slice(lastIndex, match.index), isFocusEvent: false });
            }
            segments.push({ value: match[0], isFocusEvent: true });
            lastIndex = FOCUS_RE.lastIndex;
        }
        if (lastIndex < value.length) {
            segments.push({ value: value.slice(lastIndex), isFocusEvent: false });
        }
        return segments.length > 0 ? segments : [{ value, isFocusEvent: false }];
    }

    _shouldSendTextImmediately(value) {
        if (typeof value !== 'string' || !value) return true;
        if (this._isControlTextInput(value)) return true;
        if (this._isNavigationEscape(value)) return true;
        if (value.includes('\n') || value.includes('\r')) return true;
        const nextValue = this._pendingTextBuffer + value;
        return this._getUtf8ByteLength(nextValue) > TEXT_BATCH_MAX_BYTES;
    }

    _canBypassInputReadyProbe(value) {
        return this._isNavigationEscape(value) || this._isControlTextInput(value);
    }

    _isControlTextInput(value) {
        return value === '\r'
            || value === '\n'
            || value === '\r\n'
            || value === '\t'
            || value === '\x7f';
    }

    _isSubmitText(value) {
        return value === '\r' || value === '\n' || value === '\r\n';
    }

    _hasSubmitText(value) {
        return typeof value === 'string' && (value.includes('\r') || value.includes('\n'));
    }

    _syncCursorDebugClass() {
        if (!this.hostEl?.classList || typeof window === 'undefined') return;
        let enabled = false;
        try {
            const params = new URLSearchParams(window.location.search || '');
            enabled = params.get('cursorDebug') === '1';
        } catch {
            enabled = false;
        }
        this.hostEl.classList.toggle('bb-cursor-debug', enabled);
        if (enabled) {
            this._ensureCursorDebugPanel();
            this._updateCursorDebugPanel();
        } else {
            this._removeCursorDebugPanel();
        }
    }

    _syncTerminalMetricVars(appearance = null) {
        if (!this.hostEl?.style) return;
        const nextAppearance = appearance || readTerminalAppearance(this.hostEl);
        const rowHeight = Math.round(Math.max(1, nextAppearance.fontSize * nextAppearance.lineHeight) * 100) / 100;
        this.hostEl.style.setProperty('--bb-terminal-row-height', `${rowHeight}px`);
    }

    _ensureCursorDebugPanel() {
        if (this._cursorDebugPanel || typeof document === 'undefined') return;
        const panel = document.createElement('div');
        panel.className = 'bb-cursor-debug-panel';
        document.body.appendChild(panel);
        this._cursorDebugPanel = panel;
    }

    _removeCursorDebugPanel() {
        this._cursorDebugPanel?.remove?.();
        this._cursorDebugPanel = null;
    }

    _updateCursorDebugPanel() {
        if (!this._cursorDebugPanel || !this.hostEl?.classList) return;
        const state = this.hostEl.classList.contains('bb-ime-composing')
            ? 'composing'
            : this.hostEl.classList.contains('bb-ime-cursor-settling')
                ? 'settling'
                : 'none';
        this._cursorDebugPanel.textContent = `cursor debug: state=${state} | red=xterm DOM | orange=canvas layer | blue=textarea | green=composition`;
    }

    _isImeCommitText(value) {
        return typeof value === 'string'
            && /[^\x00-\x7f]/.test(value)
            && !/[\u0000-\u001f\u007f\u001b]/.test(value);
    }

    _setImeComposing(isComposing, { settleCursor = false } = {}) {
        if (!this.hostEl?.classList) return;
        if (isComposing === true) {
            this._imeCursorSettleActive = false;
            this.hostEl.classList.remove('bb-ime-cursor-settling');
            this.hostEl.classList.add('bb-ime-composing');
            this._updateCursorDebugPanel();
            return;
        }
        this.hostEl.classList.remove('bb-ime-composing');
        if (settleCursor) {
            this._imeCursorSettleActive = true;
            this.hostEl.classList.add('bb-ime-cursor-settling');
        } else {
            this._imeCursorSettleActive = false;
            this.hostEl.classList.remove('bb-ime-cursor-settling');
        }
        this._updateCursorDebugPanel();
    }

    _clearImeCursorState() {
        this._imeCursorSettleActive = false;
        this.hostEl?.classList?.remove('bb-ime-composing');
        this.hostEl?.classList?.remove('bb-ime-cursor-settling');
        this._updateCursorDebugPanel();
    }

    _getUtf8ByteLength(value) {
        if (!value) return 0;
        if (this._textEncoder) {
            return this._textEncoder.encode(value).length;
        }
        return value.length;
    }

    async exitCopyMode() {
        await this._ensureInteractiveMode();
    }

    async _ensureInteractiveMode() {
        if (!this.status.copyMode) return;
        if (this.ws?.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({ type: 'exit_copy_mode' }));
        this.status.copyMode = false;
        this._emitStatus();
    }

    _clearReconnectTimer() {
        if (!this._reconnectTimer) return;
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
    }

    _closeWs() {
        // close前にbufferが残っていたら → タイマー clear で消失するので警告
        if (this._pendingTextBuffer && this._pendingTextBuffer.length > 0) {
            inputTelemetry.dropped('WS_CLOSE_BUFFER_LOST', {
                len: this._pendingTextBuffer.length,
                wsState: this.ws?.readyState
            });
        }
        this._clearPendingTextFlushTimer();
        if (!this.ws) return;
        const ws = this.ws;
        this.ws = null;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close();
        }
    }

    _captureViewportState() {
        const buffer = this.terminal?.buffer?.active;
        if (!buffer) return null;

        const baseY = Number.isFinite(buffer.baseY) ? buffer.baseY : 0;
        const viewportY = Number.isFinite(buffer.viewportY) ? buffer.viewportY : baseY;
        const distanceFromBottom = Math.max(0, baseY - viewportY);

        return {
            // Absolute top line the user is viewing. This is the stable quantity to
            // preserve across a write that appends new lines: appended content does
            // not change the absolute index of existing lines, so restoring to the
            // same viewportY keeps the user on the same content. distanceFromBottom
            // (kept for legacy/pinned states) drifts the viewport toward the bottom
            // by the number of newly-written lines on every write — see _restoreViewportState.
            viewportY,
            distanceFromBottom,
            wasPinnedToBottom: distanceFromBottom === 0
        };
    }

    _createPinnedViewportState() {
        return {
            distanceFromBottom: 0,
            wasPinnedToBottom: true
        };
    }

    _computeIsViewportPinnedToBottom() {
        const viewportState = this._captureViewportState();
        return viewportState ? viewportState.wasPinnedToBottom : true;
    }

    _handleTerminalScroll() {
        this._isViewportPinnedToBottom = this._computeIsViewportPinnedToBottom();
        if (!this._isViewportPinnedToBottom || !this._pendingSnapshotText) return;

        const nextSnapshot = this._pendingSnapshotText;
        const pendingOptions = this._pendingSnapshotOptions || { screenOnly: false, afterWrite: null };
        this._pendingSnapshotText = null;
        this._pendingSnapshotOptions = null;
        this._applySnapshot(nextSnapshot, {
            forceViewportState: {
                distanceFromBottom: 0,
                wasPinnedToBottom: true
            },
            resetTerminal: this._resetTerminalOnNextSnapshot,
            screenOnly: pendingOptions.screenOnly === true,
            afterWrite: pendingOptions.afterWrite
        });
    }

    _queueOrApplySnapshot(text, cursor = null, options = {}) {
        if (!this.terminal) {
            // Terminal not yet initialized (loadXterm() still pending) — buffer for init()
            this._preTerminalSnapshot = { text, cursor, options };
            return;
        }

        this._lastPlainSnapshotText = String(options.plainText || options.visiblePlainText || text || '');
        const normalizedText = this._buildSnapshotForTerminal(text || '', cursor, options);
        if (this._shouldDeferSnapshotForPendingEcho(normalizedText)) {
            this._deferredSnapshotWhileEchoPending = {
                text: normalizedText,
                resetTerminal: this._resetTerminalOnNextSnapshot,
                screenOnly: options.screenOnly === true,
                afterWrite: options.afterWrite
            };
            ttcWarn('[TTC-PROBE] snapshot deferred while local echo pending', {
                echoLen: this._pendingEchoText.length,
                snapshotLen: normalizedText.length
            });
            this._schedulePendingEchoExpiry();
            return;
        }

        if (this._forceApplyNextSnapshot) {
            this._forceApplyNextSnapshot = false;
            this._isViewportPinnedToBottom = true;
            this._pendingSnapshotText = null;
            this._applySnapshot(normalizedText, {
                forceViewportState: this._createPinnedViewportState(),
                resetTerminal: true,
                screenOnly: options.screenOnly === true,
                afterWrite: options.afterWrite
            });
            return;
        }

        if (this._resetTerminalOnNextSnapshot) {
            // A transport reset re-arms this snapshot. This fires not only on a real session
            // switch (that path is _forceApplyNextSnapshot above, where the buffer was already
            // cleared and there is no scroll position to keep) but also on every RECONNECT of the
            // session the user is currently viewing (connect() arms _resetTerminalOnNextSnapshot
            // unconditionally). Force-pinning to the bottom here yanked a user who had scrolled up
            // to read scrollback straight back to the latest line on each reconnect — the
            // "scrolling works right after switching, then a while later it snaps to the bottom and
            // locks" report. Preserve the user's scroll across the reset repaint; only pin when
            // they were already at the bottom (so live tail-follow resumes). afterWrite (the
            // connect-readiness handshake) and resetTerminal are unchanged.
            const pinnedNow = this._computeIsViewportPinnedToBottom();
            this._isViewportPinnedToBottom = pinnedNow;
            this._pendingSnapshotText = null;
            this._pendingSnapshotOptions = null;
            this._applySnapshot(normalizedText, {
                forceViewportState: pinnedNow ? this._createPinnedViewportState() : this._captureViewportState(),
                resetTerminal: true,
                screenOnly: options.screenOnly === true,
                afterWrite: options.afterWrite
            });
            return;
        }

        if (!this._computeIsViewportPinnedToBottom()) {
            this._isViewportPinnedToBottom = false;
            this._pendingSnapshotText = normalizedText;
            this._pendingSnapshotOptions = {
                screenOnly: options.screenOnly === true,
                afterWrite: options.afterWrite
            };
            return;
        }

        this._isViewportPinnedToBottom = true;
        this._pendingSnapshotText = null;
        this._pendingSnapshotOptions = null;
        this._applySnapshot(normalizedText, {
            resetTerminal: this._resetTerminalOnNextSnapshot,
            screenOnly: options.screenOnly === true,
            afterWrite: options.afterWrite
        });
    }

    _shouldDeferSnapshotForPendingEcho(snapshotText) {
        if (!this._pendingEchoText) return false;
        if (this._pendingEchoSince && Date.now() - this._pendingEchoSince > LOCAL_ECHO_SNAPSHOT_DEFER_MS) {
            ttcWarn('[TTC-PROBE] stale local echo ignored for snapshot', {
                echoLen: this._pendingEchoText.length,
                ageMs: Date.now() - this._pendingEchoSince
            });
            this._clearPendingEchoState({ clearDeferred: false });
            return false;
        }
        if (!snapshotText) return true;
        return !snapshotText.includes(this._pendingEchoText);
    }

    _formatSnapshotForTerminal(text, cursor = null) {
        const normalizedText = this._normalizeSnapshotAutowrap(
            this._stripSnapshotRecordSeparator(text || '')
        );
        const cursorMove = this._formatCursorMoveSequence(cursor);
        return cursorMove ? `${normalizedText}${cursorMove}` : normalizedText;
    }

    _formatCursorMoveSequence(cursor = null) {
        if (!cursor || !Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) {
            return '';
        }

        const row = Math.max(1, Math.floor(cursor.y) + 1);
        const col = Math.max(1, Math.floor(cursor.x) + 1);
        return `\x1b[${row};${col}H`;
    }

    _formatScreenSnapshotForTerminal(text, cursor = null) {
        const snapshotText = this._stripSnapshotRecordSeparator(text || '');
        if (!snapshotText) return this._formatCursorMoveSequence(cursor);

        const rows = snapshotText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        const chunks = ['\x1b[?7l'];
        rows.forEach((line, index) => {
            if (!line) return;
            chunks.push(`\x1b[${index + 1};1H${line}`);
        });
        chunks.push('\x1b[?7h');
        const cursorMove = this._formatCursorMoveSequence(cursor);
        if (cursorMove) chunks.push(cursorMove);
        return chunks.join('');
    }

    _buildSnapshotForTerminal(text, cursor = null, options = {}) {
        if (options.screenOnly === true) {
            return this._formatScreenSnapshotForTerminal(text, cursor);
        }
        return this._formatSnapshotForTerminal(text, cursor);
    }

    _stripSnapshotRecordSeparator(text) {
        if (!text) return '';
        if (text.endsWith('\r\n')) return text.slice(0, -2);
        if (text.endsWith('\n') || text.endsWith('\r')) return text.slice(0, -1);
        return text;
    }

    _normalizeSnapshotAutowrap(text) {
        const cols = Number.isFinite(this.terminal?.cols) ? Math.floor(this.terminal.cols) : 0;
        if (!text || cols <= 0) return text || '';

        let result = '';
        let displayWidth = 0;
        for (let i = 0; i < text.length;) {
            if (text[i] === '\x1b') {
                const ansiMatch = text.slice(i).match(/^\x1b\[[0-?]*[ -/]*[@-~]/);
                if (ansiMatch) {
                    result += ansiMatch[0];
                    i += ansiMatch[0].length;
                    continue;
                }
            }

            const codePoint = text.codePointAt(i);
            const char = String.fromCodePoint(codePoint);
            i += char.length;

            if (char === '\n') {
                if (displayWidth === cols) {
                    displayWidth = 0;
                    continue;
                }
                result += char;
                displayWidth = 0;
                continue;
            }

            result += char;
            displayWidth += this._getDisplayCellWidth(codePoint);
        }
        return result;
    }

    _getDisplayCellWidth(codePoint) {
        if (!Number.isFinite(codePoint)) return 0;
        if (codePoint === 0) return 0;
        if (codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
        if (
            (codePoint >= 0x0300 && codePoint <= 0x036f) ||
            (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
            (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
            (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
            (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
        ) {
            return 0;
        }
        if (
            codePoint >= 0x1100 && (
                codePoint <= 0x115f ||
                codePoint === 0x2329 ||
                codePoint === 0x232a ||
                (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
                (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
                (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
                (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
                (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
                (codePoint >= 0xff00 && codePoint <= 0xff60) ||
                (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
                (codePoint >= 0x1f300 && codePoint <= 0x1faff)
            )
        ) {
            return 2;
        }
        return 1;
    }

    _restoreViewportState(viewportState) {
        if (!viewportState || !this.terminal) return;

        if (viewportState.wasPinnedToBottom) {
            this.terminal.scrollToBottom?.();
            return;
        }

        const buffer = this.terminal.buffer?.active;
        if (!buffer || typeof this.terminal.scrollToLine !== 'function') return;

        const nextBaseY = Number.isFinite(buffer.baseY) ? buffer.baseY : 0;
        // Preserve the absolute top line the user is viewing, NOT the distance from a
        // now-grown bottom. When live output appends N lines, baseY grows by N while the
        // absolute index of already-visible content is unchanged; restoring to
        // (nextBaseY - distanceFromBottom) therefore drags the viewport DOWN by N every
        // write, so during continuous output the user is repeatedly pulled back to the
        // bottom and pinned there (scroll lock). Restoring to the captured viewportY keeps
        // the user on their content. Fall back to the legacy formula only for older state
        // shapes that predate viewportY (pinned states never reach this branch).
        const targetLine = Number.isFinite(viewportState.viewportY)
            ? Math.min(Math.max(0, viewportState.viewportY), nextBaseY)
            : Math.max(0, nextBaseY - viewportState.distanceFromBottom);
        this.terminal.scrollToLine(targetLine);
    }

    _applySnapshot(text, options = {}) {
        if (!this.terminal) return;
        // snapshotの中身が前回と同じならスキップ（ちらつき防止）
        const normalizedText = text || '';
        const shouldResetTerminal = Boolean(options.resetTerminal);
        if (!shouldResetTerminal && this._lastSnapshotText === normalizedText) return;
        this._lastSnapshotText = normalizedText;
        this._resetTerminalOnNextSnapshot = false;
        // A reset (session-switch) snapshot is only a preview; arm a one-shot clear so the
        // first live output repaints from a clean buffer (no ghost rows left below).
        if (shouldResetTerminal) this._liveResetPendingAfterSnapshot = true;
        this._clearPendingEchoState();

        const viewportState = options.forceViewportState
            || (shouldResetTerminal ? this._createPinnedViewportState() : this._captureViewportState());
        const clearSequence = options.screenOnly === true ? '\x1b[2J\x1b[H' : '\x1b[2J\x1b[3J\x1b[H';
        this._writeToTerminal(clearSequence + normalizedText, viewportState, {
            resetTerminal: shouldResetTerminal,
            renderRefresh: 'all',
            afterWrite: options.afterWrite
        });
    }

    _applyOutput(text) {
        if (!this.terminal || !text) return;
        const nextText = this._consumePendingEcho(text);
        if (!nextText) return;
        this._writeToTerminal(nextText);
    }

    _applyLocalEcho(text) {
        if (!this.terminal || !text || this.status.mode !== 'live') return;

        if (text === '\x7f') {
            this._applyLocalBackspaceEcho();
            return;
        }

        for (const segment of this._splitFocusEvents(text)) {
            if (segment.isFocusEvent || !this._canOptimisticallyEcho(segment.value)) continue;
            const normalized = this._normalizeEchoText(segment.value);
            if (!normalized) continue;

            this._pendingEchoText += normalized;
            if (!this._pendingEchoSince) {
                this._pendingEchoSince = Date.now();
            }
            this._schedulePendingEchoExpiry();
            this._writeToTerminal(normalized);
        }
    }

    _applyLocalBackspaceEcho() {
        if (this._pendingEchoText) {
            if (!this._canLocallyErasePendingEcho()) return;

            this._pendingEchoText = this._pendingEchoText.slice(0, -1);
            if (this._pendingEchoText) {
                this._schedulePendingEchoExpiry();
            } else {
                this._clearPendingEchoState({ clearDeferred: false });
            }
        }
        this._pendingBackspaceEchoCount += 1;
        inputTelemetry.inc('localBackspaceEcho');
        this._writeToTerminal('\b \b');
    }

    _canLocallyErasePendingEcho() {
        if (!this._pendingEchoText) return false;
        const lastChar = this._pendingEchoText[this._pendingEchoText.length - 1];
        return /^[\x20-\x7e]$/.test(lastChar);
    }

    _applySubmitFeedback(text) {
        if (!this.terminal || !this._hasSubmitText(text) || this.status.mode !== 'live') return;
        this._clearImeCursorState();
        this._writeToTerminal('\r\n');
    }

    _canOptimisticallyEcho(text) {
        if (typeof text !== 'string' || !text) return false;
        return /^[\t\x20-\x7e]+$/.test(text);
    }

    _normalizeEchoText(text) {
        return text
            .replace(/\r?\n/g, '\r\n')
            .replace(/\t/g, '    ');
    }

    _consumePendingEcho(text) {
        text = this._consumePendingBackspaceEcho(text);
        if (!text) return '';
        if (!this._pendingEchoText) return text;
        const pendingEcho = this._pendingEchoText;
        if (text.startsWith(pendingEcho)) {
            const remaining = text.slice(pendingEcho.length);
            ttcDebug('[TTC-PROBE][local-echo] consumed', {
                echoLen: pendingEcho.length,
                remainingLen: remaining.length,
                mode: 'direct'
            });
            this._clearPendingEchoState();
            return remaining;
        }

        const prefix = this._getNonPrintingPrefix(text);
        if (prefix && text.slice(prefix.length).startsWith(pendingEcho)) {
            const remaining = prefix + text.slice(prefix.length + pendingEcho.length);
            ttcDebug('[TTC-PROBE][local-echo] consumed', {
                echoLen: pendingEcho.length,
                remainingLen: remaining.length,
                mode: 'non-printing-prefix'
            });
            this._clearPendingEchoState();
            return remaining;
        }

        ttcDebug('[TTC-PROBE][local-echo] mismatch', {
            echoLen: pendingEcho.length,
            outputLen: text.length,
            outputPrefix: text.slice(0, 24)
        });
        this._clearPendingEchoState();
        return text;
    }

    _getNonPrintingPrefix(text) {
        if (typeof text !== 'string' || !text) return '';
        let offset = 0;
        while (offset < text.length) {
            const rest = text.slice(offset);
            const sgr = rest.match(/^\x1b\[[0-9;?]*m/);
            if (sgr) {
                offset += sgr[0].length;
                continue;
            }
            const osc = rest.match(/^\x1b\](?:[^\x07\x1b]|\x1b(?!\\))*?(?:\x07|\x1b\\)/);
            if (osc) {
                offset += osc[0].length;
                continue;
            }
            break;
        }
        return offset > 0 ? text.slice(0, offset) : '';
    }

    _consumePendingBackspaceEcho(text) {
        if (!this._pendingBackspaceEchoCount || !text) return text;

        let remaining = text;
        while (this._pendingBackspaceEchoCount > 0) {
            if (remaining.startsWith('\b \b')) {
                remaining = remaining.slice(3);
            } else if (remaining.startsWith('\x1b[D \x1b[D')) {
                remaining = remaining.slice(7);
            } else if (remaining.startsWith('\x1b[D\x1b[K')) {
                remaining = remaining.slice(6);
            } else {
                break;
            }
            this._pendingBackspaceEchoCount -= 1;
        }

        if (this._pendingBackspaceEchoCount > 0 && remaining === text) {
            this._pendingBackspaceEchoCount = 0;
        }
        return remaining;
    }

    _writeToTerminal(text, viewportState = null, options = {}) {
        if (!this.terminal || !text) return;
        const nextViewportState = viewportState || this._captureViewportState();
        this._terminalWriteQueue.push({
            text,
            viewportState: nextViewportState,
            resetTerminal: Boolean(options.resetTerminal),
            renderRefresh: options.renderRefresh === 'all' ? 'all' : 'bottom',
            generation: this._terminalWriteGeneration,
            afterWrite: typeof options.afterWrite === 'function' ? options.afterWrite : null
        });
        this._drainTerminalWriteQueue();
    }

    _drainTerminalWriteQueue() {
        if (this._terminalWriteActive || !this.terminal) return;

        // Drop any stale-generation ops at the head (cancelled by _cancelTerminalWriteQueue).
        while (this._terminalWriteQueue.length
            && this._terminalWriteQueue[0].generation !== this._terminalWriteGeneration) {
            this._terminalWriteQueue.shift();
        }
        if (!this._terminalWriteQueue.length) return;

        const generation = this._terminalWriteGeneration;

        // Coalesce a run of consecutive same-generation ops into ONE terminal.write.
        // Doing one write (+ one viewport restore + one render refresh) for a burst of WS output
        // messages instead of one-per-message is the whole point: a long paste echoes back as
        // hundreds/thousands of small chunks, and waiting for xterm's write-callback per chunk was
        // ~53x slower than the same bytes written together (2000 msgs: ~55s -> ~1s).
        // A resetTerminal op is a hard boundary: it can only START a batch (reset() clears the
        // screen, so earlier ops must not merge across it). After the reset we still coalesce the
        // following non-reset run; byte order is preserved.
        const head = this._terminalWriteQueue.shift();
        const batch = [head];
        if (!head.resetTerminal) {
            while (this._terminalWriteQueue.length
                && this._terminalWriteQueue[0].generation === generation
                && !this._terminalWriteQueue[0].resetTerminal) {
                batch.push(this._terminalWriteQueue.shift());
            }
        }

        const combinedText = batch.length === 1 ? head.text : batch.map((op) => op.text).join('');
        const viewportState = head.viewportState;
        const renderRefresh = batch.some((op) => op.renderRefresh === 'all') ? 'all' : 'bottom';
        const afterWrites = batch.map((op) => op.afterWrite).filter((fn) => typeof fn === 'function');

        this._terminalWriteActive = true;
        let finished = false;
        const finish = () => {
            if (finished) return;
            if (generation !== this._terminalWriteGeneration) return;
            finished = true;
            this._restoreViewportAfterTerminalWrite(viewportState);
            this._scheduleTerminalRenderRefresh(renderRefresh);
            try {
                for (const afterWrite of afterWrites) afterWrite();
            } finally {
                this._terminalWriteActive = false;
                this._drainTerminalWriteQueue();
            }
        };

        try {
            if (head.resetTerminal && typeof this.terminal.reset === 'function') {
                this.terminal.reset();
            }
            const writeFn = this.terminal.write;
            writeFn.call(this.terminal, combinedText, finish);
            if (writeFn.length < 2) {
                this._queueTerminalWriteFallback(finish);
            }
        } catch (err) {
            this._terminalWriteActive = false;
            this._terminalWriteQueue.length = 0;
            ttcWarn('[TTC-PROBE] terminal write failed', { err: String(err?.message || err) });
        }
    }

    _cancelTerminalWriteQueue() {
        this._terminalWriteGeneration += 1;
        this._terminalWriteQueue.length = 0;
        this._terminalWriteActive = false;
        this._cancelTerminalRenderRefresh();
    }

    _queueTerminalWriteFallback(finish) {
        if (typeof queueMicrotask === 'function') {
            queueMicrotask(finish);
            return;
        }
        Promise.resolve().then(finish);
    }

    _restoreViewportAfterTerminalWrite(viewportState) {
        this._restoreViewportState(viewportState);
        // NocoDB バグ#2: モバイルでターミナル更新時にスクロール位置が最下部に
        // 戻る問題への対策。 ユーザーが上スクロール中（wasPinnedToBottom=false）
        // の場合、 iOS Safari の momentum scroll / fitAddon resize で
        // write callback 直後に再度スクロールが戻されるケースがある。
        // 次フレームで再度 restore して位置を確実にキープする。
        if (viewportState && !viewportState.wasPinnedToBottom && typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => {
                this._restoreViewportState(viewportState);
            });
        }
        this._isViewportPinnedToBottom = this._computeIsViewportPinnedToBottom();
    }

    _prepareForSessionSwitch() {
        this._clearImeCursorState();
        this._forceApplyNextSnapshot = true;
        this._pendingSnapshotText = null;
        this._pendingSnapshotOptions = null;
        this._clearPendingEchoState();
        this._preTerminalSnapshot = null;
        this._lastSnapshotText = null;
        this._resetTerminalOnNextSnapshot = true;
        this._isViewportPinnedToBottom = true;
        this._cancelTerminalWriteQueue();
        if (this.terminal) {
            // xterm.jsの前セッション表示を即クリア。
            // snapshotが来るまでの間、前セッションの内容が見えるのを防止。
            this._writeToTerminal('\x1b[2J\x1b[3J\x1b[H', null, { resetTerminal: true });
        }
    }

    _measureViewport() {
        // Skip fit when host element has no usable dimensions to avoid corrupting layout
        if (this.hostEl) {
            const rect = this.hostEl.getBoundingClientRect();
            if (rect.height < 50 || rect.width < 100) return null;
        }
        this.fitAddon?.fit();
        const dims = this._getDimensions();
        if (!dims) return null;
        if (!Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return null;
        if (dims.cols < 60 || dims.rows < 20) return null;
        return dims;
    }

    _getDimensions() {
        if (!this.terminal) return null;
        return {
            cols: this.terminal.cols,
            rows: this.terminal.rows
        };
    }

    _buildWsUrl(sessionId, dimensions = null) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = new URL(`${protocol}//${window.location.host}/api/sessions/${encodeURIComponent(sessionId)}/terminal/ws`);
        url.searchParams.set('viewerId', this.viewerId);
        url.searchParams.set('viewerLabel', this.viewerLabel);
        if (dimensions?.cols && dimensions?.rows) {
            url.searchParams.set('cols', String(dimensions.cols));
            url.searchParams.set('rows', String(dimensions.rows));
        }
        return url.toString();
    }

    async _ensureAuthenticated() {
        try {
            await httpClient.get('/api/auth/verify', { suppressAuthError: true });
        } catch {
            // Authentication not available — proceed anyway.
            // WebSocket upgrade handler on the server will determine access.
        }
    }

    _parseMessage(raw) {
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    _applyRuntimeStatus(message) {
        if (!message || typeof message !== 'object') return;
        if (typeof message.runtimeState === 'string') {
            this.status.runtimeState = message.runtimeState;
        }
        if (Object.prototype.hasOwnProperty.call(message, 'inputReady')) {
            this.status.inputReady = Boolean(message.inputReady);
        }
        if (message.terminalAccess) {
            this.status.terminalAccess = message.terminalAccess;
            this.status.blockedAccess = message.terminalAccess.state === 'blocked'
                ? message.terminalAccess
                : null;
        }
    }

    _canSendControlKey(value) {
        return CONTROL_KEYS_WITHOUT_INPUT_PROBE.has(value)
            && this.sessionId
            && this.status.mode !== 'blocked'
            && this.status.terminalAccess?.state === 'owner'
            && this.ws?.readyState === WebSocket.OPEN;
    }

    /**
     * 矢印・Tab・Escape・Function key 等のナビゲーション系 escape sequence かどうか。
     * これらは Codex 選択画面など CLI state が READY/WAITING にならない状態でも
     * 送信する必要があるため、probe をスキップする。
     * 通常の文字入力が紛れていない (純粋な escape sequence のみ) かをチェック。
     */
    _isNavigationEscape(value) {
        if (typeof value !== 'string' || !value) return false;
        // ESC (\x1B) で始まらない場合は通常の入力 → probe する
        if (value.charCodeAt(0) !== 0x1B) return false;
        // 単独 ESC キー
        if (value === '\x1B') return true;
        // CSI sequences: \x1B[X (X = A,B,C,D for arrows, others for navigation)
        // SS3 sequences: \x1BOX (function keys F1-F4 in some terminals)
        // 矢印/PageUp/PageDown/Home/End/Insert/Delete/F-keys 等の代表的パターン
        return /^\x1B(?:\[[\x30-\x3F]*[\x20-\x2F]*[\x40-\x7E]|O[A-Z~])$/.test(value);
    }

    _emitStatus() {
        if (typeof this.onStatusChange !== 'function') return;
        this.onStatusChange(this.getStatus());
    }
}
