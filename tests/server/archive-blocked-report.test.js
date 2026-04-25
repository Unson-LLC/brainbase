import { describe, expect, it } from 'vitest';

import {
    collectArchiveBlockedReport,
    formatArchiveBlockedReport
} from '../../scripts/archive-blocked-report.mjs';

describe('archive-blocked-report', () => {
    it('archived sessionのstatus集計とblocked明細を出す', () => {
        const report = collectArchiveBlockedReport([
            {
                id: 'session-cleaned',
                intendedState: 'archived',
                archive: { status: 'cleaned' }
            },
            {
                id: 'session-blocked',
                name: 'Blocked work',
                intendedState: 'archived',
                project: 'brainbase',
                worktree: { path: '/tmp/worktree' },
                archive: {
                    status: 'blocked',
                    blockerReason: 'working copy has changes',
                    recordPath: 'docs/session-archives/2026/04/session-blocked.md',
                    updatedAt: '2026-04-25T00:00:00.000Z'
                }
            },
            {
                id: 'session-active',
                intendedState: 'active'
            }
        ], new Date('2026-04-25T12:00:00.000Z'));

        expect(report.totalArchived).toBe(2);
        expect(report.statusCounts).toEqual({ blocked: 1, cleaned: 1 });
        expect(report.blocked).toHaveLength(1);
        expect(report.blocked[0]).toMatchObject({
            id: 'session-blocked',
            name: 'Blocked work',
            blockerReason: 'working copy has changes',
            ageHours: 12
        });
    });

    it('markdown reportに件数と上位blockedを含める', () => {
        const report = collectArchiveBlockedReport([
            {
                id: 'session-blocked',
                name: 'Blocked work',
                intendedState: 'archived',
                archive: { status: 'blocked', blockerReason: 'needs manual merge' }
            }
        ], new Date('2026-04-25T12:00:00.000Z'));

        const markdown = formatArchiveBlockedReport(report);

        expect(markdown).toContain('Blocked: 1');
        expect(markdown).toContain('session-blocked Blocked work');
        expect(markdown).toContain('reason: needs manual merge');
    });
});
