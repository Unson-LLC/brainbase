/**
 * Calendar Event Converter
 *
 * Utility for converting Google Calendar events to Kiro schedule format.
 * This is designed for use by /ohayo skill implementers.
 *
 * Usage:
 *   import { CalendarEventConverter } from './lib/calendar-event-converter.js';
 *
 *   // Convert Google Calendar event to Kiro format
 *   const kiroEvent = CalendarEventConverter.fromGoogleEvent(gcEvent);
 *
 *   // Check for duplicates
 *   if (!CalendarEventConverter.isDuplicate(existingEvents, kiroEvent)) {
 *       await scheduleParser.addEvent(date, kiroEvent);
 *   }
 */

export class CalendarEventConverter {
    /**
     * Convert a Google Calendar event to Kiro schedule format
     * @param {Object} gcEvent - Google Calendar event from MCP
     * @param {string} gcEvent.summary - Event title
     * @param {Object} gcEvent.start - Start time { dateTime, date, timeZone }
     * @param {Object} gcEvent.end - End time { dateTime, date, timeZone }
     * @param {string} gcEvent.id - Google Calendar event ID
     * @param {string} gcEvent.calendarId - Calendar ID (e.g., 'primary')
     * @returns {Object} - Kiro format event
     */
    static fromGoogleEvent(gcEvent) {
        const start = this._extractTime(gcEvent.start);
        const end = this._extractTime(gcEvent.end);

        return {
            id: `event-${Date.now()}`,
            start,
            end,
            title: gcEvent.summary || 'Untitled Event',
            source: 'google-calendar',
            calendarId: gcEvent.calendarId || 'primary',
            completed: false,
            // Preserve original Google Calendar ID for reference
            googleEventId: gcEvent.id
        };
    }

    /**
     * Convert multiple Google Calendar events
     * @param {Array} gcEvents - Array of Google Calendar events
     * @returns {Array} - Array of Kiro format events
     */
    static fromGoogleEvents(gcEvents) {
        return gcEvents.map(e => this.fromGoogleEvent(e));
    }

    /**
     * Extract time string (HH:MM) from Google Calendar time object
     * @param {Object} timeObj - { dateTime, date, timeZone }
     * @returns {string|null} - Time string or null for all-day events
     */
    static _extractTime(timeObj) {
        if (!timeObj) return null;

        // All-day event (date only)
        if (timeObj.date && !timeObj.dateTime) {
            return null;
        }

        // DateTime event
        if (timeObj.dateTime) {
            const date = new Date(timeObj.dateTime);
            const hours = date.getHours().toString().padStart(2, '0');
            const minutes = date.getMinutes().toString().padStart(2, '0');
            return `${hours}:${minutes}`;
        }

        return null;
    }

    /**
     * Extract date string (YYYY-MM-DD) from Google Calendar time object
     * @param {Object} timeObj - { dateTime, date, timeZone }
     * @returns {string} - Date string
     */
    static extractDate(timeObj) {
        if (!timeObj) {
            // Default to today
            return new Date().toISOString().split('T')[0];
        }

        // All-day event
        if (timeObj.date) {
            return timeObj.date;
        }

        // DateTime event
        if (timeObj.dateTime) {
            return timeObj.dateTime.split('T')[0];
        }

        return new Date().toISOString().split('T')[0];
    }

    /**
     * Check if an event is a duplicate
     * Compares google-calendar source events by calendarId, start time, and title
     * @param {Array} existingEvents - Existing Kiro events
     * @param {Object} newEvent - New event to check
     * @returns {boolean} - True if duplicate
     */
    static isDuplicate(existingEvents, newEvent) {
        // Only check duplicates for google-calendar source
        if (newEvent.source !== 'google-calendar') {
            return false;
        }

        return existingEvents.some(e =>
            e.source === 'google-calendar' &&
            e.calendarId === newEvent.calendarId &&
            e.start === newEvent.start &&
            e.title === newEvent.title
        );
    }

    /**
     * Check if an event is a duplicate by Google Calendar ID
     * More precise than isDuplicate() when googleEventId is preserved
     * @param {Array} existingEvents - Existing Kiro events
     * @param {string} googleEventId - Google Calendar event ID
     * @returns {boolean} - True if duplicate
     */
    static isDuplicateById(existingEvents, googleEventId) {
        return existingEvents.some(e =>
            e.googleEventId === googleEventId
        );
    }

    /**
     * Filter out all-day events
     * @param {Array} events - Kiro format events
     * @returns {Array} - Events with start times
     */
    static filterAllDayEvents(events) {
        return events.filter(e => e.start !== null);
    }

    /**
     * Sort events by start time
     * @param {Array} events - Kiro format events
     * @returns {Array} - Sorted events
     */
    static sortByTime(events) {
        return [...events].sort((a, b) => {
            if (!a.start) return 1;
            if (!b.start) return -1;
            return a.start.localeCompare(b.start);
        });
    }
}
