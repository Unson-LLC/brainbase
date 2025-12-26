import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FocusEngineModal } from '../../../public/modules/ui/modals/focus-engine-modal.js';
import { eventBus, EVENTS } from '../../../public/modules/core/event-bus.js';

describe('FocusEngineModal', () => {
    let modal;
    let modalElement;

    beforeEach(() => {
        // DOM準備
        document.body.innerHTML = `
            <div id="focus-engine-modal" class="modal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3><i data-lucide="split"></i> フォーカスの起動先</h3>
                        <button class="close-modal-btn"><i data-lucide="x"></i></button>
                    </div>
                    <div class="modal-body">
                        <p>今日のフォーカスをどのエンジンで立ち上げますか？</p>
                        <div class="engine-select-grid">
                            <button class="engine-select-btn btn-primary" data-engine="claude">
                                <i data-lucide="sparkles"></i> Claude Code
                            </button>
                            <button class="engine-select-btn btn-secondary" data-engine="codex">
                                <i data-lucide="boxes"></i> OpenAI Codex
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        modalElement = document.getElementById('focus-engine-modal');
        modal = new FocusEngineModal();

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

        it('should open modal with task', () => {
            const task = { id: 'task-1', name: 'Test Task' };

            modal.open(task);

            expect(modalElement.classList.contains('active')).toBe(true);
            expect(modal.pendingTask).toEqual(task);
        });

        it('should store pending task', () => {
            const task = { id: 'task-1', name: 'Test Task' };

            modal.open(task);

            expect(modal.pendingTask).toBe(task);
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

        it('should clear pending task', () => {
            modal.open({ id: 'task-1', name: 'Test' });
            expect(modal.pendingTask).toBeTruthy();

            modal.close();
            expect(modal.pendingTask).toBeNull();
        });

        it('should close on X button click', () => {
            modal.open({ id: 'task-1', name: 'Test' });

            const closeBtn = modalElement.querySelector('.close-modal-btn');
            closeBtn.click();

            expect(modalElement.classList.contains('active')).toBe(false);
        });

        it('should close on backdrop click', () => {
            modal.open({ id: 'task-1', name: 'Test' });

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

    describe('engine selection', () => {
        beforeEach(() => {
            modal.mount();
        });

        it('should emit START_TASK event with claude engine', () => {
            const task = { id: 'task-1', name: 'Test Task' };
            const emitSpy = vi.spyOn(eventBus, 'emit');

            modal.open(task);

            const claudeBtn = modalElement.querySelector('[data-engine="claude"]');
            claudeBtn.click();

            expect(emitSpy).toHaveBeenCalledWith(EVENTS.START_TASK, {
                task,
                engine: 'claude'
            });
        });

        it('should emit START_TASK event with codex engine', () => {
            const task = { id: 'task-1', name: 'Test Task' };
            const emitSpy = vi.spyOn(eventBus, 'emit');

            modal.open(task);

            const codexBtn = modalElement.querySelector('[data-engine="codex"]');
            codexBtn.click();

            expect(emitSpy).toHaveBeenCalledWith(EVENTS.START_TASK, {
                task,
                engine: 'codex'
            });
        });

        it('should close modal after engine selection', () => {
            const task = { id: 'task-1', name: 'Test Task' };

            modal.open(task);

            const claudeBtn = modalElement.querySelector('[data-engine="claude"]');
            claudeBtn.click();

            expect(modalElement.classList.contains('active')).toBe(false);
        });

        it('should clear pending task after engine selection', () => {
            const task = { id: 'task-1', name: 'Test Task' };

            modal.open(task);

            const claudeBtn = modalElement.querySelector('[data-engine="claude"]');
            claudeBtn.click();

            expect(modal.pendingTask).toBeNull();
        });
    });

    describe('unmount', () => {
        it('should clean up event listeners', () => {
            modal.mount();
            modal.unmount();

            expect(() => modal.open({ id: 'task-1', name: 'Test' })).not.toThrow();
        });
    });
});
