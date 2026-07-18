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

## Retired Implementation Guidance

この節のBrainbase Web実装案は採用しない。prototypeから確定したguardrailと判断材料だけをCoreへ残し、操作面は次へ分離する。

- Meeting Packの実行・診断: MCP + `MeetingAutomationService`
- 要承認queueとfocused review: Mac Companion + `CompanionApprovalInboxService`
- Run identity、output、human gate、audit: 既存ledger contract
- Brainbase Web: 設定とログインのみ

## Guardrails

- Generated task, Decision, and message candidates are not SSOT.
- Decision promotion to Graph SSOT requires human approval.
- External message send requires human approval.
- Event retry must not create duplicate outputs without explicit retry evidence.
- Private meeting or channel context must not leak into wider project or org outputs.
- If project/channel/meeting identity cannot be resolved, the run should become `needs_action` rather than silently skipping.

## Visual Artifacts

These screenshots are historical design evidence, not acceptance criteria for a future Brainbase Web UI:

- `docs/design/assets/meeting-workflow-pack/cockpit.png`
- `docs/design/assets/meeting-workflow-pack/hitl-queue.png`
- `docs/design/assets/meeting-workflow-pack/hitl-review.png`
- `docs/design/assets/meeting-workflow-pack/hitl-confirm.png`
- `docs/design/assets/meeting-workflow-pack/r3-reject.png`
- `docs/design/assets/meeting-workflow-pack/r4-agentmenu.png`
- `docs/design/assets/meeting-workflow-pack/r4-dropdown.png`
- `docs/design/assets/meeting-workflow-pack/r4-stub.png`

## Retirement Note

このUI設計は履歴資料としてのみ保持する。Brainbase WebのWorkflow画面は廃止済みであり、再実装の入力にはしない。Meeting Packの実行・確認はMCP、要承認projectionはMac Companion、設定だけがBrainbase Webの責務である。現行実装の参照先は次のとおり。

1. `docs/architecture/workflow-product-retirement-architecture.md`
2. `server/services/meeting-automation/meeting-automation-service.js`
3. `server/services/companion/approval-inbox-service.js`
4. `server/services/workflow/workflow-repository.js`
