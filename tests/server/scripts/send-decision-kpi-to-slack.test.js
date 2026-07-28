import { afterEach, describe, expect, it, vi } from 'vitest';

process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-secret';
process.env.SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || 'test-token';

const {
    fetchDecisionEvents,
    calculateKpi,
    formatRate,
    buildSlackBlocks,
    sendToSlack
} = await import('../../../scripts/send-decision-kpi-to-slack.js');

afterEach(() => {
    vi.restoreAllMocks();
});

function makeEvent(eventType, overrides = {}) {
    return {
        event_id: `evt_${Math.random()}`,
        occurred_at: '2026-07-01T00:00:00.000Z',
        event_type: eventType,
        ...overrides
    };
}

describe('send-decision-kpi-to-slack calculateKpi', () => {
    it('reports 計測不能 when there is no delegation-completing traffic', () => {
        const kpi = calculateKpi([]);
        expect(kpi.totalEvents).toBe(0);
        expect(formatRate(kpi.delegationRate, kpi.delegationDenominator)).toContain('計測不能');
        expect(formatRate(kpi.reworkRate, kpi.reworkDenominator)).toContain('計測不能');
    });

    it('computes delegation rate as (accepted+edited)/(accepted+edited+self_handled)', () => {
        const events = [
            makeEvent('draft_accepted'),
            makeEvent('draft_accepted'),
            makeEvent('draft_edited'),
            makeEvent('self_handled')
        ];
        const kpi = calculateKpi(events);
        // (2+1)/(2+1+1) = 75%
        expect(kpi.delegationRate).toBe(75);
    });

    it('computes rework rate as edited/(accepted+edited), not silently zero when unmeasurable', () => {
        const events = [makeEvent('self_handled'), makeEvent('escalated')];
        const kpi = calculateKpi(events);
        expect(kpi.reworkDenominator).toBe(0);
        expect(kpi.reworkRate).toBeNull();
        expect(formatRate(kpi.reworkRate, kpi.reworkDenominator)).toContain('計測不能');
    });

    it('counts escalated and rule_created independently of the rate calculations', () => {
        const events = [
            makeEvent('escalated'),
            makeEvent('escalated'),
            makeEvent('rule_created')
        ];
        const kpi = calculateKpi(events);
        expect(kpi.escalatedCount).toBe(2);
        expect(kpi.ruleCreatedCount).toBe(1);
    });
});

describe('send-decision-kpi-to-slack fetchDecisionEvents', () => {
    it('rejects a malformed API response before any Slack delivery can occur', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({ events: null })
        });

        await expect(fetchDecisionEvents({
            from: '2026-06-24T00:00:00.000Z',
            to: '2026-07-01T00:00:00.000Z'
        })).rejects.toThrow('events must be an array');
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock.mock.calls[0][0]).toBeInstanceOf(URL);
        expect(String(fetchMock.mock.calls[0][0])).toContain('/api/companion/decision-events');
    });
});

describe('send-decision-kpi-to-slack buildSlackBlocks', () => {
    it('reports 未受信 when there are zero events for the period', () => {
        const kpi = calculateKpi([]);
        const blocks = buildSlackBlocks(kpi, { from: '2026-06-24T00:00:00.000Z', to: '2026-07-01T00:00:00.000Z' });
        const text = JSON.stringify(blocks);
        expect(text).toContain('イベント未受信');
        expect(text).toContain('委任率');
        expect(text).toContain('差戻し率');
        expect(text.match(/計測不能/g)).toHaveLength(2);
    });
});

describe('send-decision-kpi-to-slack sendToSlack', () => {
    it('posts the weekly report to Slack and returns the acknowledged message', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({ ok: true, channel: 'C123', ts: '123.456' })
        });
        const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: 'weekly report' } }];

        await expect(sendToSlack(blocks, '#brainbase')).resolves.toMatchObject({
            channel: 'C123',
            ts: '123.456'
        });
        expect(fetchMock).toHaveBeenCalledOnce();

        const [url, request] = fetchMock.mock.calls[0];
        expect(url).toBe('https://slack.com/api/chat.postMessage');
        expect(request).toMatchObject({
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer test-token'
            }
        });
        expect(JSON.parse(request.body)).toEqual({
            channel: '#brainbase',
            blocks,
            text: '判断委任KPI 週次サマリー'
        });
    });
});
