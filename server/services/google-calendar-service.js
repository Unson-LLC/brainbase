import { execFile as execFileCallback } from 'child_process';
import { promisify } from 'util';

import { GOOGLE_CALENDAR_SOURCE } from '../../lib/google-calendar-utils.js';
import { logger } from '../utils/logger.js';

const execFile = promisify(execFileCallback);
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_TIME_ZONE = 'Asia/Tokyo';

function formatTimeFromRfc3339(value, timeZone) {
    if (!value) return null;

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return new Intl.DateTimeFormat('sv-SE', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone
    }).format(date);
}

function isDateOnly(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function cleanString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeAttendee(rawAttendee) {
    if (!rawAttendee || typeof rawAttendee !== 'object') {
        return null;
    }

    const email = cleanString(rawAttendee.email);
    const displayName = cleanString(rawAttendee.displayName);
    if (!email && !displayName) {
        return null;
    }

    const attendee = {};
    if (email) attendee.email = email;
    if (displayName) attendee.displayName = displayName;
    if (cleanString(rawAttendee.responseStatus)) attendee.responseStatus = rawAttendee.responseStatus.trim();
    if (rawAttendee.self) attendee.self = true;
    if (rawAttendee.organizer) attendee.organizer = true;
    if (rawAttendee.optional) attendee.optional = true;
    if (rawAttendee.resource) attendee.resource = true;
    return attendee;
}

function normalizeOrganizer(rawOrganizer) {
    const organizer = normalizeAttendee(rawOrganizer);
    return organizer || null;
}

function stripUrlTrailingPunctuation(value) {
    return value.replace(/[),.;\]]+$/g, '');
}

