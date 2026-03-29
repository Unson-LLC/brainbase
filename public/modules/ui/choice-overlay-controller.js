import { refreshIcons } from '../ui-helpers.js';

export class ChoiceOverlayController {
    constructor({
        httpClient,
        store,
        isMobile,
        focusTerminal,
        showError
    }) {
        this.httpClient = httpClient;
        this.store = store;
        this.isMobile = typeof isMobile === 'function' ? isMobile : () => false;
        this.focusTerminal = typeof focusTerminal === 'function' ? focusTerminal : () => {};
        this.showError = typeof showError === 'function' ? showError : () => {};

        this._choiceCheckInterval = null;
        this._lastChoiceHash = null;
        this._boundHandleResize = this._handleResize.bind(this);
    }

    init() {
        this._setupResponsiveChoiceDetection();
    }

    destroy() {
        this._destroyChoiceOverlay();
    }

    _setupResponsiveChoiceDetection() {
        if (this.isMobile()) {
            this._startChoiceDetection();
        }

        window.addEventListener('resize', this._boundHandleResize);
    }

    _destroyChoiceOverlay() {
        window.removeEventListener('resize', this._boundHandleResize);
        this._stopChoiceDetection();
        this._hideChoicePanel({ restartDetection: false, focusTerminal: false, resetChoiceHash: true });
    }

    _handleResize() {
        if (this.isMobile() && !this._choiceCheckInterval) {
            this._startChoiceDetection();
            return;
        }

        if (!this.isMobile() && this._choiceCheckInterval) {
            this._stopChoiceDetection();
            this._hideChoicePanel({ restartDetection: false, focusTerminal: true, resetChoiceHash: true });
        }
    }

    _startChoiceDetection() {
        this._stopChoiceDetection();

        this._choiceCheckInterval = window.setInterval(async () => {
            const currentSessionId = this.store.getState().currentSessionId;
            if (!currentSessionId) return;

            try {
                const data = await this.httpClient.get(`/api/sessions/${currentSessionId}/output`);

                if (data.hasChoices && data.choices.length > 0) {
                    const choiceHash = JSON.stringify(data.choices);
                    if (choiceHash !== this._lastChoiceHash) {
                        this._lastChoiceHash = choiceHash;
                        this._showChoicePanel(data.choices);
                        this._stopChoiceDetection();
                    }
                }
            } catch (error) {
                console.error('Failed to check for choices:', error);
            }
        }, 2000);
    }

    _stopChoiceDetection() {
        if (!this._choiceCheckInterval) return;

        window.clearInterval(this._choiceCheckInterval);
        this._choiceCheckInterval = null;
    }

    _showChoicePanel(choices) {
        const elements = this._getOverlayElements();
        if (!elements) return;

        this._renderChoiceOverlay(elements.container, choices);
        elements.overlay.classList.add('active');
        elements.closeBtn.onclick = () => this._hideChoicePanel();
        refreshIcons();
    }

    _hideChoicePanel({ restartDetection = this.isMobile(), focusTerminal = true, resetChoiceHash = true } = {}) {
        const elements = this._getOverlayElements();
        elements?.overlay.classList.remove('active');

        if (elements?.container) {
            elements.container.innerHTML = '';
        }
        if (elements?.closeBtn) {
            elements.closeBtn.onclick = null;
        }

        if (resetChoiceHash) {
            this._lastChoiceHash = null;
        }
        if (restartDetection) {
            this._startChoiceDetection();
        }
        if (focusTerminal) {
            this.focusTerminal('closeChoiceOverlay');
        }
    }

    _renderChoiceOverlay(container, choices) {
        container.innerHTML = '';

        choices.forEach((choice) => {
            const button = document.createElement('button');
            button.className = 'choice-btn';
            button.textContent = choice.originalText || `${choice.number}) ${choice.text}`;
            button.onclick = () => {
                void this._selectChoice(choice.number);
            };
            container.appendChild(button);
        });
    }

    async _selectChoice(number) {
        const currentSessionId = this.store.getState().currentSessionId;
        if (!currentSessionId) return;

        try {
            await this.httpClient.post(`/api/sessions/${currentSessionId}/input`, {
                input: number,
                type: 'text'
            });

            await new Promise(resolve => window.setTimeout(resolve, 100));
            await this.httpClient.post(`/api/sessions/${currentSessionId}/input`, {
                input: 'Enter',
                type: 'key'
            });

            this._hideChoicePanel();
        } catch (error) {
            console.error('Failed to send choice:', error);
            this.showError('選択の送信に失敗しました');
        }
    }

    _getOverlayElements() {
        const overlay = document.getElementById('choice-overlay');
        const container = document.getElementById('choice-buttons');
        const closeBtn = document.getElementById('close-choice-overlay');

        if (!overlay || !container || !closeBtn) return null;

        return { overlay, container, closeBtn };
    }
}
