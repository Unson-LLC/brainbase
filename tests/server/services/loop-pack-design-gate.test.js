import { describe, expect, it } from 'vitest';

import { reviewLoopPackDesign } from '../../../server/services/workflow/loop-pack-design-gate.js';
import { buildMeetingWorkflowPackRecords } from '../../../server/services/workflow/meeting-workflow-pack.js';

function meetingManifest() {
    return buildMeetingWorkflowPackRecords({
        orgId: 'salestailor',
        projectId: 'salestailor',
        actorId: 'keigo'
    }).loop_pack_manifest;
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

describe('Loop Pack Design Gate', () => {
    it('story-loop-pack-design-gate-v0 S-001 passes the Meeting Workflow Pack manifest', () => {
        const records = buildMeetingWorkflowPackRecords({
            orgId: 'salestailor',
            projectId: 'salestailor',
            actorId: 'keigo'
        });

        expect(records.loop_pack_design_review).toMatchObject({
            gate_id: 'loop_pack_design_gate.v0',
            status: 'pass',
            pack_id: 'mana-meeting-workflow-pack-v1'
        });
        expect(records.loop_pack_design_review.manifest_digest).toMatch(/^[a-f0-9]{64}$/);
        expect(records.loop_pack_manifest.completion_rubric.map((item) => item.id)).toEqual([
            'loop_closure',
            'human_gate_integrity',
            'evidence_integrity'
        ]);
    });

    it('story-loop-pack-design-gate-v0 S-003 blocks a manifest without completion rubric', () => {
        const manifest = clone(meetingManifest());
        manifest.completion_rubric = [];

        const review = reviewLoopPackDesign(manifest);

        expect(review.status).toBe('needs_revision');
        expect(review.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
            'missing_required_section',
            'missing_loop_closure_rubric'
        ]));
    });

    it('story-loop-pack-design-gate-v0 S-004 blocks risky outputs without a valid Human Gate', () => {
        const manifest = clone(meetingManifest());
        manifest.outputs = manifest.outputs.map((output) => (
            output.side_effect_type === 'graph_promotion'
                ? { ...output, human_gate_ref: null }
                : output
        ));

        const review = reviewLoopPackDesign(manifest);

        expect(review.status).toBe('needs_revision');
        expect(review.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: 'unsafe_side_effect',
                path: 'outputs.meeting-note-to-decisions.output'
            })
        ]));
    });

    it('story-loop-pack-design-gate-v0 INV-006 blocks risky outputs protected by the wrong Human Gate', () => {
        const manifest = clone(meetingManifest());
        manifest.outputs = manifest.outputs.map((output) => (
            output.side_effect_type === 'graph_promotion'
                ? { ...output, human_gate_ref: 'optional_before_share' }
                : output
        ));

        const review = reviewLoopPackDesign(manifest);

        expect(review.status).toBe('needs_revision');
        expect(review.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: 'unsafe_side_effect',
                path: 'outputs.meeting-note-to-decisions.output'
            })
        ]));
    });

    it('story-loop-pack-design-gate-v0 S-005 blocks direct runtime ledger mutation as pack creation', () => {
        const manifest = clone(meetingManifest());
        manifest.runner_policy.direct_runtime_state_mutation = true;

        const review = reviewLoopPackDesign(manifest);

        expect(review.status).toBe('needs_revision');
        expect(review.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: 'direct_runtime_mutation_not_for_pack_creation',
                path: 'runner_policy.direct_runtime_state_mutation'
            })
        ]));
    });

    it.each([
        [
            'workflow_without_binding',
            (manifest) => {
                const missingTemplateId = manifest.workflow_templates[0].id;
                manifest.bindings = manifest.bindings.filter((binding) => binding.workflow_template_id !== missingTemplateId);
            }
        ],
        [
            'binding_without_trigger',
            (manifest) => {
                const missingBindingId = manifest.bindings[0].id;
                manifest.triggers = manifest.triggers.filter((trigger) => trigger.workflow_binding_id !== missingBindingId);
            }
        ],
        [
            'missing_trigger_class',
            (manifest) => {
                manifest.triggers = manifest.triggers.filter((trigger) => trigger.trigger_type !== 'schedule');
            }
        ],
        [
            'missing_budget_or_stop',
            (manifest) => {
                manifest.budget.max_tokens = 0;
            }
        ],
        [
            'missing_judge_seat',
            (manifest) => {
                manifest.judge_seats = manifest.judge_seats.filter((seat) => seat.role !== 'reviewer');
            }
        ]
    ])('story-loop-pack-design-gate-v0 FM-001 blocks %s contract regressions', (issueCode, mutateManifest) => {
        const manifest = clone(meetingManifest());
        mutateManifest(manifest);

        const review = reviewLoopPackDesign(manifest);

        expect(review.status).toBe('needs_revision');
        expect(review.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: issueCode })
        ]));
    });
});
