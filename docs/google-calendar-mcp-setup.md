# Google Calendar MCP Setup Guide

This guide explains how to set up Google Calendar MCP for use with Brainbase's schedule management.

## Prerequisites

- Node.js 20+
- Google Cloud Project with Calendar API enabled
- OAuth 2.0 credentials

## Step 1: Install Google Calendar MCP

```bash
npm install -g @anthropic/mcp-server-google-calendar
```

Or add to your Claude Code configuration:

```json
{
  "mcpServers": {
    "google-calendar": {
      "command": "npx",
      "args": ["@anthropic/mcp-server-google-calendar"],
      "env": {
        "GOOGLE_CLIENT_ID": "your-client-id.apps.googleusercontent.com",
        "GOOGLE_CLIENT_SECRET": "your-client-secret",
        "GOOGLE_REFRESH_TOKEN": "your-refresh-token"
      }
    }
  }
}
```

## Step 2: Get OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable Google Calendar API
4. Create OAuth 2.0 credentials (Desktop application)
5. Download `credentials.json`

## Step 3: Get Refresh Token

Use the MCP server's built-in auth flow:

```bash
npx @anthropic/mcp-server-google-calendar auth
```

Follow the prompts to authorize access to your calendar.

## Step 4: Configure Environment

Add to your `.env`:

```bash
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REFRESH_TOKEN=your-refresh-token
```

## Using with /ohayo Skill

The `/ohayo` skill uses Google Calendar MCP to fetch today's events. Example implementation:

```javascript
// In /ohayo skill
import { CalendarEventConverter } from '../../../lib/calendar-event-converter.js';

// 1. Fetch events from MCP
const mcpEvents = await mcp.callTool('google-calendar', 'list_events', {
    calendarId: 'primary',
    timeMin: new Date().toISOString(),
    timeMax: new Date(Date.now() + 24*60*60*1000).toISOString(),
    maxResults: 10
});

// 2. Convert to Kiro format
const kiroEvents = CalendarEventConverter.fromGoogleEvents(mcpEvents);

// 3. Filter and sort
const filtered = CalendarEventConverter.filterAllDayEvents(kiroEvents);
const sorted = CalendarEventConverter.sortByTime(filtered);

// 4. Add to schedule (with duplicate check)
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
for (const event of sorted) {
    const existing = await scheduleParser.getSchedule(today);
    if (!CalendarEventConverter.isDuplicate(existing.events, event)) {
        await scheduleParser.addEvent(today, event);
    }
}
```

## Available MCP Tools

The Google Calendar MCP provides these tools:

| Tool | Description |
|------|-------------|
| `list_events` | Get events from a calendar |
| `create_event` | Create a new event |
| `update_event` | Update an existing event |
| `delete_event` | Delete an event |
| `list_calendars` | Get all accessible calendars |

## Troubleshooting

### Token Expired

If you get authentication errors, refresh your token:

```bash
npx @anthropic/mcp-server-google-calendar auth --refresh
```

### Rate Limits

Google Calendar API has rate limits. If you hit them:
- Reduce `maxResults` in `list_events`
- Add delays between API calls
- Use caching for frequently accessed data

### Permission Denied

Make sure your OAuth scope includes:
- `https://www.googleapis.com/auth/calendar.readonly` (for reading)
- `https://www.googleapis.com/auth/calendar.events` (for writing)

## Related Files

- `lib/calendar-event-converter.js` - Event conversion utilities
- `lib/kiro-schedule-parser.js` - Kiro format parser
- `lib/schedule-parser.js` - Schedule management with Kiro support

## See Also

- [Google Calendar API Documentation](https://developers.google.com/calendar/api/v3/reference)
- [MCP Server Documentation](https://modelcontextprotocol.io/)
