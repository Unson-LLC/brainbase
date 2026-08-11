import { describe, expect, it, vi } from 'vitest';

import { MeetingTaskOwnerResolver } from '../../../server/services/meeting-automation/meeting-task-owner-resolver.js';

describe('MeetingTaskOwnerResolver', () => {
    it('People SSOTの別名を使ってMeeting task candidateの担当者を解決する', async () => {
        const infoSSOTService = {
            listGraphEntities: vi.fn(async (_access, options) => {
                if (options.entityType !== 'person' || options.query !== 'キング') return [];
                return [{
                    id: 'person_sato_keigo',
                    member_of_project_codes: ['brainbase'],
                    payload: {
                        display_name: '佐藤 圭吾',
                        aliases: ['キング'],
                        status: 'active'
                    }
                }];
            })
        };
        const resolver = new MeetingTaskOwnerResolver({ infoSSOTService });

        const resolved = await resolver.resolveReviewTaskOwners({
            task_candidates: [{ title: '確認する', owner_hint: '@キング' }]
        }, {
            actor: { role: 'member', projectCodes: ['brainbase'], person_id: 'person_sato_keigo' },
            projectId: 'brainbase'
        });

        expect(resolved.task_candidates[0]).toMatchObject({
            selected_owner_id: 'person_sato_keigo',
            selected_owner: '佐藤 圭吾',
            owner_resolution: {
                source: 'graph_ssot',
                status: 'resolved',
                reason: 'unique_exact_name_or_alias'
            }
        });
    });
});
