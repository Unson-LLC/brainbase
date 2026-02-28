/**
 * GoalSeekModal Unit Tests
 * TDD Phase 2: Modal Mode Switching (CREATE / UPDATE)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GoalSeekModal } from '../../public/modules/ui/modals/goal-seek-modal.js';
import { eventBus, EVENTS } from '../../public/modules/core/event-bus.js';

describe('GoalSeekModal', () => {
    let modal;
    let mockService;
    let modalElement;

    beforeEach(() => {
        // Mock GoalSeekService
        mockService = {
            getGoal: vi.fn(),
            createGoal: vi.fn(),
            updateGoal: vi.fn(),
            deleteGoal: vi.fn()
        };

        // Mock DOM
        document.body.innerHTML = '<div id="goal-seek-modal"></div>';
        modalElement = document.getElementById('goal-seek-modal');

        // Mock window.lucide
        global.window = {
            lucide: {
                createIcons: vi.fn()
            }
        };

        modal = new GoalSeekModal({
            eventBus,
            goalSeekService: mockService
        });

        modal.mount();
    });

    afterEach(() => {
        modal.unmount();
        document.body.innerHTML = '';
    });

    describe('Mode Switching', () => {
        it('show(sessionId, null)呼び出し時_CREATE modeになる', () => {
            // Act
            modal.show('session-1', null);

            // Assert: CREATE mode
            expect(modal._mode).toBe('CREATE');
            expect(modal._goalId).toBeNull();
            expect(modalElement.querySelector('#gs-modal-title').textContent.trim()).toBe('ゴール作成');
            expect(modalElement.querySelector('#gs-modal-submit').textContent.trim()).toBe('ゴール作成');

            // DELETE button should not exist in CREATE mode
            const deleteBtn = modalElement.querySelector('#gs-modal-delete');
            expect(deleteBtn).toBeNull();
        });

        it('show(sessionId, goalId)呼び出し時_UPDATE modeになる', async () => {
            // Arrange: Mock getGoal response
            const mockGoal = {
                id: 'goal-1',
                sessionId: 'session-1',
                title: 'Test Goal',
                description: 'Test Description',
                criteria: { commit: ['Test passes', 'Build succeeds'] },
                managerConfig: { autoAnswerLevel: 'moderate' }
            };
            mockService.getGoal.mockResolvedValue(mockGoal);

            // Act
            await modal.show('session-1', 'goal-1');

            // Assert: UPDATE mode
            expect(modal._mode).toBe('UPDATE');
            expect(modal._goalId).toBe('goal-1');
            expect(modal._currentGoal).toEqual(mockGoal);

            // Title and button labels
            expect(modalElement.querySelector('#gs-modal-title').textContent.trim()).toBe('ゴール編集');
            expect(modalElement.querySelector('#gs-modal-submit').textContent.trim()).toBe('更新');

            // Form prefilled
            expect(modalElement.querySelector('#gs-goal-title').value).toBe('Test Goal');
            expect(modalElement.querySelector('#gs-goal-desc').value).toBe('Test Description');
            expect(modalElement.querySelector('#gs-goal-criteria').value).toBe('Test passes\nBuild succeeds');
            expect(modalElement.querySelector('#gs-auto-answer').value).toBe('moderate');

            // DELETE button should exist in UPDATE mode
            const deleteBtn = modalElement.querySelector('#gs-modal-delete');
            expect(deleteBtn).not.toBeNull();
        });

        it('UPDATE mode_ゴールが存在しない場合_エラーが表示される', async () => {
            // Arrange: Mock getGoal error
            mockService.getGoal.mockRejectedValue(new Error('Goal not found'));

            // Act
            await modal.show('session-1', 'non-existent');

            // Assert: Error displayed
            const errorEl = modalElement.querySelector('#gs-modal-error');
            expect(errorEl.style.display).not.toBe('none');
            expect(errorEl.textContent).toContain('Goal not found');
        });
    });

    describe('Form Reset', () => {
        it('CREATE mode時_フォームが空の状態である', () => {
            // Act
            modal.show('session-1', null);

            // Assert: Empty form
            expect(modalElement.querySelector('#gs-goal-title').value).toBe('');
            expect(modalElement.querySelector('#gs-goal-desc').value).toBe('');
            expect(modalElement.querySelector('#gs-goal-criteria').value).toBe('');
        });
    });
});
