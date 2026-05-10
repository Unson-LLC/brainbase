import { appStore } from '../core/store.js';
import { httpClient } from '../core/http-client.js';
import { getSessionStatus } from '../session-ui-state.js';

const MIN_MOBILE_TERMINAL_LAYOUT_WIDTH = 320;
const MIN_MOBILE_TERMINAL_LAYOUT_HEIGHT = 240;

function finiteNumber(value, fallback = 0) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : fallback;
}

function buildSafeMobileTerminalLayout(layout, frameEl) {
    const frameRect = frameEl?.getBoundingClientRect?.() || null;
    const visualViewport = typeof window !== 'undefined' ? window.visualViewport : null;
    const viewportWidth = visualViewport?.width || window.innerWidth || 0;
    const viewportHeight = visualViewport?.height || window.innerHeight || 0;

    const width = finiteNumber(layout?.width, frameRect?.width || viewportWidth);
    const height = finiteNumber(layout?.height, frameRect?.height || viewportHeight);
    if (width < MIN_MOBILE_TERMINAL_LAYOUT_WIDTH || height < MIN_MOBILE_TERMINAL_LAYOUT_HEIGHT) {
        return null;
    }

    const keyboardOffset = Math.max(0, Math.min(height, finiteNumber(layout?.keyboardOffset, 0)));
    return {
        ...(layout || {}),
        width: Math.round(width),
        height: Math.round(height),
        offsetTop: finiteNumber(layout?.offsetTop, visualViewport?.offsetTop || 0),
        offsetLeft: finiteNumber(layout?.offsetLeft, visualViewport?.offsetLeft || 0),
        keyboardOffset,
        keyboardOpen: Boolean(layout?.keyboardOpen && keyboardOffset > 0)
    };
}

