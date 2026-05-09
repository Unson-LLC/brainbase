import { appStore } from '../core/store.js';
import { shouldUseXtermTransport } from '../core/terminal-transport-client.js';
import { scheduleAfterNextPaint } from './schedule-after-next-paint.js';

function isVisibleTerminalElement(element) {
    if (!element || element.classList?.contains('hidden')) return false;
    return window.getComputedStyle(element).display !== 'none';
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
            this._restoreTerminalFrameAfterReveal(frame, reason);
            return;
        }

        window.dispatchEvent(new Event('resize'));
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
