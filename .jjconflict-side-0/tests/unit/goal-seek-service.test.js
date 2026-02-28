/**
 * GoalSeekService Unit Tests
 * TDD Phase 1: GOAL_DELETED Event
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GoalSeekService } from '../../public/modules/domain/goal-seek/goal-seek-service.js';
import { eventBus, EVENTS } from '../../public/modules/core/event-bus.js';

describe('GoalSeekService', () => {
    let service;
    let mockFetch;
    const emitted = [];

    beforeEach(() => {
        // Reset emitted events
        emitted.length = 0;

        // EventBus listener
        eventBus.on(EVENTS.GOAL_DELETED, (e) => emitted.push(e));

        // Mock fetch
        mockFetch = vi.fn();
        global.fetch = mockFetch;

        // Mock localStorage
        global.localStorage = {
            getItem: vi.fn(() => 'test-token')
        };

        // Mock document (CSRF token)
        global.document = {
            querySelector: vi.fn(() => ({ content: 'test-csrf-token' }))
        };

        service = new GoalSeekService();
    });

    describe('deleteGoal', () => {
        it('deleteGoal呼び出し時_GOAL_DELETEDイベントが発火される', async () => {
            // Arrange: Mock successful DELETE response
            mockFetch.mockResolvedValue({
                ok: true,
                json: async () => ({ success: true })
            });

            // Act: Delete goal
            await service.deleteGoal('goal-1');

            // Assert: GOAL_DELETED event emitted
            expect(emitted).toHaveLength(1);
            expect(emitted[0].detail.goalId).toBe('goal-1');
        });

        it('deleteGoal呼び出し時_DELETEリクエストが送信される', async () => {
            // Arrange
            mockFetch.mockResolvedValue({
                ok: true,
                json: async () => ({ success: true })
            });

            // Act
            await service.deleteGoal('goal-123');

            // Assert: DELETE request sent
            expect(mockFetch).toHaveBeenCalledWith(
                '/api/goal-seek/goals/goal-123',
                expect.objectContaining({
                    method: 'DELETE'
                })
            );
        });

        it('deleteGoal呼び出し時_存在しないゴール_エラーが投げられる', async () => {
            // Arrange: Mock 404 error
            mockFetch.mockResolvedValue({
                ok: false,
                status: 404,
                json: async () => ({ error: 'Goal not found' })
            });

            // Act & Assert
            await expect(service.deleteGoal('non-existent')).rejects.toThrow('Goal not found');
        });
    });
});
