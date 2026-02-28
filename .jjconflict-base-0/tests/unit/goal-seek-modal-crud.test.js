/**
 * GoalSeekModal Unit Tests
 * TDD Phase 3: CRUD Operations (Create / Update / Delete)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GoalSeekModal } from '../../public/modules/ui/modals/goal-seek-modal.js';
import { eventBus, EVENTS } from '../../public/modules/core/event-bus.js';

// Mock toast functions
vi.mock('../../public/modules/toast.js', () => ({
    showSuccess: vi.fn(),
    showError: vi.fn()
}));

describe('GoalSeekModal CRUD Operations', () => {
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
            },
            confirm: vi.fn()
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
        vi.clearAllMocks();
    });

    describe('Create Operation', () => {
        it('CREATE mode_Submit押下時_createGoalが呼ばれる', async () => {
            // Arrange
            modal.show('session-1', null);
            mockService.createGoal.mockResolvedValue({ id: 'goal-new', title: 'New Goal' });

            // Fill form
            modalElement.querySelector('#gs-goal-title').value = 'New Goal';
            modalElement.querySelector('#gs-goal-desc').value = 'New Description';

            // Act
            await modal._handleSubmit();

            // Assert
            expect(mockService.createGoal).toHaveBeenCalledWith({
                sessionId: 'session-1',
                title: 'New Goal',
                description: 'New Description',
                criteria: undefined,
                managerConfig: { autoAnswerLevel: 'moderate' }
            });
        });

        it('CREATE mode_Submit成功時_モーダルが閉じる', async () => {
            // Arrange
            modal.show('session-1', null);
            mockService.createGoal.mockResolvedValue({ id: 'goal-new', title: 'New Goal' });

            modalElement.querySelector('#gs-goal-title').value = 'New Goal';

            // Spy on hide
            const hideSpy = vi.spyOn(modal, 'hide');

            // Act
            await modal._handleSubmit();

            // Assert
            expect(hideSpy).toHaveBeenCalled();
        });
    });

    describe('Update Operation', () => {
        it('UPDATE mode_Submit押下時_updateGoalが呼ばれる', async () => {
            // Arrange: Setup UPDATE mode
            const mockGoal = {
                id: 'goal-1',
                sessionId: 'session-1',
                title: 'Test Goal',
                description: 'Test Description',
                criteria: { commit: ['Test passes'] },
                managerConfig: { autoAnswerLevel: 'moderate' }
            };
            mockService.getGoal.mockResolvedValue(mockGoal);
            await modal.show('session-1', 'goal-1');

            mockService.updateGoal.mockResolvedValue({ ...mockGoal, title: 'Updated Goal' });

            // Modify form
            modalElement.querySelector('#gs-goal-title').value = 'Updated Goal';

            // Act
            await modal._handleSubmit();

            // Assert
            expect(mockService.updateGoal).toHaveBeenCalledWith('goal-1', {
                sessionId: 'session-1',
                title: 'Updated Goal',
                description: 'Test Description',
                criteria: { commit: ['Test passes'] },
                managerConfig: { autoAnswerLevel: 'moderate' }
            });
        });

        it('UPDATE mode_Submit成功時_モーダルが閉じる', async () => {
            // Arrange
            const mockGoal = {
                id: 'goal-1',
                sessionId: 'session-1',
                title: 'Test Goal',
                description: 'Test Description',
                criteria: { commit: [] },
                managerConfig: { autoAnswerLevel: 'moderate' }
            };
            mockService.getGoal.mockResolvedValue(mockGoal);
            await modal.show('session-1', 'goal-1');

            mockService.updateGoal.mockResolvedValue(mockGoal);

            // Spy on hide
            const hideSpy = vi.spyOn(modal, 'hide');

            // Act
            await modal._handleSubmit();

            // Assert
            expect(hideSpy).toHaveBeenCalled();
        });
    });

    describe('Delete Operation', () => {
        it('UPDATE mode_Delete押下時_確認ダイアログが表示される', async () => {
            // Arrange
            const mockGoal = {
                id: 'goal-1',
                sessionId: 'session-1',
                title: 'Test Goal',
                description: 'Test Description',
                criteria: { commit: [] },
                managerConfig: { autoAnswerLevel: 'moderate' }
            };
            mockService.getGoal.mockResolvedValue(mockGoal);
            await modal.show('session-1', 'goal-1');

            window.confirm.mockReturnValue(false); // User cancels

            // Act
            await modal._handleDelete();

            // Assert
            expect(window.confirm).toHaveBeenCalled();
            expect(mockService.deleteGoal).not.toHaveBeenCalled();
        });

        it('UPDATE mode_Delete確認後_deleteGoalが呼ばれる', async () => {
            // Arrange
            const mockGoal = {
                id: 'goal-1',
                sessionId: 'session-1',
                title: 'Test Goal',
                description: 'Test Description',
                criteria: { commit: [] },
                managerConfig: { autoAnswerLevel: 'moderate' }
            };
            mockService.getGoal.mockResolvedValue(mockGoal);
            await modal.show('session-1', 'goal-1');

            window.confirm.mockReturnValue(true); // User confirms
            mockService.deleteGoal.mockResolvedValue({ success: true });

            // Act
            await modal._handleDelete();

            // Assert
            expect(mockService.deleteGoal).toHaveBeenCalledWith('goal-1');
        });

        it('UPDATE mode_Delete成功時_モーダルが閉じる', async () => {
            // Arrange
            const mockGoal = {
                id: 'goal-1',
                sessionId: 'session-1',
                title: 'Test Goal',
                description: 'Test Description',
                criteria: { commit: [] },
                managerConfig: { autoAnswerLevel: 'moderate' }
            };
            mockService.getGoal.mockResolvedValue(mockGoal);
            await modal.show('session-1', 'goal-1');

            window.confirm.mockReturnValue(true);
            mockService.deleteGoal.mockResolvedValue({ success: true });

            // Spy on hide
            const hideSpy = vi.spyOn(modal, 'hide');

            // Act
            await modal._handleDelete();

            // Assert
            expect(hideSpy).toHaveBeenCalled();
        });
    });
});
