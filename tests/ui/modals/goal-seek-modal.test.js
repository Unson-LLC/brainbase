import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GoalSeekModal } from '../../../public/modules/ui/modals/goal-seek-modal.js';
import { eventBus, EVENTS } from '../../../public/modules/core/event-bus.js';

// DOM Helper: モーダルHTML構造を作成
function createModalHTML() {
    return `
        <div id="goal-seek-modal" class="modal hidden">
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Goal Seek</h2>
                    <button id="goal-seek-modal-close" class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <!-- パラメータ入力フォーム -->
                    <form id="goal-seek-form">
                        <div class="form-group">
                            <label for="goal-target">Target</label>
                            <input type="number" id="goal-target" name="target" value="0">
                        </div>
                        <div class="form-group">
                            <label for="goal-current">Current</label>
                            <input type="number" id="goal-current" name="current" value="0">
                        </div>
                        <div class="form-group">
                            <label for="goal-unit">Unit</label>
                            <select id="goal-unit" name="unit">
                                <option value="yen">Yen</option>
                                <option value="ten_thousand_yen">Ten Thousand Yen</option>
                                <option value="count">Count</option>
                                <option value="percent">Percent</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="goal-period">Period (days)</label>
                            <input type="number" id="goal-period" name="period" value="30" min="1" max="365">
                        </div>
                        <div class="form-group">
                            <label for="goal-variable">Variable</label>
                            <select id="goal-variable" name="variable">
                                <option value="daily_actions">Daily Actions</option>
                                <option value="daily_revenue">Daily Revenue</option>
                                <option value="conversion_rate">Conversion Rate</option>
                            </select>
                        </div>
                    </form>

                    <!-- 介入要求表示エリア -->
                    <div id="intervention-header" class="intervention-header">
                        <h3 id="intervention-title"></h3>
                    </div>

                    <!-- 介入理由 -->
                    <div id="intervention-reason" class="intervention-reason">
                        <p id="intervention-message"></p>
                    </div>

                    <!-- 計算結果詳細 -->
                    <div id="calculation-details" class="calculation-details">
                        <div class="detail-item">
                            <span class="label">Gap:</span>
                            <span id="detail-gap" class="value"></span>
                        </div>
                        <div class="detail-item">
                            <span class="label">Period:</span>
                            <span id="detail-period" class="value"></span>
                        </div>
                        <div class="detail-item">
                            <span class="label">Required Daily:</span>
                            <span id="detail-daily" class="value"></span>
                        </div>
                    </div>

                    <!-- 選択肢ボタン -->
                    <div id="intervention-options" class="intervention-options"></div>

                    <!-- タイムアウト表示 -->
                    <div id="intervention-timeout" class="intervention-timeout">
                        <span>Time remaining: </span>
                        <span id="timeout-value"></span>
                    </div>
                </div>
                <div class="modal-footer">
                    <button id="goal-seek-modal-submit" class="btn-primary">Submit</button>
                    <button id="intervention-proceed-btn" class="btn-primary">Proceed</button>
                    <button id="intervention-abort-btn" class="btn-secondary">Abort</button>
                    <button id="intervention-modify-btn" class="btn-secondary">Modify</button>
                </div>
            </div>
        </div>
    `;
}

