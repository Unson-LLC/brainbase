import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskEditModal } from '../../../public/modules/ui/modals/task-edit-modal.js';
import { TaskService } from '../../../public/modules/domain/task/task-service.js';
import { eventBus, EVENTS } from '../../../public/modules/core/event-bus.js';

// TaskServiceをモック化
vi.mock('../../../public/modules/domain/task/task-service.js', () => {
    return {
        TaskService: class MockTaskService {
            constructor() {
                this.updateTask = vi.fn();
            }
        }
    };
});

describe('TaskEditModal', () => {
    let modal;
    let mockTaskService;
    let modalElement;

    beforeEach(() => {
        // DOM準備 - HTMLからの構造を再現
        document.body.innerHTML = `
            <div id="edit-task-modal" class="modal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>Edit Task</h3>
                        <button class="close-modal-btn"><i data-lucide="x"></i></button>
                    </div>
                    <div class="modal-body">
                        <input type="hidden" id="edit-task-id">
                        <div class="form-group">
                            <label>Title</label>
                            <input type="text" id="edit-task-title" class="form-input">
                        </div>
                        <div class="form-group">
                            <label>Project</label>
                            <select id="edit-task-project" class="form-input">
                                <option value="general">general</option>
                                <option value="brainbase">brainbase</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Priority</label>
                            <select id="edit-task-priority" class="form-input">
                                <option value="high">High</option>
                                <option value="medium">Medium</option>
                                <option value="low">Low</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Due Date</label>
                            <input type="date" id="edit-task-due" class="form-input">
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn-secondary close-modal-btn">Cancel</button>
                        <button id="save-task-btn" class="btn-primary">Save Changes</button>
                    </div>
                </div>
            </div>
        `;

        modalElement = document.getElementById('edit-task-modal');
        mockTaskService = new TaskService();
        modal = new TaskEditModal({ taskService: mockTaskService });

        vi.clearAllMocks();
    });

    describe('initialization', () => {
        it('should initialize with modal element', () => {
            modal.mount();
            expect(modal.modalElement).toBe(modalElement);
        });

        it('should be initially hidden', () => {
            modal.mount();
            expect(modalElement.classList.contains('active')).toBe(false);
        });
    });

    describe('open', () => {
        beforeEach(() => {
            modal.mount();
        });

        it('should open modal and populate fields', () => {
            const task = {
                id: 'task-1',
                name: 'Test Task',
                project: 'brainbase',
                priority: 'high',
                due: '2025-12-31'
            };

            modal.open(task);

            expect(modalElement.classList.contains('active')).toBe(true);
            expect(document.getElementById('edit-task-id').value).toBe('task-1');
            expect(document.getElementById('edit-task-title').value).toBe('Test Task');
            expect(document.getElementById('edit-task-project').value).toBe('brainbase');
            expect(document.getElementById('edit-task-priority').value).toBe('high');
            expect(document.getElementById('edit-task-due').value).toBe('2025-12-31');
        });

        it('should handle task with missing fields', () => {
            const task = {
                id: 'task-2',
                name: 'Minimal Task'
            };

            modal.open(task);

            expect(document.getElementById('edit-task-title').value).toBe('Minimal Task');
            expect(document.getElementById('edit-task-project').value).toBe('');
            expect(document.getElementById('edit-task-priority').value).toBe('');
            expect(document.getElementById('edit-task-due').value).toBe('');
        });
    });

    describe('close', () => {
        beforeEach(() => {
            modal.mount();
        });

        it('should close modal', () => {
            modal.open({ id: 'task-1', name: 'Test' });
            expect(modalElement.classList.contains('active')).toBe(true);

            modal.close();
            expect(modalElement.classList.contains('active')).toBe(false);
        });

        it('should close on X button click', () => {
            modal.open({ id: 'task-1', name: 'Test' });

            const closeBtn = modalElement.querySelector('.close-modal-btn');
            closeBtn.click();

            expect(modalElement.classList.contains('active')).toBe(false);
        });

        it('should close on backdrop click', () => {
            modal.open({ id: 'task-1', name: 'Test' });

            // Simulate backdrop click
            const event = new MouseEvent('click', { bubbles: true });
            Object.defineProperty(event, 'target', { value: modalElement });
            modalElement.dispatchEvent(event);

            expect(modalElement.classList.contains('active')).toBe(false);
        });

        it('should not close when clicking modal content', () => {
            modal.open({ id: 'task-1', name: 'Test' });

            const modalContent = modalElement.querySelector('.modal-content');
            const event = new MouseEvent('click', { bubbles: true });
            Object.defineProperty(event, 'target', { value: modalContent });
            modalElement.dispatchEvent(event);

            expect(modalElement.classList.contains('active')).toBe(true);
        });
    });

    describe('save', () => {
        beforeEach(() => {
            modal.mount();
        });

        it('should update task on save', async () => {
            mockTaskService.updateTask.mockResolvedValue();

            modal.open({ id: 'task-1', name: 'Old Name' });

            // Modify fields
            document.getElementById('edit-task-title').value = 'New Name';
            document.getElementById('edit-task-project').value = 'brainbase';
            document.getElementById('edit-task-priority').value = 'high';
            document.getElementById('edit-task-due').value = '2025-12-31';

            // Click save button
            const saveBtn = document.getElementById('save-task-btn');
            saveBtn.click();

            await vi.waitFor(() => {
                expect(mockTaskService.updateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({
                    title: 'New Name',
                    project: 'brainbase',
                    priority: 'high',
                    deadline: '2025-12-31'
                }));
            });
        });

        it('should close modal after save', async () => {
            mockTaskService.updateTask.mockResolvedValue();

            modal.open({ id: 'task-1', name: 'Test' });

            const saveBtn = document.getElementById('save-task-btn');
            saveBtn.click();

            await vi.waitFor(() => {
                expect(modalElement.classList.contains('active')).toBe(false);
            });
        });

        it('should handle null due date', async () => {
            mockTaskService.updateTask.mockResolvedValue();

            modal.open({ id: 'task-1', name: 'Test', due: '2025-12-31' });

            // Clear due date
            document.getElementById('edit-task-due').value = '';

            const saveBtn = document.getElementById('save-task-btn');
            saveBtn.click();

            await vi.waitFor(() => {
                expect(mockTaskService.updateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({
                    deadline: null
                }));
            });
        });
    });

    describe('unmount', () => {
        it('should clean up event listeners', () => {
            modal.mount();
            const initialHTML = modalElement.outerHTML;

            modal.unmount();

            // Should not throw errors after unmount
            expect(() => modal.open({ id: 'task-1', name: 'Test' })).not.toThrow();
        });
    });
});