export function applyTerminalMobileMixin(AppClass) {
    AppClass.prototype._getSessionById = function(sessionId) {
        const { sessions } = appStore.getState();
        return (sessions || []).find(item => item.id === sessionId) || null;
    };

    AppClass.prototype._getMobileSnapshotPollInterval = function(sessionId) {
        const hookStatus = getSessionStatus(sessionId);
        return hookStatus?.isWorking ? 1000 : 3000;
    };

    AppClass.prototype._setMobileSnapshotPoll = function(delay) {
        if (this._mobileSnapshotPollTimer && this._mobileSnapshotPollDelay === delay) {
            return;
        }
        this._stopMobileSnapshotPolling();
        this._mobileSnapshotPollDelay = delay;
        this._mobileSnapshotPollTimer = window.setTimeout(() => {
            this._mobileSnapshotPollTimer = null;
            void this._refreshMobileSnapshotDisplay();
        }, delay);
    };

    AppClass.prototype._stopMobileSnapshotPolling = function() {
        if (this._mobileSnapshotPollTimer) {
            window.clearTimeout(this._mobileSnapshotPollTimer);
            this._mobileSnapshotPollTimer = null;
        }
        this._mobileSnapshotPollDelay = null;
    };

    AppClass.prototype._refreshMobileSnapshotDisplay = async function({ force = false } = {}) {
        if (!this._isMobileSnapshotMode()) return;
        // force=true（ユーザー操作起因）の場合はin-flightガードをバイパス
        if (this._mobileSnapshotInFlight && !force) return;
        const sessionId = appStore.getState().currentSessionId;
        if (!sessionId) {
            this._stopMobileSnapshotPolling();
            return;
        }

        this._mobileSnapshotInFlight = true;
        try {
            await this._repairTerminalGeometry(sessionId, 'mobile-snapshot-refresh');
            // Mobile snapshot polling must bypass cache on every tick.
            // Otherwise the timer runs but only re-renders stale cached content.
            const snapshot = await this._loadTerminalSnapshot(sessionId, { force: true });
            // snapshot取得後に直接DOMを更新（_updateTerminalInputStatus経由だと遅延する）
            if (snapshot && appStore.getState().currentSessionId === sessionId) {
                this._renderTerminalSnapshotPanel({
                    visible: true,
                    snapshot,
                    title: 'Terminal display'
                });
            }
        } catch (error) {
            console.warn('Failed to refresh mobile terminal snapshot:', error);
        } finally {
            this._mobileSnapshotInFlight = false;
            if (this._isMobileSnapshotMode() && appStore.getState().currentSessionId === sessionId) {
                this._updateTerminalInputStatus();
                this._setMobileSnapshotPoll(this._getMobileSnapshotPollInterval(sessionId));
            }
        }
    };

    AppClass.prototype._repairTerminalGeometry = async function(sessionId, reason = 'mobile') {
        if (!sessionId) return null;
        try {
            const result = await httpClient.post(`/api/sessions/${encodeURIComponent(sessionId)}/terminal/geometry/repair`, {
                viewerId: this.viewerId,
                viewerLabel: this.viewerLabel,
                reason
            });
            if (result?.repaired) {
                console.warn('[MOBILE_TERMINAL_GEOMETRY] repaired terminal geometry', {
                    sessionId,
                    reason,
                    paneSize: result.paneSize,
                    repairedPaneSize: result.repairedPaneSize
                });
            }
            return result || null;
        } catch (error) {
            console.warn('[MOBILE_TERMINAL_GEOMETRY] repair request failed', {
                sessionId,
                reason,
                message: error?.message || String(error)
            });
            return null;
        }
    };

    AppClass.prototype._syncMobileSnapshotPolling = function({ immediate = false, force = false } = {}) {
        if (!this._isMobileSnapshotMode()) {
            this._stopMobileSnapshotPolling();
            return;
        }
        const sessionId = appStore.getState().currentSessionId;
        if (!sessionId) {
            this._stopMobileSnapshotPolling();
            return;
        }
        if (immediate) {
            void this._refreshMobileSnapshotDisplay({ force });
            return;
        }
        this._setMobileSnapshotPoll(this._getMobileSnapshotPollInterval(sessionId));
    };

    AppClass.prototype._closeMobileLiveTerminalModalDom = function() {
        this.mobileLiveTerminalModalEl?.classList.remove('active');
        if (this.mobileLiveTerminalFrameEl) {
            this._clearTerminalFrame(this.mobileLiveTerminalFrameEl);
        }
    };

    AppClass.prototype.closeMobileLiveTerminal = function() {
        if (this._mobileTerminalMode !== 'interactive') return;
        this._mobileTerminalMode = 'snapshot';
        this._mobileLiveTerminalSessionId = null;
        this._closeMobileLiveTerminalModalDom();
        this._showSnapshotDisplay(appStore.getState().currentSessionId);
        this._syncMobileSnapshotPolling({ immediate: true, force: true });
        this._updateTerminalInputStatus();
    };

    AppClass.prototype.postTerminalFrameMessage = function(message, frameEl = null) {
        if (!this.mobileLiveTerminalFrameEl) {
            this.mobileLiveTerminalFrameEl = document.getElementById('mobile-live-terminal-frame');
        }
        const targetFrame = frameEl || (this._mobileTerminalMode === 'interactive'
            ? this.mobileLiveTerminalFrameEl
            : this.terminalFrame);
        if (!targetFrame?.contentWindow) return;
        try {
            targetFrame.contentWindow.postMessage(message, window.location.origin);
        } catch (error) {
            // ignore
        }
    };

    AppClass.prototype.scheduleTerminalFrameLayoutSync = function(layout) {
        this._latestMobileViewportLayout = layout || null;
        if (!this.mobileLiveTerminalFrameEl) {
            this.mobileLiveTerminalFrameEl = document.getElementById('mobile-live-terminal-frame');
        }
        if (!this.isMobile() || this._mobileTerminalMode !== 'interactive' || !this.mobileLiveTerminalFrameEl) {
            return;
        }
        if (!this.mobileLiveTerminalModalEl?.classList.contains('active')) {
            return;
        }
        if (this._terminalFrameLayoutSyncRaf) {
            window.cancelAnimationFrame(this._terminalFrameLayoutSyncRaf);
        }
        this._terminalFrameLayoutSyncRaf = window.requestAnimationFrame(() => {
            this._terminalFrameLayoutSyncRaf = null;
            if (!this._latestMobileViewportLayout || this._mobileTerminalMode !== 'interactive') return;
            const safeLayout = buildSafeMobileTerminalLayout(this._latestMobileViewportLayout, this.mobileLiveTerminalFrameEl);
            if (!safeLayout) {
                console.warn('[MOBILE_TERMINAL_GEOMETRY] skipped unsafe mobile terminal layout', {
                    sessionId: this._mobileLiveTerminalSessionId,
                    layout: this._latestMobileViewportLayout
                });
                return;
            }
            this.postTerminalFrameMessage({
                type: 'bb-terminal-layout',
                source: 'brainbase-mobile-keyboard',
                ...safeLayout
            }, this.mobileLiveTerminalFrameEl);
        });
    };

    AppClass.prototype._handleMobileViewportChange = function(layout) {
        this._latestMobileViewportLayout = layout || null;
        this.scheduleTerminalFrameLayoutSync(layout);
    };
}
