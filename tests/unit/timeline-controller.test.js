import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sortEventsByTime,
  formatTimelineHTML,
  getCurrentTimeStr
} from '../../public/modules/timeline-controller.js';

describe('timeline-controller', () => {
  describe('sortEventsByTime', () => {
    it('should sort events by start time', () => {
      const events = [
        { title: 'Late', start: '14:00' },
        { title: 'Early', start: '09:00' },
        { title: 'Mid', start: '12:00' }
      ];

      const sorted = sortEventsByTime(events);

      expect(sorted[0].title).toBe('Early');
      expect(sorted[1].title).toBe('Mid');
      expect(sorted[2].title).toBe('Late');
    });

    it('should handle missing start time as 00:00', () => {
      const events = [
        { title: 'With Time', start: '10:00' },
        { title: 'No Time' }
      ];

      const sorted = sortEventsByTime(events);

      expect(sorted[0].title).toBe('No Time');
      expect(sorted[1].title).toBe('With Time');
    });

    it('should not mutate original array', () => {
      const events = [
        { title: 'B', start: '14:00' },
        { title: 'A', start: '09:00' }
      ];

      sortEventsByTime(events);

      expect(events[0].title).toBe('B');
    });
  });

  describe('getCurrentTimeStr', () => {
    it('should return time in HH:MM format', () => {
      const timeStr = getCurrentTimeStr();

      expect(timeStr).toMatch(/^\d{2}:\d{2}$/);
    });
  });

  describe('formatTimelineHTML', () => {
    it('should render empty message when no events', () => {
      const html = formatTimelineHTML([], '10:00');

      expect(html).toContain('timeline-empty');
      expect(html).toContain('予定なし');
    });

    it('should render events with time', () => {
      const events = [
        { title: 'Meeting', start: '10:00', end: '11:00' }
      ];

      const html = formatTimelineHTML(events, '09:00');

      expect(html).toContain('Meeting');
      expect(html).toContain('10:00');
    });

    it('should mark current event', () => {
      const events = [
        { title: 'Past', start: '08:00', end: '09:00' },
        { title: 'Current', start: '10:00', end: '11:00' },
        { title: 'Future', start: '14:00', end: '15:00' }
      ];

      const html = formatTimelineHTML(events, '10:30');

      expect(html).toContain('is-current');
    });

    it('should show all-day events as 終日', () => {
      const events = [
        { title: 'All Day Event', allDay: true }
      ];

      const html = formatTimelineHTML(events, '10:00');

      expect(html).toContain('終日');
      expect(html).toContain('All Day Event');
    });

    it('should insert now marker at correct position', () => {
      const events = [
        { title: 'Past', start: '08:00' },
        { title: 'Future', start: '14:00' }
      ];

      const html = formatTimelineHTML(events, '10:00');

      expect(html).toContain('timeline-now');
    });
  });
});
