---
story_id: story-ten-minute-world-onboarding-runtime
title: 接続済みsource receiptから10分オンボーディングを実行するRuntime基盤
status: active
created_at: 2026-08-02
updated_at: 2026-08-03
horizon: sprint
view: product
period: 2026-W31
architecture_docs:
  - docs/architecture/story-ten-minute-world-onboarding-runtime.md
spec_docs:
  - docs/specs/ten-minute-world-onboarding-runtime-spec.md
pr_scope_strategy: atomic_single_pr
pr_scope_reason: "The Story, architecture, machine-readable specification, authenticated HTTP and MCP adapters, Candidate Store promotion recovery, and vertical tests form one fail-closed runtime contract. The independently releasable host-agent Skill is intentionally excluded from this runtime PR."
pr_scope_review_facets:
  - requirements-ssot
  - runtime-behavior
  - e2e-gate
  - misc-follow-up
pr_scope_dependency_boundaries:
  - requirements-ssot->runtime-behavior
  - runtime-behavior->e2e-gate
  - e2e-gate->misc-follow-up
---

# 接続済みsource receiptから10分オンボーディングを実行するRuntime基盤

## Delivery Boundary

このStoryが実装・完了判定するのは、hostから受け取ったbounded source receiptをCandidate Store、Promotion Gate、Graph SSOT、first-value reviewへ流すBrainbase server/API/MCP runtime contractである。Drive/Gmail/MCP/local folderをhost agentが発見・取得してこのcontractへ渡す利用者向けentry pointは、親Story `story-ten-minute-world-onboarding` のAC-001..006に残る別delivery sliceであり、別PRで完了させるまで`host_entry_blocked`とする。

したがって、このRuntime StoryのmergeだけではBrainbaseオンボーディング全体、実connector導線、または10分のproduction outcomeを完成・提供済みと表明しない。

## User Story

Brainbaseのhost integrationを実装する開発者として、認証済みhostが限定取得したsource receiptを、秘密値を保持せずCandidate Store、Promotion Gate、Graph SSOT、first-value reviewへ流せる共通runtime contractを使いたい。そうすれば、別delivery sliceのhost entry pointからMCP、Drive、Gmail、local folder、または単一文書を同じfail-closed経路へ接続できる。

## Business Context

初回利用者に会社情報の再入力を求めると、既存のDrive、Gmail、MCP、ローカル文書とBrainbaseの間に二重入力が生まれ、Graphの価値へ到達する前に離脱する。Brainbaseは、利用者がすでに許可した情報源から必要最小限の証拠だけを取得し、観測事実を人間が確認した後にGraphへ昇格することで、「自社の世界が立ち上がった」と実感できる最初の回答を短時間で返す必要がある。

## Success Metrics

- Primary: sourceが`ready`になってから`useful|not_useful`の初回回答レビューまでの時間を計測し、10分以内かをrun receiptへ記録する。
- Safety: 未承認または`inferred`の候補がGraphへ昇格した件数を0件に保つ。
- Privacy: credential、token、raw本文をonboarding run ledgerへ保存した件数を0件に保つ。
- Evidence: fixture E2Eでは`within_ten_minutes=true`を再現する。実利用者の有用率とproductionでの10分達成率はdeploy後のlive evidenceとして別に測定し、fixture結果から推定しない。

## Acceptance Criteria

- [x] RT-AC-001: 認証済みhostから受け取る`mcp|drive|gmail|local_folder|single_document`のsource modeでrunを作成できる。providerの発見・認可・本文取得はこのStoryの外である。
- [x] RT-AC-002: source receiptはpointer/hash/permission/statusだけを保存し、credential、token、raw本文を保存しない。
- [x] RT-AC-003: evidence、scope、observation classを持つfactをCandidate Storeへ隔離し、未承認candidateをGraphへ書かない。
- [x] RT-AC-004: inferred candidateはapproveできず、observed candidateだけを明示承認でGraphへ昇格する。
- [x] RT-AC-005: reject済みcandidateは監査に残るがGraph IDを持たない。
- [x] RT-AC-006: first-value receiptは同一runでpromoted済みのGraph entity IDだけを参照する。
- [x] RT-AC-007: useful/not_useful review後にsource-readyから600秒以内かを返す。
- [x] RT-AC-008: MCP toolsがstart/get/ingest/review/first-value APIを認証付きで呼び、unavailableと空結果を分ける。
- [x] RT-AC-009: fixture E2Eでruntime receiptから先の全経路、project scope、inferred昇格拒否を検証する。host connectorやAgent Skillはfixtureで置換し、利用者向けentry pointのE2Eとは扱わない。

## Evidence Boundary

fixture E2Eはruntime contractの証拠であり、host-agent Skill binding、実Drive/Gmail/MCP/local folderのproduction接続、deploy済みSHA、利用者実データでの10分成果ではない。`story-ten-minute-world-onboarding`のAC-001..006を別PRで満たすまで、利用者向けhost entryはblockedである。

## Links

- Parent Story: `docs/stories/story-ten-minute-world-onboarding.md`
- Blocking delivery dependency: `story-ten-minute-world-onboarding` AC-001..006（host-agent entry point。別PR必須）
- Architecture: `docs/architecture/story-ten-minute-world-onboarding-runtime.md`
- Spec: `docs/specs/ten-minute-world-onboarding-runtime-spec.md`
