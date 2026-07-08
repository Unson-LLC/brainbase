import { describe, expect, it } from 'vitest';

process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-secret';
process.env.SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || 'test-token';

const { calculateKpi, formatRate, buildSlackBlocks } = await import('../../../scripts/send-decision-kpi-to-slack.js');

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

describe('send-decision-kpi-to-slack buildSlackBlocks', () => {
    it('reports 未受信 when there are zero events for the period', () => {
        const kpi = calculateKpi([]);
        const blocks = buildSlackBlocks(kpi, { from: '2026-06-24T00:00:00.000Z', to: '2026-07-01T00:00:00.000Z' });
        const text = JSON.stringify(blocks);
        expect(text).toContain('イベント未受信');
    });
});
