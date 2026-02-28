import { describe, it, expect } from 'vitest';
import {
  renderFocusTaskHTML,
  renderNextTaskItemHTML,
  renderTimelineEventHTML
} from '../../public/modules/right-panel-renderer.js';

describe('right-panel-renderer', () => {
  describe('renderFocusTaskHTML', () => {
    it('should render focus task with all fields', () => {
      const task = {
        id: 'task-1',
        name: 'Important Task',
        project: 'brainbase',
        status: 'in-progress',
        priority: 'high',
        due: '2025-12-15'
      };

      const html = renderFocusTaskHTML(task);

      expect(html).toContain('Important Task');
      expect(html).toContain('brainbase');
      expect(html).toContain('high');
      expect(html).toContain('in-progress');
    });

    it('should render empty state when task is null', () => {
      const html = renderFocusTaskHTML(null);

      expect(html).toContain('focus-empty');
      expect(html).toContain('タスクなし');
    });

    it('should include defer button', () => {
      const task = { id: 't1', name: 'Test' };
      const html = renderFocusTaskHTML(task);

      expect(html).toContain('defer-btn');
      expect(html).toContain('clock');
    });

    it('should include start session button', () => {
      const task = { id: 't1', name: 'Test' };
      const html = renderFocusTaskHTML(task);

      expect(html).toContain('start-focus-session-btn');
      expect(html).toContain('terminal-square');
    });
  });

  describe('renderNextTaskItemHTML', () => {
    it('should render next task item', () => {
      const task = {
        id: 'task-2',
        name: 'Secondary Task',
        project: 'unson',
        priority: 'medium'
      };

      const html = renderNextTaskItemHTML(task);

      expect(html).toContain('next-task-item');
      expect(html).toContain('Secondary Task');
      expect(html).toContain('unson');
      expect(html).toContain('medium');
    });

    it('should use general as default project', () => {
      const task = { id: 't1', name: 'No Project' };
      const html = renderNextTaskItemHTML(task);

      expect(html).toContain('general');
    });

    it('should include action buttons', () => {
      const task = { id: 't1', name: 'Test' };
      const html = renderNextTaskItemHTML(task);

      expect(html).toContain('start-task-btn');
      expect(html).toContain('edit-task-btn');
      expect(html).toContain('delete-task-btn');
    });
  });

  describe('renderTimelineEventHTML', () => {
    it('should render timeline event', () => {
      const event = {
        title: 'Meeting',
        time: '10:00',
        duration: '1h'
      };

      const html = renderTimelineEventHTML(event);

      expect(html).toContain('timeline-event');
      expect(html).toContain('Meeting');
      expect(html).toContain('10:00');
    });

    it('should handle all-day events', () => {
      const event = {
        title: 'All Day Event',
        allDay: true
      };

      const html = renderTimelineEventHTML(event);

      expect(html).toContain('All Day Event');
      expect(html).toContain('終日');
    });
  });
});