function extractFirstUrl(...values) {
    for (const value of values) {
        if (typeof value !== 'string' || !value.trim()) continue;
        const match = value.match(/https?:\/\/[^\s<>"']+/i);
        if (match) {
            return stripUrlTrailingPunctuation(match[0]);
        }
    }
    return null;
}

function extractConferenceUrl(rawEvent, description, location) {
    const explicitUrl = cleanString(rawEvent?.hangoutLink)
        || cleanString(rawEvent?.conferenceUrl)
        || cleanString(rawEvent?.conference_url);
    if (explicitUrl) return explicitUrl;

    const entryPoints = Array.isArray(rawEvent?.conferenceData?.entryPoints)
        ? rawEvent.conferenceData.entryPoints
        : [];
    for (const entryPoint of entryPoints) {
        const uri = cleanString(entryPoint?.uri);
        if (uri) return uri;
    }

    return extractFirstUrl(description, location);
}

function getNextDate(date) {
    const next = new Date(`${date}T00:00:00+09:00`);
    next.setDate(next.getDate() + 1);
    return next.toLocaleDateString('sv-SE', { timeZone: DEFAULT_TIME_ZONE });
}

export class GoogleCalendarService {
    constructor({
        command = 'gog',
        calendarIds = null,
        timeZone = process.env.BRAINBASE_GOOGLE_CALENDAR_TIMEZONE || DEFAULT_TIME_ZONE,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        execFileImpl = execFile
    } = {}) {
        this.command = command;
        this.calendarIds = Array.isArray(calendarIds) && calendarIds.length > 0
            ? calendarIds
            : (process.env.BRAINBASE_GOOGLE_CALENDAR_IDS || 'primary')
                .split(',')
                .map(value => value.trim())
                .filter(Boolean);
        this.timeZone = timeZone;
        this.timeoutMs = timeoutMs;
        this.execFile = execFileImpl;
    }

    isConfigured() {
        return true;
    }

    async isAuthenticated() {
        const status = await this.getAuthStatus();
        return Boolean(status.connected);
    }

    async getAuthStatus() {
        const version = await this._getVersion();
        const baseStatus = {
            provider: 'gog',
            configured: true,
            installed: Boolean(version),
            connected: false,
            defaultAccount: null,
            version,
            calendarIds: this.calendarIds,
            reason: version ? 'unknown' : 'missing_binary',
            setupCommands: this._getSetupCommands()
        };

        if (!version) {
            return baseStatus;
        }

        try {
            const status = await this._runJsonCommand(['auth', 'status', '--json', '--no-input']);
            const credentialsExists = Boolean(status?.account?.credentials_exists);
            const defaultAccount = typeof status?.account?.email === 'string' && status.account.email.trim()
                ? status.account.email.trim()
                : null;

            if (!credentialsExists) {
                return {
                    ...baseStatus,
                    reason: 'no_credentials'
                };
            }

            if (!defaultAccount) {
                return {
                    ...baseStatus,
                    reason: 'no_default_account'
                };
            }

            return {
                ...baseStatus,
                connected: true,
                defaultAccount,
                reason: 'ready'
            };
        } catch (error) {
            return {
                ...baseStatus,
                reason: 'auth_failed',
                error: error.message
            };
        }
    }

    async listEventsForDate(date) {
        const endDate = getNextDate(date);
        return this.listEvents({ from: date, to: endDate });
    }

    async listEvents({ from, to, account = null, calendarIds = null, max = 200, failOnCalendarError = false } = {}) {
        const result = await this.listEventsWithDiagnostics({
            from,
            to,
            account,
            calendarIds,
            max,
            failOnCalendarError
        });
        return result.events;
    }

    async listEventsWithDiagnostics({ from, to, account = null, calendarIds = null, max = 200, failOnCalendarError = false } = {}) {
        if (!from || !to) {
            throw new Error('from and to are required');
        }

        if (!account) {
            const status = await this.getAuthStatus();
            if (!status.connected) {
                return {
                    events: [],
                    skippedCalendars: this.calendarIds.map((calendarId) => ({
                        calendar_id: calendarId,
                        reason: status.reason || 'calendar_not_connected',
                        message: status.error || null
                    }))
                };
            }
        }

        const selectedCalendarIds = Array.isArray(calendarIds) && calendarIds.length > 0
            ? calendarIds.map(value => String(value).trim()).filter(Boolean)
            : this.calendarIds;
        const eventLimit = Number.isFinite(Number(max)) && Number(max) > 0
            ? String(Math.trunc(Number(max)))
            : '200';
        const events = [];
        const skippedCalendars = [];

        for (const calendarId of selectedCalendarIds) {
            try {
                const payload = await this._runJsonCommand([
                    'calendar',
                    'events',
                    calendarId,
                    '--from',
                    from,
                    '--to',
                    to,
                    '--json',
                    '--no-input',
                    '--max',
                    eventLimit,
                    ...(account ? ['--account', account] : [])
                ]);

                for (const rawEvent of this._extractEvents(payload)) {
                    const normalized = this._normalizeEvent(rawEvent, calendarId, { account });
                    if (normalized) {
                        events.push(normalized);
                    }
                }
            } catch (error) {
                logger.warn(`[GoogleCalendarService] Failed to list events for ${calendarId}: ${error.message}`);
                if (failOnCalendarError) {
                    throw error;
                }
                skippedCalendars.push({
                    calendar_id: calendarId,
                    reason: 'calendar_fetch_failed',
                    message: error.message
                });
            }
        }

        const sortedEvents = events.sort((a, b) => {
            if (a.allDay && !b.allDay) return -1;
            if (!a.allDay && b.allDay) return 1;
            return (a.start || '').localeCompare(b.start || '');
        });
        return {
            events: sortedEvents,
            skippedCalendars
        };
    }

    async getEventsForDate(date) {
        return this.listEventsForDate(date);
    }

    async _getVersion() {
        try {
            const { stdout } = await this.execFile(this.command, ['--version'], {
                timeout: this.timeoutMs,
                maxBuffer: 1024 * 1024
            });
            return stdout.trim().split('\n')[0] || null;
        } catch {
            return null;
        }
    }

    async _runJsonCommand(args) {
        const { stdout, stderr } = await this.execFile(this.command, args, {
            timeout: this.timeoutMs,
            maxBuffer: 4 * 1024 * 1024
        });

        const text = stdout?.trim();
        if (!text) {
            if (stderr?.trim()) {
                throw new Error(stderr.trim());
            }
            throw new Error(`Empty response from ${this.command}`);
        }

        try {
            return JSON.parse(text);
        } catch (error) {
            throw new Error(`Invalid JSON from ${this.command}: ${error.message}`);
        }
    }

    _extractEvents(payload) {
        if (Array.isArray(payload)) {
            return payload;
        }
        if (Array.isArray(payload?.items)) {
            return payload.items;
        }
        if (Array.isArray(payload?.events)) {
            return payload.events;
        }
        return [];
    }

    _normalizeEvent(rawEvent, calendarId, { account = null } = {}) {
        if (!rawEvent || rawEvent.status === 'cancelled') {
            return null;
        }

        const calendarEventId = cleanString(rawEvent.id) || cleanString(rawEvent.iCalUID);
        const iCalUID = cleanString(rawEvent.iCalUID);
        const title = cleanString(rawEvent.summary) || cleanString(rawEvent.title) || cleanString(rawEvent.task) || '(無題)';
        const startValue = rawEvent?.start?.dateTime || rawEvent?.start?.date || rawEvent.startTime || rawEvent.start || null;
        const endValue = rawEvent?.end?.dateTime || rawEvent?.end?.date || rawEvent.endTime || rawEvent.end || null;
        const allDay = Boolean(rawEvent.allDay || isDateOnly(startValue));
        const attendees = Array.isArray(rawEvent.attendees)
            ? rawEvent.attendees.map(normalizeAttendee).filter(Boolean)
            : [];
        const description = cleanString(rawEvent.description);
        const location = cleanString(rawEvent.location);
        const htmlLink = cleanString(rawEvent.htmlLink) || cleanString(rawEvent.html_link);
        const organizer = normalizeOrganizer(rawEvent.organizer);
        const conferenceUrl = extractConferenceUrl(rawEvent, description, location);

        const event = {
            id: `gcal:${calendarId}:${calendarEventId || `${title}:${startValue || 'all-day'}`}`,
            calendarEventId,
            iCalUID,
            title,
            start: allDay ? null : formatTimeFromRfc3339(startValue, this.timeZone),
            end: allDay ? null : formatTimeFromRfc3339(endValue, this.timeZone),
            startDateTime: allDay ? null : startValue,
            endDateTime: allDay ? null : endValue,
            startDate: allDay ? startValue : null,
            endDate: allDay ? endValue : null,
            allDay,
            source: GOOGLE_CALENDAR_SOURCE,
            calendarId,
            completed: false
        };

        if (account) event.account = account;
        if (attendees.length > 0) {
            event.attendees = attendees;
        }
        if (organizer) event.organizer = organizer;
        if (description) event.description = description;
        if (location) event.location = location;
        if (htmlLink) event.htmlLink = htmlLink;
        if (conferenceUrl) event.conferenceUrl = conferenceUrl;

        return event;
    }

    _getSetupCommands() {
        return [
            'brew install steipete/tap/gogcli',
            'gog auth credentials <path-to-credentials.json>',
            'gog auth add <your-email> --services calendar'
        ];
    }
}
