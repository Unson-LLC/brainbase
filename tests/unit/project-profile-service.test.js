import { describe, expect, it } from 'vitest';
import {
    assertNoDeclaredCrossTenantReferences,
    inspectProjectProfile,
    reconcileProjectPeople,
    validateProjectCreateInput
} from '../../server/services/project-profile-service.js';

describe('project profile capability intent', () => {
    it('accepts the four-field minimal registration', () => {
        expect(validateProjectCreateInput({
            project_code: 'growin',
            name: 'Growin向けBrainbase',
            organization: 'unson',
            created_by: 'keigo'
        })).toEqual({
            project_code: 'growin',
            name: 'Growin向けBrainbase',
            organization: 'unson',
            created_by: 'keigo',
            capabilities: {}
        });
    });

    it('rejects invalid desired_state values', () => {
        expect(() => validateProjectCreateInput({
            project_code: 'growin',
            name: 'Growin',
            organization: 'unson',
            created_by: 'keigo',
            capabilities: { mana: { desired_state: 'maybe' } }
        })).toThrow('desired_state「maybe」は使用できません');
    });

    it('does not require disabled or deferred capabilities to be configured and keeps enabled ones unverified', () => {
        const result = inspectProjectProfile({
            id: 'growin',
            capabilities: {
                mana: { desired_state: 'disabled', reason: '人間がSlack対応する' },
                github: { desired_state: 'deferred' },
                slack: { desired_state: 'enabled', primary_channel_id: 'C123456' },
                drive: { desired_state: 'enabled', folder_id: 'folder-1' }
            },
            people: { owner: ['keigo'], team_status: 'complete' },
            success_criteria: ['利用部門が運用開始できる']
        });

        expect(result.project).toBe('registered');
        expect(result.capabilities).toMatchObject({
            core: 'ready',
            mana: 'disabled',
            github: 'deferred',
            slack: 'unverified',
            drive: 'unverified',
            people: 'unverified'
        });
        expect(result.warnings.map(warning => warning.code)).toEqual([
            'enabled_capability_unverified',
            'enabled_capability_unverified',
            'people_unverified'
        ]);
    });

    it('reports ready only when a trusted verifier receipt is present', () => {
        const result = inspectProjectProfile({
            id: 'growin',
            capabilities: {
                slack: {
                    desired_state: 'enabled',
                    primary_channel_id: 'C123456',
                    verification: {
                        status: 'verified',
                        evidence_id: 'slack-check-123',
                        verified_at: '2026-09-01T00:00:00.000Z'
                    }
                }
            }
        });
        expect(result.capabilities.slack).toBe('ready');
    });

    it('fails closed when persisted desired_state is unknown', () => {
        const result = inspectProjectProfile({
            id: 'growin',
            capabilities: {
                slack: {
                    desired_state: 'bogus',
                    primary_channel_id: 'C123456',
                    verification: {
                        status: 'verified',
                        evidence_id: 'stale-or-corrupt-receipt',
                        verified_at: '2026-09-01T00:00:00.000Z'
                    }
                }
            }
        });

        expect(result.capabilities.slack).toBe('warning');
        expect(result.warnings).toContainEqual(expect.objectContaining({
            code: 'capability_intent_invalid',
            capability: 'slack',
            desired_state: 'bogus'
        }));
    });

    it('rejects malformed references and caller-supplied verification claims', () => {
        const base = {
            project_code: 'growin',
            name: 'Growin',
            organization: 'unson',
            created_by: 'keigo'
        };
        expect(() => validateProjectCreateInput({
            ...base,
            capabilities: { slack: { desired_state: 'enabled', primary_channel_id: true } }
        })).toThrow('primary_channel_idは空でない文字列で指定してください');
        expect(() => validateProjectCreateInput({
            ...base,
            capabilities: { slack: { desired_state: 'enabled', verification: { status: 'verified' } } }
        })).toThrow('信頼済み検証器だけが設定できます');
        expect(() => validateProjectCreateInput({
            ...base,
            people: { owner: [null] }
        })).toThrow('人物を識別できる値で指定してください');
        expect(() => validateProjectCreateInput({
            ...base,
            people: { owner: 'keigo' }
        })).toThrow('people.ownerは配列で指定してください');
        expect(() => assertNoDeclaredCrossTenantReferences('unson', {
            slack: { desired_state: 'enabled', organization: 'other-company' }
        }, undefined)).toThrow('capabilities.slackは別のorganizationに属しています');
    });

    it('warns instead of blocking when intent or enabled configuration is missing', () => {
        const result = inspectProjectProfile({
            id: 'growin',
            capabilities: {
                mana: { desired_state: 'enabled' },
                github: { desired_state: 'unspecified' }
            }
        });

        expect(result.project).toBe('registered');
        expect(result.capabilities.mana).toBe('unconfigured');
        expect(result.capabilities.github).toBe('warning');
        expect(result.capabilities.people).toBe('warning');
        expect(result.warnings.map(warning => warning.code)).toContain('enabled_capability_unconfigured');
        expect(result.warnings.map(warning => warning.code)).toContain('success_criteria_unspecified');
        expect(result.verification_scope.graph_registration).toBe('unverified');
    });

    it('returns choices for unregistered people candidates without adding them', () => {
        const result = reconcileProjectPeople(
            { id: 'growin', people: { owner: ['keigo'], team: [{ person_id: 'umeda' }] } },
            [
                { person_id: 'keigo', evidence: ['owner'] },
                { person_id: 'umeda', evidence: ['meeting'] },
                { person_id: 'kuramoto', evidence: ['slack_channel_member'] }
            ]
        );

        expect(result.summary).toEqual({ candidates: 1, already_registered: 2 });
        expect(result.candidates[1]).toMatchObject({
            person_id: 'umeda',
            status: 'already_registered',
            actions: []
        });
        expect(result.candidates[2]).toMatchObject({
            person_id: 'kuramoto',
            status: 'candidate',
            actions: ['add', 'add_as_external', 'exclude', 'defer']
        });
    });

    it('rejects malformed candidate input with Japanese messages', () => {
        expect(() => reconcileProjectPeople({ id: 'growin', people: {} }, null))
            .toThrow('people_candidatesは配列で指定してください');
        expect(() => reconcileProjectPeople({ id: 'growin', people: {} }, [null]))
            .toThrow('people_candidates[0]はオブジェクト形式で指定してください');
    });

    it('denies a candidate explicitly belonging to another organization with an auditable error', () => {
        expect(() => reconcileProjectPeople(
            { id: 'growin', organization: 'unson', people: {} },
            [{ person_id: 'other-person', organization: 'other-company', evidence: ['slack'] }]
        )).toThrow(expect.objectContaining({
            code: 'CROSS_TENANT_CANDIDATE',
            statusCode: 403,
            details: {
                required_action: 'none',
                audit_event: 'cross_tenant_candidate_denied'
            }
        }));
    });

    it('keeps candidates with an unknown organization eligible for review', () => {
        const result = reconcileProjectPeople(
            { id: 'growin', organization: 'unson', people: {} },
            [
                { person_id: 'unknown-org' },
                { person_id: 'same-org', organization: 'unson' }
            ]
        );

        expect(result.candidates).toMatchObject([
            { person_id: 'unknown-org', status: 'candidate' },
            { person_id: 'same-org', status: 'candidate' }
        ]);
    });
});
