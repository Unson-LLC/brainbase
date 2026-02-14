import { calcKeyboardOffset } from './mobile-input-utils.js';

/**
 * MobileInputFocusManager
 *
 * モバイル入力欄のフォーカス管理とキーボード表示状態の同期を担当
 *
 * 責務:
 * - 入力欄のフォーカス状態管理
 * - visualViewport によるキーボード表示検知
 * - --keyboard-offset CSS変数の更新
 * - キーボードデバッグモードの表示
 */
export class MobileInputFocusManager {
    constructor(elements) {
        this.elements = elements;
        this.activeInput = null;
        this.inputFocused = false;
        this.viewport = null;
        this.viewportHandler = null;
        this.viewportBaseline = 0;
        this.viewportWidth = 0;
        this.keyboardSyncTimer = null;
        this.keyboardDebug = null;
        this.keyboardDebugDock = null;
        this.keyboardDebugMode = false;
        this.lastKeyboardData = null;
        this.lastKeyboardOffset = 0;
    }

    init() {
        this.bindViewportResize();
        this.bindKeyboardDebug();
    }

    setActiveInput(inputEl) {
        this.activeInput = inputEl;
        if (this.viewport) {
            const viewportWidth = this.viewport.width || 0;
            if (!this.viewportBaseline || viewportWidth !== this.viewportWidth || this.viewport.height > this.viewportBaseline) {
                this.viewportBaseline = this.viewport.height;
                this.viewportWidth = viewportWidth;
            }
        }
    }

    getActiveInput() {
        if (this.elements.composer?.classList.contains('active')) {
            return this.elements.composerInput;
        }
        return this.activeInput || this.elements.dockInput;
    }

    isInputFocused() {
        const active = document.activeElement;
        const terminalFrame = document.getElementById('terminal-frame');
        return this.inputFocused || active === this.elements.dockInput || active === this.elements.composerInput || active === terminalFrame;
    }

    syncKeyboardState() {
        if (this.viewportHandler) {
            this.viewportHandler();
        }
        const focused = this.isInputFocused();
        if (focused) {
            document.body.classList.add('keyboard-open');
        } else if (this.lastKeyboardOffset === 0) {
            document.body.classList.remove('keyboard-open');
        }
        if (this.lastKeyboardData) {
            this.updateKeyboardDebug(this.lastKeyboardData);
        }
    }

    scheduleKeyboardSync() {
        this.clearKeyboardSync();
        this.keyboardSyncTimer = window.setTimeout(() => {
            this.syncKeyboardState();
        }, 280);
    }

    clearKeyboardSync() {
        if (this.keyboardSyncTimer) {
            window.clearTimeout(this.keyboardSyncTimer);
            this.keyboardSyncTimer = null;
        }
    }

    scrollInputIntoView(inputEl) {
        if (!inputEl) return;

        // iOS Safari では focus() だけでは自動スクロールしないため、明示的に scrollIntoView を呼ぶ
        // behavior: "smooth" でスムーズにスクロール
        // block: "end" で画面の最下部に配置
        setTimeout(() => {
            inputEl.scrollIntoView({
                behavior: "smooth",
                block: "end",
                inline: "nearest"
            });
        }, 100);
    }

    refocusInput(inputEl) {
        if (!inputEl) return;

        // iOS Safari でボタンタップ後に入力欄にフォーカスを戻す
        // setTimeout を使うことでボタンのクリックイベントが完了してからフォーカスを当てる
        setTimeout(() => {
            inputEl.focus();
            this.scrollInputIntoView(inputEl);
        }, 150);
    }

    bindViewportResize() {
        if (!window.visualViewport) return;
        this.viewport = window.visualViewport;

        const update = () => {
            const viewportWidth = this.viewport.width || 0;
            if (!this.viewportBaseline || viewportWidth !== this.viewportWidth) {
                this.viewportBaseline = this.viewport.height;
                this.viewportWidth = viewportWidth;
            } else if (this.viewport.height > this.viewportBaseline) {
                this.viewportBaseline = this.viewport.height;
            }

            const baseline = this.viewportBaseline || this.viewport.height;
            const heightDelta = Math.max(0, baseline - this.viewport.height);
            const rawOffset = calcKeyboardOffset(baseline, this.viewport.height, this.viewport.offsetTop);
            const dockRect = this.elements.dock?.getBoundingClientRect();
            const visualHeight = this.viewport.height || window.innerHeight;
            // getBoundingClientRect() returns document coordinates, so adjust for visualViewport.offsetTop
            const dockGap = dockRect ? Math.round(visualHeight - (dockRect.bottom - this.viewport.offsetTop)) : 0;
            let offset = rawOffset > 0 ? rawOffset : heightDelta;
            const focusOpen = this.isInputFocused();
            // 安定化: offset が大きい場合は確実にキーボードが表示されている
            // offset が小さくてもフォーカスがあればキーボード表示中と判断
            let keyboardOpen = offset > 20 || (offset > 0 && focusOpen) || focusOpen;
            if (focusOpen && offset > 0) {
                // dockGap > 0: Dock is above visualViewport bottom -> reduce offset
                // dockGap < 0: Dock is below visualViewport bottom -> increase offset
                offset = Math.max(0, offset - dockGap);
            }
            // FIXME: この処理が逆効果になっている可能性
            // offset=0の時にdockGapを足すと、Dockがさらに上に浮いてしまう
            // if (focusOpen && offset === 0 && dockGap > 0) {
            //     offset = dockGap;
            //     keyboardOpen = true;
            // }
            document.body.style.setProperty('--keyboard-offset', `${offset}px`);
            document.documentElement.style.setProperty('--vvh', `${Math.round(this.viewport.height)}px`);
            document.documentElement.style.setProperty('--vv-top', `${Math.round(this.viewport.offsetTop || 0)}px`);
            document.documentElement.style.setProperty('--vv-left', `${Math.round(this.viewport.offsetLeft || 0)}px`);
            document.body.classList.toggle('keyboard-open', keyboardOpen);
            this.lastKeyboardOffset = offset;
            this.lastKeyboardData = { baseline, heightDelta, rawOffset, offset, keyboardOpen, dockGap, visualHeight };
            this.updateKeyboardDebug(this.lastKeyboardData);
        };

        this.viewportHandler = update;
        update();
        this.viewport.addEventListener('resize', update);
        this.viewport.addEventListener('scroll', update);
    }

