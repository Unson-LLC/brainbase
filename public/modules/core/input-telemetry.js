// @ts-check
/**
 * Input pipeline telemetry counter (Phase 1: 観測層).
 *
 * 目的: terminal-transport-client.js の14箇所、server側の5箇所のサイレントドロップを
 * 定量化し、本番でのデータ損失頻度・パターンをdata-drivenに把握する。
 *
 * 挙動変更なし。counterの増加と30秒毎の console.log emission のみ。
 *
 * Reasonコード一覧 (client):
 *   - INPUT_QUEUE_TOKEN_MISMATCH    : onData chain で connectToken が変わって drop
 *   - SEND_TEXT_SESSION_CHANGED     : sendText probe中にsession切替で drop
 *   - SEND_TEXT_PROBE_FAILED        : sendText probeが失敗してinput drop
 *   - SEND_KEY_NOT_READY            : sendKey でcanSendInput=false かつcontrol key不可
 *   - INTERRUPT_WS_CLOSED           : interrupt() WS closed
 *   - DISPATCH_WS_NOT_OPEN_NO_QUEUE : _dispatchTextMessage WS not open + enqueue不可
 *   - DISPATCH_CAN_SEND_INPUT_FALSE : _dispatchTextMessage canSendInput=false
 *   - FLUSH_QUEUE_CAN_SEND_FALSE    : _flushMessageQueue canSendInput=false → 永久stuck
 *   - CONNECT_DRAIN_DROPPED         : connect() で _drainBufferedText 内容が送れず drop
 *   - DISCONNECT_BUFFER_DRAINED     : disconnect()でbuffer内容を捨てた
 *   - DISCONNECT_QUEUE_CLEARED      : disconnect()で_messageQueue.clear()
 *   - WS_CLOSE_BUFFER_LOST          : WS close時にflush timer内のbuffer失う
 *   - IME_TIMER_TOKEN_MISMATCH      : IME post-Enter timer発火時にtoken不一致
 *   - INPUT_QUEUE_CHAIN_ERROR       : _inputQueue chain catch でerror swallow
 *
 * Reasonコード一覧 (server):
 *   - NOT_OWNER                     : terminalAccess.state !== 'owner'
 *   - INPUT_NOT_READY               : probe state passed/fresh ではない
 *   - INVALID_INPUT                 : value/type 不正で sendInput rejected
 *   - INPUT_FOCUS_STRIPPED_EMPTY    : focus event除去後 normalizedInputが空
 *   - MUTATION_TIMEOUT_OR_FAILED    : tmux send-keys timeout(5s) or 失敗
 */

const FLUSH_INTERVAL_MS = 30_000;

class InputTelemetry {
    constructor() {
        this.counters = {
            appended: 0,           // sendText/sendKey呼び出し数
            sentOk: 0,              // dispatch sent 成功
            queued: 0,              // _messageQueue.enqueue 成功
            dropped: 0,             // 全drop理由の合計
            ghostEcho: 0,           // probe失敗時にecho残った件数
            queueDrained: 0,        // _flushMessageQueue で実drain成功
        };
        /** @type {Map<string, number>} */
        this.dropByReason = new Map();
        this._lastEmitAt = Date.now();
        this._flushTimer = null;
        this._startFlushTimer();
    }

    inc(key, n = 1) {
        if (this.counters[key] !== undefined) {
            this.counters[key] += n;
        } else {
            this.counters[key] = n;
        }
    }

    dropped(reason, extra = null) {
        this.counters.dropped += 1;
        const cur = this.dropByReason.get(reason) || 0;
        this.dropByReason.set(reason, cur + 1);
        // 即時にもログを出す（reason別の発生時刻把握用）。
        // ただし冗長になるので reason+session でレートリミットしてもよい（将来）。
        if (typeof console !== 'undefined' && console.warn) {
            console.warn('[INPUT-TELEMETRY] dropped', { reason, ...extra });
        }
    }

    snapshot() {
        const dropByReason = {};
        for (const [k, v] of this.dropByReason.entries()) dropByReason[k] = v;
        return {
            ts: new Date().toISOString(),
            sinceMs: Date.now() - this._lastEmitAt,
            counters: { ...this.counters },
            dropByReason
        };
    }

    emit() {
        const snap = this.snapshot();
        // 0件のときは出さない（ノイズ削減）
        const total = Object.values(snap.counters).reduce((a, b) => a + b, 0);
        if (total === 0) return;
        if (typeof console !== 'undefined' && console.log) {
            console.log('[INPUT-TELEMETRY]', snap);
        }
        this._lastEmitAt = Date.now();
    }

    reset() {
        for (const k of Object.keys(this.counters)) this.counters[k] = 0;
        this.dropByReason.clear();
        this._lastEmitAt = Date.now();
    }

    _startFlushTimer() {
        if (typeof window === 'undefined' && typeof setInterval !== 'function') return;
        if (this._flushTimer) return;
        try {
            this._flushTimer = setInterval(() => this.emit(), FLUSH_INTERVAL_MS);
            // ブラウザ環境ではunload時にもemitしておく
            if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
                window.addEventListener('beforeunload', () => this.emit());
            }
        } catch {
            // setInterval利用不可環境は無視
        }
    }
}

export const inputTelemetry = new InputTelemetry();
