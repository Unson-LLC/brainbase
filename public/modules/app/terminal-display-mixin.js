import { appStore } from '../core/store.js';
import { shouldUseXtermTransport } from '../core/terminal-transport-client.js';
import { scheduleAfterNextPaint } from './schedule-after-next-paint.js';

const BLANK_TERMINAL_FRAME_REPAIR_DELAYS_MS = [80, 180, 360, 720, 1200, 1800];
const BLANK_TERMINAL_FRAME_PENDING_RETRY_MS = 1200;
const BLANK_TERMINAL_FRAME_PENDING_STALE_MS = 5000;

function isVisibleTerminalElement(element) {
    if (!element || element.classList?.contains('hidden')) return false;
    return window.getComputedStyle(element).display !== 'none';
}

function isBlankTerminalFrame(frame) {
    const src = frame?.getAttribute?.('src') || '';
    return !src || src === 'about:blank';
}

function isPendingTerminalSwitchStale(pending) {
    const startedAt = Number(pending?.startedAt || 0);
    return startedAt > 0 && Date.now() - startedAt >= BLANK_TERMINAL_FRAME_PENDING_STALE_MS;
}

function isBlockedTerminalStatus(status) {
    return status?.terminalAccess?.state === 'blocked'
        || status?.blockedAccess?.state === 'blocked'
        || status?.runtimeState === 'blocked_by_owner';
}

function canTakeoverTerminalStatus(status) {
    return Boolean(status?.terminalAccess?.canTakeover || status?.blockedAccess?.canTakeover);
}

function isLiveTerminalStatus(status) {
    return Boolean(status?.mode === 'live' && status?.connected === true && !isBlockedTerminalStatus(status));
}