describe('GoalSeekModal', () => {
    let modal;
    let modalElement;

    beforeEach(() => {
        // DOM準備
        document.body.innerHTML = createModalHTML();
        modalElement = document.getElementById('goal-seek-modal');

        modal = new GoalSeekModal({ eventBus });

        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() => {
        modal.unmount();
        vi.useRealTimers();
        document.body.innerHTML = '';
    });

    describe('UT-061: モーダル表示', () => {
        it('should show modal when show() is called', () => {
            modal.mount();

            // Initially hidden
            expect(modalElement.classList.contains('hidden')).toBe(true);

            // Show modal
            modal.show();

            expect(modalElement.classList.contains('hidden')).toBe(false);
        });

        it('should emit MODAL_OPENED event when shown', () => {
            const emitSpy = vi.spyOn(eventBus, 'emit');
            modal.mount();
            modal.show();

            expect(emitSpy).toHaveBeenCalledWith(EVENTS.MODAL_OPENED, expect.objectContaining({
                modalId: 'goal-seek-modal'
            }));
        });
    });

    describe('UT-062: モーダル非表示', () => {
        it('should hide modal when hide() is called', () => {
            modal.mount();
            modal.show();

            expect(modalElement.classList.contains('hidden')).toBe(false);

            modal.hide();

            expect(modalElement.classList.contains('hidden')).toBe(true);
        });

        it('should emit MODAL_CLOSED event when hidden', () => {
            const emitSpy = vi.spyOn(eventBus, 'emit');
            modal.mount();
            modal.show();
            modal.hide();

            expect(emitSpy).toHaveBeenCalledWith(EVENTS.MODAL_CLOSED, expect.objectContaining({
                modalId: 'goal-seek-modal'
            }));
        });
    });

    describe('UT-063: フォーム入力値取得', () => {
        it('should return correct params from getParams()', () => {
            modal.mount();

            // Set form values
            document.getElementById('goal-target').value = '10000000';
            document.getElementById('goal-current').value = '3000000';
            document.getElementById('goal-unit').value = 'yen';
            document.getElementById('goal-period').value = '30';
            document.getElementById('goal-variable').value = 'daily_actions';

            const params = modal.getParams();

            expect(params).toEqual({
                target: 10000000,
                current: 3000000,
                unit: 'yen',
                period: 30,
                variable: 'daily_actions'
            });
        });
    });

    describe('UT-064: 必須項目未入力バリデーション', () => {
        it('should return validation error when target is empty', () => {
            modal.mount();

            document.getElementById('goal-target').value = '';
            document.getElementById('goal-current').value = '100';
            document.getElementById('goal-period').value = '30';

            const result = modal.validate();

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('target is required');
        });

        it('should return validation error when current is empty', () => {
            modal.mount();

            document.getElementById('goal-target').value = '1000';
            document.getElementById('goal-current').value = '';
            document.getElementById('goal-period').value = '30';

            const result = modal.validate();

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('current is required');
        });
    });

    describe('UT-065: 期間境界値（最小）', () => {
        it('should accept period = 1', () => {
            modal.mount();

            document.getElementById('goal-target').value = '1000';
            document.getElementById('goal-current').value = '100';
            document.getElementById('goal-period').value = '1';

            const result = modal.validate();

            expect(result.valid).toBe(true);
        });
    });

    describe('UT-066: 期間境界値（最大）', () => {
        it('should accept period = 365', () => {
            modal.mount();

            document.getElementById('goal-target').value = '1000';
            document.getElementById('goal-current').value = '100';
            document.getElementById('goal-period').value = '365';

            const result = modal.validate();

            expect(result.valid).toBe(true);
        });
    });

    describe('UT-067: 期間境界値超過', () => {
        it('should reject period = 366', () => {
            modal.mount();

            document.getElementById('goal-target').value = '1000';
            document.getElementById('goal-current').value = '100';
            document.getElementById('goal-period').value = '366';

            const result = modal.validate();

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('period must be between 1 and 365');
        });

        it('should reject period = 0', () => {
            modal.mount();

            document.getElementById('goal-target').value = '1000';
            document.getElementById('goal-current').value = '100';
            document.getElementById('goal-period').value = '0';

            const result = modal.validate();

            expect(result.valid).toBe(false);
        });

        it('should reject negative period', () => {
            modal.mount();

            document.getElementById('goal-target').value = '1000';
            document.getElementById('goal-current').value = '100';
            document.getElementById('goal-period').value = '-1';

            const result = modal.validate();

            expect(result.valid).toBe(false);
        });
    });

    describe('UT-068: 単位選択', () => {
        it('should return correct unit value', () => {
            modal.mount();

            document.getElementById('goal-unit').value = 'ten_thousand_yen';

            const params = modal.getParams();

            expect(params.unit).toBe('ten_thousand_yen');
        });
    });

    describe('UT-069: 変数選択', () => {
        it('should return correct variable value', () => {
            modal.mount();

            document.getElementById('goal-variable').value = 'daily_revenue';

            const params = modal.getParams();

            expect(params.variable).toBe('daily_revenue');
        });
    });

    describe('UT-070: Submitボタンクリック', () => {
        it('should call calculate callback when submit button is clicked', () => {
            const mockCallback = vi.fn();
            modal = new GoalSeekModal({ eventBus, onCalculate: mockCallback });
            modal.mount();

            // Set valid form values
            document.getElementById('goal-target').value = '1000';
            document.getElementById('goal-current').value = '100';
            document.getElementById('goal-period').value = '30';

            const submitBtn = document.getElementById('goal-seek-modal-submit');
            submitBtn.click();

            expect(mockCallback).toHaveBeenCalledWith(expect.objectContaining({
                target: 1000,
                current: 100,
                period: 30
            }));
        });

        it('should not call calculate callback when validation fails', () => {
            const mockCallback = vi.fn();
            modal = new GoalSeekModal({ eventBus, onCalculate: mockCallback });
            modal.mount();

            // Invalid form values
            document.getElementById('goal-target').value = '';
            document.getElementById('goal-current').value = '';
            document.getElementById('goal-period').value = '0';

            const submitBtn = document.getElementById('goal-seek-modal-submit');
            submitBtn.click();

            expect(mockCallback).not.toHaveBeenCalled();
        });
    });

    describe('介入要求表示', () => {
        it('should display intervention options with textContent (XSS safe)', () => {
            modal.mount();

            const intervention = {
                title: '<script>alert("xss")</script>',
                message: '<img src=x onerror=alert("xss")>',
                options: [
                    { id: 'a', label: 'Option A' },
                    { id: 'b', label: 'Option B' }
                ]
            };

            modal.showIntervention(intervention);

            // Should use textContent, not innerHTML
            const titleEl = document.getElementById('intervention-title');
            expect(titleEl.textContent).toBe('<script>alert("xss")</script>');
            expect(titleEl.innerHTML).not.toContain('<script>');

            const messageEl = document.getElementById('intervention-message');
            expect(messageEl.textContent).toBe('<img src=x onerror=alert("xss")>');
            expect(messageEl.innerHTML).not.toContain('<img');
        });

        it('should create option buttons for intervention choices', () => {
            modal.mount();

            const intervention = {
                title: 'Select Strategy',
                message: 'Choose an approach',
                options: [
                    { id: 'aggressive', label: 'Aggressive' },
                    { id: 'conservative', label: 'Conservative' }
                ]
            };

            modal.showIntervention(intervention);

            const optionsContainer = document.getElementById('intervention-options');
            const buttons = optionsContainer.querySelectorAll('button');

            expect(buttons.length).toBe(2);
            expect(buttons[0].textContent).toBe('Aggressive');
            expect(buttons[1].textContent).toBe('Conservative');
        });
    });

    describe('タイムアウト表示', () => {
        it('should display remaining time until intervention expires', () => {
            modal.mount();

            const expiresAt = new Date(Date.now() + 60000).toISOString(); // 1 minute from now
            const intervention = {
                title: 'Test',
                message: 'Test message',
                expiresAt
            };

            modal.showIntervention(intervention);
            vi.advanceTimersByTime(0);

            const timeoutValue = document.getElementById('timeout-value');
            expect(timeoutValue.textContent).toMatch(/\d+s/);
        });

        it('should update timeout display every second', () => {
            modal.mount();

            const expiresAt = new Date(Date.now() + 10000).toISOString(); // 10 seconds
            const intervention = {
                title: 'Test',
                message: 'Test message',
                expiresAt
            };

            modal.showIntervention(intervention);

            const getTimeoutText = () => document.getElementById('timeout-value').textContent;

            vi.advanceTimersByTime(0);
            const initial = getTimeoutText();

            vi.advanceTimersByTime(1000);
            const after1s = getTimeoutText();

            expect(after1s).not.toBe(initial);
        });
    });

    describe('計算結果詳細表示', () => {
        it('should display calculation details', () => {
            modal.mount();

            const calculation = {
                gap: 7000000,
                period: 30,
                requiredDaily: 233333
            };

            modal.showCalculationDetails(calculation);

            expect(document.getElementById('detail-gap').textContent).toBe('7,000,000');
            expect(document.getElementById('detail-period').textContent).toBe('30');
            expect(document.getElementById('detail-daily').textContent).toBe('233,333');
        });
    });

    describe('選択肢ボタン (proceed, abort, modify)', () => {
        it('should emit proceed event when Proceed button is clicked', () => {
            const emitSpy = vi.spyOn(eventBus, 'emit');
            modal.mount();
            modal.show();

            document.getElementById('intervention-proceed-btn').click();

            expect(emitSpy).toHaveBeenCalledWith(EVENTS.GOAL_SEEK_INTERVENTION_RESPONSE, expect.objectContaining({
                action: 'proceed'
            }));
        });

        it('should emit abort event when Abort button is clicked', () => {
            const emitSpy = vi.spyOn(eventBus, 'emit');
            modal.mount();
            modal.show();

            document.getElementById('intervention-abort-btn').click();

            expect(emitSpy).toHaveBeenCalledWith(EVENTS.GOAL_SEEK_INTERVENTION_RESPONSE, expect.objectContaining({
                action: 'abort'
            }));
        });

        it('should emit modify event when Modify button is clicked', () => {
            const emitSpy = vi.spyOn(eventBus, 'emit');
            modal.mount();
            modal.show();

            document.getElementById('intervention-modify-btn').click();

            expect(emitSpy).toHaveBeenCalledWith(EVENTS.GOAL_SEEK_INTERVENTION_RESPONSE, expect.objectContaining({
                action: 'modify'
            }));
        });

        it('should hide modal when action button is clicked', () => {
            modal.mount();
            modal.show();

            document.getElementById('intervention-proceed-btn').click();

            expect(modalElement.classList.contains('hidden')).toBe(true);
        });
    });

    describe('unmount', () => {
        it('should clean up event listeners and timers', () => {
            modal.mount();

            const expiresAt = new Date(Date.now() + 60000).toISOString();
            modal.showIntervention({
                title: 'Test',
                message: 'Test',
                expiresAt
            });

            // Should not throw after unmount
            expect(() => modal.unmount()).not.toThrow();

            // Timer should be cleared
            vi.advanceTimersByTime(5000);
            // No error should occur
        });
    });
});
