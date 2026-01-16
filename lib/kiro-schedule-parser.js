/**
 * Kiro-style Markdown Schedule Parser
 *
 * Parses schedule events in the format:
 * - [ ] 10:00-11:00 定例MTG
 *   - _ID: event-123_
 *   - _Source: google-calendar_
 *   - _CalendarId: primary_
 */

export class KiroScheduleParser {
    constructor() {
        // Event line pattern: - [ ] HH:MM-HH:MM Title or - [ ] HH:MM Title
        this.eventRegex = /^-\s*\[([xX ])\]\s*(\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?\s+(.+)$/;
        // Metadata pattern: - _Key: value_
        this.metadataRegex = /^\s*-\s*_([^:]+):\s*([^_]+)_\s*$/;
        // Counter for unique ID generation
        this._lastTimestamp = 0;
    }

    /**
     * Parse an event line
     * @param {string} line - Line to parse
     * @returns {Object|null} - Parsed event info or null if not an event
     */
    parseEvent(line) {
        const match = line.match(this.eventRegex);
        if (!match) {
            return null;
        }

        const [, checkState, start, end, title] = match;
        const completed = checkState.toLowerCase() === 'x';

        return {
            start: start.padStart(5, '0'),
            end: end ? end.padStart(5, '0') : null,
            title: title.trim(),
            completed
        };
    }

    /**
     * Parse a metadata line
     * @param {string} line - Line to parse
     * @returns {Object|null} - Parsed metadata or null if not metadata
     */
    parseMetadata(line) {
        const match = line.match(this.metadataRegex);
        if (!match) {
            return null;
        }

        const [, key, value] = match;
        return { [key]: value.trim() };
    }

    /**
     * Parse file content into events
     * @param {string} content - File content
     * @returns {Array} - Array of event objects
     */
    parseFile(content) {
        if (!content || !content.trim()) {
            return [];
        }

        const lines = content.split('\n');
        const events = [];
        let currentEvent = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Try to parse as event (new event)
            const event = this.parseEvent(line);
            if (event) {
                // Save previous event if it has an ID
                if (currentEvent && currentEvent.metadata.ID) {
                    events.push(this._finalizeEvent(currentEvent));
                }

                // Start new event
                currentEvent = {
                    ...event,
                    lineNumber: i,
                    metadata: {}
                };
                continue;
            }

            // Try to parse as metadata (belongs to current event)
            const metadata = this.parseMetadata(line);
            if (metadata && currentEvent) {
                Object.assign(currentEvent.metadata, metadata);
            }
        }

        // Don't forget the last event
        if (currentEvent && currentEvent.metadata.ID) {
            events.push(this._finalizeEvent(currentEvent));
        }

        return events;
    }

    /**
     * Finalize an event object with proper field names
     * @param {Object} event - Raw event object
     * @returns {Object} - Finalized event object
     */
    _finalizeEvent(event) {
        return {
            id: event.metadata.ID,
            start: event.start,
            end: event.end,
            title: event.title,
            source: event.metadata.Source || 'manual',
            calendarId: event.metadata.CalendarId || null,
            completed: event.completed,
            lineNumber: event.lineNumber
        };
    }

    /**
     * Generate a unique event ID
     * @returns {string} - Unique event ID in format event-{timestamp}
     */
    generateId() {
        let timestamp = Date.now();
        // Ensure uniqueness even if called multiple times in same millisecond
        if (timestamp <= this._lastTimestamp) {
            timestamp = this._lastTimestamp + 1;
        }
        this._lastTimestamp = timestamp;
        return `event-${timestamp}`;
    }

    /**
     * Serialize an event object to Kiro markdown format
     * @param {Object} event - Event object
     * @returns {string} - Markdown formatted event
     */
    serializeEvent(event) {
        const checkbox = event.completed ? '[x]' : '[ ]';
        const timeRange = event.end ? `${event.start}-${event.end}` : event.start;
        const lines = [`- ${checkbox} ${timeRange} ${event.title}`];

        // ID is required
        lines.push(`  - _ID: ${event.id}_`);

        // Source is required
        lines.push(`  - _Source: ${event.source || 'manual'}_`);

        // CalendarId is optional (only for google-calendar source)
        if (event.calendarId) {
            lines.push(`  - _CalendarId: ${event.calendarId}_`);
        }

        return lines.join('\n') + '\n';
    }

    /**
     * Find an event by ID in content and return its line range
     * @param {string} content - File content
     * @param {string} eventId - Event ID to find
     * @returns {Object|null} - { startLine, endLine, event } or null
     */
    findEventById(content, eventId) {
        const lines = content.split('\n');
        let currentEventStart = null;
        let currentEvent = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // New event starts
            const event = this.parseEvent(line);
            if (event) {
                // Check if previous event was the one we're looking for
                if (currentEvent && currentEvent.id === eventId) {
                    return {
                        startLine: currentEventStart,
                        endLine: i - 1,
                        event: this._finalizeEvent(currentEvent)
                    };
                }

                currentEventStart = i;
                currentEvent = { ...event, metadata: {} };
                continue;
            }

            // Metadata for current event
            const metadata = this.parseMetadata(line);
            if (metadata && currentEvent) {
                Object.assign(currentEvent.metadata, metadata);
                if (metadata.ID) {
                    currentEvent.id = metadata.ID;
                }
            }
        }

        // Check last event
        if (currentEvent && currentEvent.id === eventId) {
            return {
                startLine: currentEventStart,
                endLine: lines.length - 1,
                event: this._finalizeEvent(currentEvent)
            };
        }

        return null;
    }

    /**
     * Remove an event from content by ID
     * @param {string} content - File content
     * @param {string} eventId - Event ID to remove
     * @returns {Object} - { content: string, removedEvent: Object|null }
     */
    removeEvent(content, eventId) {
        const found = this.findEventById(content, eventId);
        if (!found) {
            return { content, removedEvent: null };
        }

        const lines = content.split('\n');
        const before = lines.slice(0, found.startLine);
        const after = lines.slice(found.endLine + 1);

        // Remove trailing empty line if present
        if (before.length > 0 && before[before.length - 1] === '') {
            before.pop();
        }

        return {
            content: [...before, ...after].join('\n'),
            removedEvent: found.event
        };
    }

    /**
     * Append an event to content
     * @param {string} content - File content
     * @param {Object} event - Event object to append
     * @returns {string} - Updated content
     */
    appendEvent(content, event) {
        const serialized = this.serializeEvent(event);
        const trimmed = content.trim();

        if (!trimmed) {
            return serialized;
        }

        return trimmed + '\n' + serialized;
    }

    /**
     * Check if an event is a duplicate
     * @param {Array} existingEvents - Existing events
     * @param {Object} newEvent - New event to check
     * @returns {boolean} - True if duplicate
     */
    isDuplicate(existingEvents, newEvent) {
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
}