export function applyTerminalDisplayMixin(AppClass) {
    AppClass.prototype.syncMobileTerminalReserve = function(
        viewportHeight = window.visualViewport?.height || window.innerHeight,
        viewportTop = window.visualViewport?.offsetTop || 0
    ) {
        const stageRect = document.getElementById('terminal-stage')?.getBoundingClientRect();
        const consoleRect = document.querySelector('.console-area')?.getBoundingClientRect();
        const visualBottom = viewportTop + viewportHeight;
        const overlays = [
            document.querySelector('.mobile-input-dock'),
            document.getElementById('mobile-bottom-nav')
        ].filter(Boolean);

        const visibleRects = overlays
            .filter((el) => window.getComputedStyle(el).display !== 'none')
            .map((el) => el.getBoundingClientRect())
            .filter((rect) => rect.height > 0);

        const obstructionTop = visibleRects.length > 0
            ? Math.min(...visibleRects.map((rect) => rect.top))
            : visualBottom;
        const stageTop = stageRect?.top || consoleRect?.top || viewportTop;
        const reserve = Math.max(0, Math.round(visualBottom - obstructionTop));
        const stageHeight = Math.max(0, Math.round(obstructionTop - stageTop));

        document.body.style.setProperty('--mobile-terminal-reserve', `${reserve}px`);
        document.body.style.setProperty('--mobile-terminal-stage-height', `${stageHeight}px`);
        document.body.style.setProperty('--mobile-terminal-stage-top', `${Math.round(stageTop)}px`);
        document.body.style.setProperty('--mobile-terminal-stage-left', `${Math.round(consoleRect?.left || 0)}px`);
        document.body.style.setProperty('--mobile-terminal-stage-width', `${Math.round(consoleRect?.width || window.innerWidth)}px`);
        return reserve;
    };

    AppClass.prototype._shouldUseXtermTransport = function() {
        return shouldUseXtermTransport();
    };

    AppClass.prototype._isXtermTransportActive = function(sessionId = appStore.getState().currentSessionId) {
        return Boolean(this._shouldUseXtermTransport() && this.terminalTransportClient?.isActiveForSession(sessionId));
    };

    AppClass.prototype._shouldAutoFocusTerminalSurface = function() {
        return !this.isMobile();
    };

    AppClass.prototype._clearScheduledTerminalAutoFocus = function() {
        this._terminalAutoFocusTimers.forEach(timerId => window.clearTimeout(timerId));
        this._terminalAutoFocusTimers.clear();
    };

    AppClass.prototype._scheduleTerminalAutoFocus = function(reason = 'unknown', delays = [75, 200]) {
        if (!this._shouldAutoFocusTerminalSurface()) return;
        const sessionId = appStore.getState().currentSessionId;
        if (!sessionId) return;

        delays.forEach((delay) => {
            const timerId = window.setTimeout(() => {
                this._terminalAutoFocusTimers.delete(timerId);
                if (appStore.getState().currentSessionId !== sessionId) return;
                if (!this._shouldAutoFocusTerminalSurface() || !this._isConsoleVisible()) return;
                this.focusTerminal(reason);
            }, delay);
            this._terminalAutoFocusTimers.add(timerId);
        });
    };

    AppClass.prototype._triggerTerminalAutoFocus = function(reason = 'unknown', delays = [75, 200]) {
        this._clearScheduledTerminalAutoFocus();
        if (!this._shouldAutoFocusTerminalSurface()) return;
        if (!appStore.getState().currentSessionId) return;
        this.focusTerminal(reason);
        this._scheduleTerminalAutoFocus(reason, delays);
    };

    AppClass.prototype._isMobileSnapshotMode = function() {
        return this.isMobile() && this._mobileTerminalMode !== 'interactive';
    };

    AppClass.prototype._showXtermTransport = function() {
        this._restoreSnapshotPanelPosition();
        this.terminalXtermHost?.classList.remove('hidden');
        this.terminalFrame?.classList.add('hidden');
        this.terminalSnapshotPanelEl?.classList.add('hidden');
        const consoleArea = document.getElementById('console-area');
        consoleArea?.classList.add('using-xterm');
        consoleArea?.classList.remove('using-snapshot');
    };

    AppClass.prototype._clearTerminalFrame = function(frameEl) {
        const frame = frameEl || this.terminalFrame;
        if (!frame) return;
        frame.classList.add('terminal-frame-clearing');
        frame.src = 'about:blank';
    };

    AppClass.prototype._showTerminalFrame = function(frameEl) {
        const frame = frameEl || this.terminalFrame;
        if (!frame) return;
        frame.classList.remove('terminal-frame-clearing');
    };

    AppClass.prototype._showTtydIframe = function() {
        this._restoreSnapshotPanelPosition();
        this.terminalXtermHost?.classList.add('hidden');
        this.terminalFrame?.classList.remove('hidden');
        this.terminalSnapshotPanelEl?.classList.add('hidden');
        const consoleArea = document.getElementById('console-area');
        consoleArea?.classList.remove('using-xterm');
        consoleArea?.classList.remove('using-snapshot');
    };

    AppClass.prototype._restoreSnapshotPanelPosition = function() {
        const panel = this.terminalSnapshotPanelEl || document.getElementById('terminal-snapshot-panel');
        if (panel && this._snapshotPanelOriginalParent && panel.parentElement === document.body) {
            this._snapshotPanelOriginalParent.appendChild(panel);
            this._snapshotPanelOriginalParent = null;
        }
    };

    AppClass.prototype._isSessionSwitchCurrent = function(sessionId, switchToken = null) {
        if (!sessionId) return false;
        if (switchToken != null && switchToken !== this._sessionSwitchToken) return false;
        return appStore.getState().currentSessionId === sessionId;
    };

    AppClass.prototype._isCurrentSessionSnapshotDisplay = function(sessionId, switchToken = null) {
        if (!this._isSessionSwitchCurrent(sessionId, switchToken)) return false;
        const consoleArea = document.getElementById('console-area');
        const snapshotVisible = this.terminalSnapshotPanelEl
            ? !this.terminalSnapshotPanelEl.classList.contains('hidden')
            : !document.getElementById('terminal-snapshot-panel')?.classList.contains('hidden');
        const xtermHidden = this.terminalXtermHost
            ? this.terminalXtermHost.classList.contains('hidden')
            : document.getElementById('terminal-xterm-host')?.classList.contains('hidden');
        return Boolean(snapshotVisible && xtermHidden);
    };

    AppClass.prototype._showSnapshotDisplay = function(sessionId, { title = 'Terminal display', snapshot = null } = {}) {
        this.terminalXtermHost?.classList.add('hidden');
        this.terminalFrame?.classList.add('hidden');
        const consoleArea = document.getElementById('console-area');
        consoleArea?.classList.remove('using-xterm');
        if (this.isMobile()) {
            consoleArea?.classList.add('using-snapshot');
            // iOS Safari: overflow:hidden ancestors clip fixed-position text rendering.
            // Move snapshot panel to body so it escapes the clipping context.
            const panel = this.terminalSnapshotPanelEl || document.getElementById('terminal-snapshot-panel');
            if (panel && panel.parentElement !== document.body) {
                this._snapshotPanelOriginalParent = panel.parentElement;
                document.body.appendChild(panel);
            }
            // Offset snapshot panel below mobile tab bar
            if (panel) {
                const tabBar = document.getElementById('mobile-tab-bar');
                const tabBarH = tabBar ? tabBar.offsetHeight : 0;
                if (tabBarH > 0) {
                    document.body.style.setProperty('--mobile-tab-bar-height', `${tabBarH}px`);
                }
            }
            this.syncMobileTerminalReserve(
                window.visualViewport?.height || window.innerHeight,
                window.visualViewport?.offsetTop || 0
            );
        } else {
            // デスクトップではusing-snapshotを使わない（モバイルCSSが発火して崩れるため）
            consoleArea?.classList.remove('using-snapshot');
            this._restoreSnapshotPanelPosition();
            this._renderTerminalSnapshotPanel({
                visible: true,
                snapshot: snapshot || this._terminalSnapshotCache.get(sessionId) || null,
                title
            });
        }
    };

    AppClass.prototype._isConsoleVisible = function() {
        const consoleArea = document.getElementById('console-area');
        if (!consoleArea) return false;
        return window.getComputedStyle(consoleArea).display !== 'none';
    };

    AppClass.prototype._scheduleTerminalViewportSync = function() {
        scheduleAfterNextPaint(() => {
            if (!this._isConsoleVisible()) return;
            this._restoreTerminalSurfaceAfterReveal('viewport-sync');
        });
    };

    AppClass.prototype._isTerminalTransportReadyAfterReveal = function(sessionId = appStore.getState().currentSessionId) {
        if (!this._shouldUseXtermTransport?.()) return false;
        if (!this.terminalTransportClient?.isActiveForSession?.(sessionId)) return false;
        return isLiveTerminalStatus(this.terminalTransportClient?.getStatus?.() || {});
    };

    AppClass.prototype._restoreTerminalAfterFileViewerClose = async function(targetSessionId = null) {
        const initialState = appStore.getState();
        const currentSessionId = initialState.currentSessionId || null;
        const sessionId = targetSessionId || currentSessionId;
        const restoreToken = (this._fileViewerCloseRestoreToken || 0) + 1;
        this._fileViewerCloseRestoreToken = restoreToken;

        const revealConsole = () => {
            if (this.isMobile() && this.mobileTabController) {
                this.mobileTabController.switchTab('terminal');
                return;
            }
            if (typeof this.showConsole === 'function') {
                this.showConsole();
                return;
            }
            document.body?.classList?.remove('file-viewer-active');
            const consoleArea = document.getElementById('console-area');
            const fileViewerPanel = document.getElementById('file-viewer-panel');
            if (consoleArea) consoleArea.style.display = 'flex';
            if (fileViewerPanel) fileViewerPanel.style.display = 'none';
        };

        revealConsole();

        let switchedOnClose = false;
        if (sessionId && sessionId !== currentSessionId) {
            switchedOnClose = true;
            try {
                await this.switchSession?.(sessionId, {
                    previousSessionId: currentSessionId,
                    recoveryReason: 'file-viewer-close'
                });
            } catch (error) {
                console.warn('[file-viewer-close] Session restore failed after console reveal:', error);
            }
            if (!this._isConsoleVisible()) {
                revealConsole();
            }
        }

        scheduleAfterNextPaint(() => {
            if (this._fileViewerCloseRestoreToken !== restoreToken) return;
            if (!this._isConsoleVisible()) {
                revealConsole();
            }
            if (!this._isConsoleVisible()) return;

            const activeSessionId = appStore.getState().currentSessionId || sessionId;
            if (!activeSessionId || (sessionId && activeSessionId !== sessionId)) return;

            const status = this.terminalTransportClient?.getStatus?.() || {};
            if (this._isTerminalTransportReadyAfterReveal(activeSessionId)) {
                void this.terminalTransportClient?.restoreAfterReveal?.();
                return;
            }

            if (this._shouldUseXtermTransport?.()) {
                if (isBlockedTerminalStatus(status) && canTakeoverTerminalStatus(status) && this.takeOverCurrentTerminal) {
                    void this.takeOverCurrentTerminal();
                    return;
                }
                if (!switchedOnClose) {
                    void this.switchSession?.(activeSessionId, {
                        previousSessionId: activeSessionId,
                        recoveryReason: 'file-viewer-close'
                    });
                    return;
                }
            }

            this._restoreTerminalSurfaceAfterReveal('file-viewer-close');
        });
    };

    AppClass.prototype._restoreTerminalSurfaceAfterReveal = function(reason = 'unknown') {
        if (!this._isConsoleVisible()) return;

        const xtermHost = this.terminalXtermHost || document.getElementById('terminal-xterm-host');
        if (isVisibleTerminalElement(xtermHost) && this.terminalTransportClient?.restoreAfterReveal) {
            void this.terminalTransportClient.restoreAfterReveal();
            return;
        }

        const frame = this._mobileTerminalMode === 'interactive'
            ? this.mobileLiveTerminalFrameEl || document.getElementById('mobile-live-terminal-frame')
            : this.terminalFrame || document.getElementById('terminal-frame');
        if (isVisibleTerminalElement(frame)) {
            if (this._repairBlankTerminalFrameAfterReveal(frame, reason)) {
                return;
            }
            this._restoreTerminalFrameAfterReveal(frame, reason);
            return;
        }

        window.dispatchEvent(new Event('resize'));
    };

    AppClass.prototype._resolveTerminalRecoverySessionId = function() {
        const state = appStore.getState();
        return state.currentSessionId
            || this._terminalPresentationSessionId
            || document.querySelector('.session-child-row.active')?.dataset?.id
            || null;
    };

    AppClass.prototype._clearScheduledBlankTerminalFrameRepair = function() {
        if (!this._blankTerminalFrameRepairTimer) return;
        window.clearTimeout(this._blankTerminalFrameRepairTimer);
        this._blankTerminalFrameRepairTimer = null;
    };

    AppClass.prototype._scheduleBlankTerminalFrameRepair = function(reason = 'unknown', attempt = 0) {
        if (attempt >= BLANK_TERMINAL_FRAME_REPAIR_DELAYS_MS.length) {
            this._clearScheduledBlankTerminalFrameRepair();
            if (this._pendingTerminalSwitch) {
                this._blankTerminalFrameRepairTimer = window.setTimeout(() => {
                    this._blankTerminalFrameRepairTimer = null;
                    if (!this._isConsoleVisible()) return;

                    const frame = this._mobileTerminalMode === 'interactive'
                        ? this.mobileLiveTerminalFrameEl || document.getElementById('mobile-live-terminal-frame')
                        : this.terminalFrame || document.getElementById('terminal-frame');
                    if (!isVisibleTerminalElement(frame)) return;

                    this._repairBlankTerminalFrameAfterReveal(frame, `${reason}:pending-wait`, attempt);
                }, BLANK_TERMINAL_FRAME_PENDING_RETRY_MS);
                return true;
            }
            window.dispatchEvent(new Event('resize'));
            return true;
        }
        if (this._blankTerminalFrameRepairTimer) return true;

        const delay = BLANK_TERMINAL_FRAME_REPAIR_DELAYS_MS[attempt];
        this._blankTerminalFrameRepairTimer = window.setTimeout(() => {
            this._blankTerminalFrameRepairTimer = null;
            if (!this._isConsoleVisible()) return;

            const frame = this._mobileTerminalMode === 'interactive'
                ? this.mobileLiveTerminalFrameEl || document.getElementById('mobile-live-terminal-frame')
                : this.terminalFrame || document.getElementById('terminal-frame');
            if (!isVisibleTerminalElement(frame)) return;

            if (this._repairBlankTerminalFrameAfterReveal(frame, `${reason}:retry-${attempt + 1}`, attempt + 1)) {
                return;
            }
            if (!isBlankTerminalFrame(frame)) {
                this._restoreTerminalFrameAfterReveal(frame, `${reason}:retry-${attempt + 1}`);
            }
        }, delay);
        return true;
    };

    AppClass.prototype._repairBlankTerminalFrameAfterReveal = function(frame, reason = 'unknown', attempt = 0) {
        if (!isBlankTerminalFrame(frame)) return false;
        if (this._pendingTerminalSwitch && !isPendingTerminalSwitchStale(this._pendingTerminalSwitch)) {
            return this._scheduleBlankTerminalFrameRepair(reason, attempt);
        }

        const sessionId = this._resolveTerminalRecoverySessionId();
        if (!sessionId) {
            return this._scheduleBlankTerminalFrameRepair(reason, attempt);
        }

        const session = this._getSessionById?.(sessionId)
            || (appStore.getState().sessions || []).find((item) => item?.id === sessionId);
        if (session?.intendedState === 'archived') return false;
        if (typeof this.switchSession !== 'function') {
            return this._scheduleBlankTerminalFrameRepair(reason, attempt);
        }

        this._clearScheduledBlankTerminalFrameRepair();
        void this.switchSession(sessionId, {
            forceTtyd: true,
            previousSessionId: sessionId,
            recoveryReason: reason
        });
        return true;
    };

    AppClass.prototype._restoreTerminalFrameAfterReveal = function(frame, reason = 'unknown') {
        const rect = frame.getBoundingClientRect?.();
        const width = Math.max(0, Math.round(rect?.width || frame.clientWidth || 0));
        const height = Math.max(0, Math.round(rect?.height || frame.clientHeight || 0));

        frame.classList.add('terminal-frame-revealing');
        try {
            frame.focus?.();
        } catch (error) {
            // ignore
        }
        try {
            frame.contentWindow?.focus?.();
        } catch (error) {
            // ignore
        }
        const postFrameMessage = (message) => {
            if (typeof this.postTerminalFrameMessage === 'function') {
                this.postTerminalFrameMessage(message, frame);
                return;
            }
            try {
                frame.contentWindow?.postMessage?.(message, window.location.origin);
            } catch (error) {
                // ignore
            }
        };
        postFrameMessage({ type: 'bb-terminal-layout', width, height, reason });
        postFrameMessage({ type: 'bb-terminal-reveal', reason });
        postFrameMessage({ type: 'bb-terminal-focus', reason });
        window.dispatchEvent(new Event('resize'));

        window.requestAnimationFrame?.(() => {
            frame.classList.remove('terminal-frame-revealing');
            postFrameMessage({ type: 'bb-terminal-reveal', reason: `${reason}:after-paint` });
        });
    };

    AppClass.prototype._isEditableTarget = function(target) {
        const el = target instanceof Element ? target : null;
        if (!el) return false;
        const tag = (el.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
        if (el.isContentEditable) return true;
        return Boolean(el.closest?.('[contenteditable="true"]'));
    };

    AppClass.prototype._getTerminalOverlayState = function() {
        const menuOverlay = document.getElementById('menu-overlay');
        const dropOverlay = document.getElementById('drop-overlay');
        const choiceOverlay = document.getElementById('choice-overlay');

        const menuActive = Boolean(menuOverlay && !menuOverlay.classList.contains('hidden'));
        const dropActive = Boolean(dropOverlay && dropOverlay.classList.contains('active'));
        const choiceActive = Boolean(choiceOverlay && choiceOverlay.classList.contains('active'));

        return {
            menuActive,
            dropActive,
            choiceActive,
            any: menuActive || dropActive || choiceActive
        };
    };

    AppClass.prototype.focusTerminal = function(reason = 'unknown') {
        if (!this._isConsoleVisible()) return;

        if (this._isXtermTransportActive()) {
            this.terminalTransportClient?.focus();
            this._updateTerminalInputStatus();
            return;
        }

        const frame = this._mobileTerminalMode === 'interactive'
            ? this.mobileLiveTerminalFrameEl || document.getElementById('mobile-live-terminal-frame')
            : this.terminalFrame || document.getElementById('terminal-frame');
        if (!frame) return;

        try {
            frame.focus?.();
        } catch (error) {
            // ignore
        }
        try {
            frame.contentWindow?.focus?.();
        } catch (error) {
            // ignore
        }
        try {
            // Best-effort: ask ttyd iframe to focus xterm helper textarea
            frame.contentWindow?.postMessage?.({ type: 'bb-terminal-focus', reason }, window.location.origin);
        } catch (error) {
            // ignore
        }

        this._updateTerminalInputStatus();
    };
}
