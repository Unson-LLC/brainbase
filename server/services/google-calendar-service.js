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
        const status = await this.getAuthStatus();
        if (!status.connected) {
            return [];
        }

        const endDate = getNextDate(date);
        const events = [];

        for (const calendarId of this.calendarIds) {
            try {
                const payload = await this._runJsonCommand([
                    'calendar',
                    'events',
                    calendarId,
                    '--from',
                    date,
                    '--to',
                    endDate,
                    '--json',
                    '--no-input',
                    '--max',
                    '200'
                ]);

                for (const rawEvent of this._extractEvents(payload)) {
                    const normalized = this._normalizeEvent(rawEvent, calendarId);
                    if (normalized) {
                        events.push(normalized);
                    }
                }
            } catch (error) {
                logger.warn(`[GoogleCalendarService] Failed to list events for ${calendarId}:`, error.message);
            }
        }

        return events.sort((a, b) => {
            if (a.allDay && !b.allDay) return -1;
            if (!a.allDay && b.allDay) return 1;
            return (a.start || '').localeCompare(b.start || '');
        });
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

    _normalizeEvent(rawEvent, calendarId) {
        if (!rawEvent || rawEvent.status === 'cancelled') {
            return null;
        }

        const id = rawEvent.id || rawEvent.iCalUID;
        const title = rawEvent.summary || rawEvent.title || rawEvent.task || '(無題)';
        const startValue = rawEvent?.start?.dateTime || rawEvent?.start?.date || rawEvent.startTime || rawEvent.start || null;
        const endValue = rawEvent?.end?.dateTime || rawEvent?.end?.date || rawEvent.endTime || rawEvent.end || null;
        const allDay = Boolean(rawEvent.allDay || isDateOnly(startValue));

        return {
            id: `gcal:${calendarId}:${id || `${title}:${startValue || 'all-day'}`}`,
            title,
            start: allDay ? null : formatTimeFromRfc3339(startValue, this.timeZone),
            end: allDay ? null : formatTimeFromRfc3339(endValue, this.timeZone),
            allDay,
            source: GOOGLE_CALENDAR_SOURCE,
            calendarId,
            completed: false
        };
    }

    _getSetupCommands() {
        return [
            'brew install steipete/tap/gogcli',
            'gog auth credentials <path-to-credentials.json>',
            'gog auth add <your-email> --services calendar'
        ];
    }
}
