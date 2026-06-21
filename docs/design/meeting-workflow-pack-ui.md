# Mana Meeting Workflow Pack UI

## Source

User-provided prototype archive:

- `/Users/ksato/Downloads/会議業務Workflow定義UI設計.zip`

Imported local artifacts:

- Prototype: `docs/design/prototypes/meeting-workflow-pack/meeting-workflow-pack.dc.html`
- Runtime support: `docs/design/prototypes/meeting-workflow-pack/support.js`
- Screenshots: `docs/design/assets/meeting-workflow-pack/*.png`

## What Was Confirmed

The archive is a DC prototype, not a direct app patch. It defines an Agent Loop Control style UI for the Mana meeting workflow pack and includes screenshots for cockpit, human-in-the-loop queue, focused review, rejection, agent menu, and stub agent states.

The prototype is aligned with `story-mana-meeting-workflow-pack-v0`:

- `Meeting Ops Agent` is a Role Agent selector, not the output SSOT.
- Workflow Definition is the central unit.
- The pack covers `schedule`, `event`, and `human` trigger classes.
- Human Gate is first-class for task creation, Decision promotion, and external message sending.
- Run Trace keeps source meeting, runner output, candidate outputs, approval state, and write-back target visible.

## UI Model

The prototype separates daily operation from reference surfaces:

- Header: Agent Loop Control, org/instance switcher, Role Agent switcher, approval queue count.
- Left rail `OPERATE`: approval waiting queue and in-progress runs.
- Left rail `REFERENCE`: overview and Workflow Definition lanes grouped by trigger class.
- Main overview: Meeting Ops Agent identity, lifecycle map, guardrails.
- Definition detail: input, context, judgment DAG, output contract, human gate, write-back mapping, audit requirements.
- Run Trace: meeting source to outputs, human gates, write-back status.
- HITL Queue: pending approvals ordered by risk.
- HITL Review: focused approval screen with include/exclude/edit, consequence text, high-risk confirmation, approve/reject.
- Other Role Agents: stub view showing the same control-plane shape can be reused for Sales, Back-office, and Marketing agents later.

## Implementation Guidance

Do not paste the DC runtime directly into `public/workflows.html`.

Use the prototype as a design input and implement with existing Brainbase surfaces:

- Main app surface: `public/workflows.html`
- APIs: `/api/workflows/control/...`, `/api/workflows`, `/api/workflow-runs/:runId`
- Existing control concepts: Role Agent Instance, Workflow Template/Definition, Workflow Binding, Workflow Trigger, Loop Intent, Human Step, Workflow Output, Audit Log.

Recommended app implementation order:

1. Add a `Meeting Workflow Pack` projection inside the existing Agent Loop Control area.
2. Rename or visually present Workflow Template rows as `Workflow Definition` for the meeting pack UI, while preserving existing backend field names until the data model is intentionally renamed.
3. Add seeded or API-backed meeting definitions for:
   - `pre-meeting-briefing`
   - `transcript-to-meeting-note`
   - `meeting-note-to-tasks`
   - `meeting-note-to-decisions`
   - `post-meeting-follow-up-message`
4. Add trigger-lane grouping by `schedule`, `event`, and `human`.
5. Add a Human Gate queue view that can show task, Decision, and message approval items.
6. Add a focused review view that supports approve, reject, include/exclude, edit, and high-risk confirmation.
7. Add Run Trace fields for `meeting_identity`, `meeting_source`, `workflow_definition_id`, `human_gate`, `write_back_target`, `write_back_status`, and `evidence_refs`.

## Guardrails

- Generated task, Decision, and message candidates are not SSOT.
- Decision promotion to Graph SSOT requires human approval.
- External message send requires human approval.
- Event retry must not create duplicate outputs without explicit retry evidence.
- Private meeting or channel context must not leak into wider project or org outputs.
- If project/channel/meeting identity cannot be resolved, the run should become `needs_action` rather than silently skipping.

## Visual Artifacts

Use these screenshots as acceptance evidence for future UI work:

- `docs/design/assets/meeting-workflow-pack/cockpit.png`
- `docs/design/assets/meeting-workflow-pack/hitl-queue.png`
- `docs/design/assets/meeting-workflow-pack/hitl-review.png`
- `docs/design/assets/meeting-workflow-pack/hitl-confirm.png`
- `docs/design/assets/meeting-workflow-pack/r3-reject.png`
- `docs/design/assets/meeting-workflow-pack/r4-agentmenu.png`
- `docs/design/assets/meeting-workflow-pack/r4-dropdown.png`
- `docs/design/assets/meeting-workflow-pack/r4-stub.png`

## Next AI Handoff

The next implementation agent should treat this as design input for the real Brainbase UI, not as finished production code. Start by reading:

1. `docs/stories/story-mana-meeting-workflow-pack-v0.md`
2. `docs/design/meeting-workflow-pack-ui.md`
3. `docs/stories/story-org-agent-loop-control-v0.md`
4. `docs/architecture/org-agent-loop-control-architecture.md`
5. `docs/specs/story-org-agent-loop-control-v0-spec.md`
6. `public/workflows.html`
7. `server/routes/workflows.js`
8. `server/services/workflow/workflow-repository.js`
9. `server/services/workflow/workflow-service.js`

The implementation should not overwrite unrelated `public/admin.*` changes from other local work.