    bindKeyboardDebug() {
        const params = new URLSearchParams(window.location.search);
        if (!params.has('kbdDebug') && localStorage.getItem('bb_keyboard_debug') !== '1') return;
        this.keyboardDebugMode = true;

        const panel = document.createElement('div');
        panel.className = 'keyboard-debug-panel';
        panel.style.position = 'fixed';
        panel.style.top = '8px';
        panel.style.right = '8px';
        panel.style.zIndex = '2005';
        panel.style.padding = '6px 8px';
        panel.style.borderRadius = '8px';
        panel.style.background = 'rgba(0, 0, 0, 0.75)';
        panel.style.color = '#a7f3d0';
        panel.style.fontSize = '10px';
        panel.style.fontFamily = 'monospace';
        panel.style.pointerEvents = 'none';
        panel.textContent = 'keyboard debug';
        document.body.appendChild(panel);
        this.keyboardDebug = panel;

        if (this.elements.dock) {
            const dockPanel = document.createElement('div');
            dockPanel.className = 'keyboard-debug-dock';
            dockPanel.textContent = 'keyboard debug';
            this.elements.dock.prepend(dockPanel);
            this.keyboardDebugDock = dockPanel;
        }
    }

    updateKeyboardDebug(data) {
        if (!this.keyboardDebug || !this.viewport) return;
        const dockRect = this.elements.dock?.getBoundingClientRect();
        const consoleRect = document.querySelector('.console-area')?.getBoundingClientRect();
        const mainRect = document.querySelector('.main-content')?.getBoundingClientRect();
        const bodyStyles = window.getComputedStyle(document.body);
        const mobileOffset = bodyStyles.getPropertyValue('--mobile-input-offset').trim();
        const keyboardOffset = bodyStyles.getPropertyValue('--keyboard-offset').trim();
        const visualHeight = data.visualHeight || this.viewport.height || window.innerHeight;
        const dockGap = typeof data.dockGap === 'number'
            ? data.dockGap
            : (dockRect ? Math.round(visualHeight - (dockRect.bottom - this.viewport.offsetTop)) : 0);
        const focused = this.isInputFocused();
        const lines = [
            `inner=${window.innerHeight}`,
            `vvH=${Math.round(this.viewport.height)}`,
            `vvTop=${Math.round(this.viewport.offsetTop || 0)}`,
            `vvB=${Math.round(visualHeight)}`,
            `base=${Math.round(data.baseline || 0)}`,
            `delta=${Math.round(data.heightDelta || 0)}`,
            `raw=${Math.round(data.rawOffset || 0)}`,
            `off=${Math.round(data.offset || 0)}`,
            `open=${data.keyboardOpen ? '1' : '0'}`,
            `focus=${focused ? '1' : '0'}`,
            `dockGap=${dockGap}`,
            `dockH=${dockRect ? Math.round(dockRect.height) : 0}`,
            `consoleH=${consoleRect ? Math.round(consoleRect.height) : 0}`,
            `mainH=${mainRect ? Math.round(mainRect.height) : 0}`,
            `mobOff=${mobileOffset || '0'}`,
            `keyOff=${keyboardOffset || '0'}`
        ];
        this.keyboardDebug.textContent = lines.join(' ');
        if (this.keyboardDebugDock) {
            this.keyboardDebugDock.textContent = lines.join(' ');
        }
    }

    destroy() {
        if (this.viewport && this.viewportHandler) {
            this.viewport.removeEventListener('resize', this.viewportHandler);
            this.viewport.removeEventListener('scroll', this.viewportHandler);
        }
        if (this.keyboardDebug) {
            this.keyboardDebug.remove();
            this.keyboardDebug = null;
        }
    }
}
