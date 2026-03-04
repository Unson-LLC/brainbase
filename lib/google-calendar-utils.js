/**
 * Shared helpers for dealing with google-calendar sourced events.
 */

export const GOOGLE_CALENDAR_SOURCE = 'google-calendar';

/**
 * Type guard for google-calendar events.
 * @param {Object} event - Candidate event object.
 * @returns {boolean}
 */
export function isGoogleCalendarEvent(event) {
    return Boolean(event) && event.source === GOOGLE_CALENDAR_SOURCE;
}

/**
 * Check whether two google-calendar events share the same identifying fields.
 * @param {Object} eventA
 * @param {Object} eventB
 * @returns {boolean}
 */
export function hasSameGoogleCalendarSignature(eventA, eventB) {
    if (!isGoogleCalendarEvent(eventA) || !isGoogleCalendarEvent(eventB)) {
        return false;
    }

    return eventA.calendarId === eventB.calendarId &&
        eventA.start === eventB.start &&
        eventA.title === eventB.title;
}

/**
 * Determine if a candidate event already exists within a collection based on google-calendar identity.
 * @param {Array} existingEvents
 * @param {Object} candidate
 * @returns {boolean}
 */
export function isGoogleCalendarDuplicate(existingEvents = [], candidate) {
    if (!isGoogleCalendarEvent(candidate)) {
        return false;
    }

    return existingEvents.some(event => hasSameGoogleCalendarSignature(event, candidate));
}
