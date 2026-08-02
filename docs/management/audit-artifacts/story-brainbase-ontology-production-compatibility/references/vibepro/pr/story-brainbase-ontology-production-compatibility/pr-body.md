## 判断
- このPRで判断すること: 本番GraphとOntology 1.0.0の互換性を確立する を満たすための Contract Docs 変更として、このPRを受け入れてよいか。
- Story: story-brainbase-ontology-production-compatibility - 本番GraphとOntology 1.0.0の互換性を確立する
- 正本: [docs/management/stories/active/story-brainbase-ontology-production-compatibility.md](docs/management/stories/active/story-brainbase-ontology-production-compatibility.md)
- 変更範囲: 95 files / Contract Docs
- 設計/Story: [docs/management/audit-artifacts/story-brainbase-ontology-production-compatibility/references/vibepro/stories/story-brainbase-ontology-production-compatibility/diagnostics/2026-08-02T163157Z/tasks.json](docs/management/audit-artifacts/story-brainbase-ontology-production-compatibility/references/vibepro/stories/story-brainbase-ontology-production-compatibility/diagnostics/2026-08-02T163157Z/tasks.json), [docs/management/audit-artifacts/story-brainbase-ontology-production-compatibility/references/vibepro/stories/story-brainbase-ontology-production-compatibility/diagnostics/2026-08-02T163157Z/tasks.md](docs/management/audit-artifacts/story-brainbase-ontology-production-compatibility/references/vibepro/stories/story-brainbase-ontology-production-compatibility/diagnostics/2026-08-02T163157Z/tasks.md), [docs/management/stories/active/story-brainbase-ontology-production-compatibility.md](docs/management/stories/active/story-brainbase-ontology-production-compatibility.md), ...and 1 more

## 経緯
- 要求: 本番GraphとOntology 1.0.0の互換性を確立する
- 発生経緯: 2026-08-03の本番read-only監査では、7,403 entities / 6,680 edgesに対して6,156件の違反を検出した。主因は、稼働中の`belongs_to_project`始点型、storage型、legacy relation、Decisionのedge表現がOntology 1.0.0候補に未登録だったことである。一方、31件の孤児edge、org ownerを確認できない26 app、Decision authority/scopeの欠損は事実を推測せず残す必要がある。


## 原因
- Story文書から根本原因を抽出できませんでした。

## 解決
- Story文書を更新: [docs/management/audit-artifacts/story-brainbase-ontology-production-compatibility/references/vibepro/stories/story-brainbase-ontology-production-compatibility/diagnostics/2026-08-02T163157Z/tasks.json](docs/management/audit-artifacts/story-brainbase-ontology-production-compatibility/references/vibepro/stories/story-brainbase-ontology-production-compatibility/diagnostics/2026-08-02T163157Z/tasks.json), [docs/management/audit-artifacts/story-brainbase-ontology-production-compatibility/references/vibepro/stories/story-brainbase-ontology-production-compatibility/diagnostics/2026-08-02T163157Z/tasks.md](docs/management/audit-artifacts/story-brainbase-ontology-production-compatibility/references/vibepro/stories/story-brainbase-ontology-production-compatibility/diagnostics/2026-08-02T163157Z/tasks.md), [docs/management/stories/active/story-brainbase-ontology-production-compatibility.md](docs/management/stories/active/story-brainbase-ontology-production-compatibility.md)

## 受入判定スコープ
- 判定単位: Story
- Story ID: story-brainbase-ontology-production-compatibility
- Task ID: なし
- 対象受入基準: 6件


## Release Notes

### Change Summary
Story文書を更新: [docs/management/audit-artifacts/story-brainbase-ontology-production-compatibility/references/vibepro/stories/story-brainbase-ontology-production-compatibility/diagnostics/2026-08-02T163157Z/tasks.json](docs/management/audit-artifacts/story-brainbase-ontology-production-compatibility/references/vibepro/stories/story-brainbase-ontology-production-compatibility/diagnostics/2026-08-02T163157Z/tasks.json), [docs/management/audit-artifacts/story-brainbase-ontology-production-compatibility/references/vibepro/stories/story-brainbase-ontology-production-compatibility/diagnostics/2026-08-02T163157Z/tasks.md](docs/management/audit-artifacts/story-brainbase-ontology-production-compatibility/references/vibepro/stories/story-brainbase-ontology-production-compatibility/diagnostics/2026-08-02T163157Z/tasks.md), [docs/management/stories/active/story-brainbase-ontology-production-compatibility.md](docs/management/stories/active/story-brainbase-ontology-production-compatibility.md)

### Compatibility
なし

### User Action
なし

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Design Input Judgment Gate, Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: 差分が 95 files あり、レビュー可能な目安 30 files を超えている; baseからのcommitが 4 件あるため履歴確認が必要だが、別Story lineageは検出されていない / split=split_by_lane_then_prepare
- Scope lineage evidence: -
- 分割判断: 分割推奨 / 自動勧告: split_recommended / split_by_lane_then_prepare / lanes: requirements-ssot, misc-follow-up / 採用: split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- ADRなしで既存設計の範囲に収まっているか

## 確認
- [ ] 手動確認または対象テストを追記する
- 最終E2E: not_required: UI/E2E対象の差分ではないため、Unit / Integration証跡で完了判定する

## 詳細
- 証跡: [.vibepro/pr/story-brainbase-ontology-production-compatibility/](.vibepro/pr/story-brainbase-ontology-production-compatibility/)
- PR準備: [.vibepro/pr/story-brainbase-ontology-production-compatibility/pr-prepare.json](.vibepro/pr/story-brainbase-ontology-production-compatibility/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-brainbase-ontology-production-compatibility/decision-index.summary.json](.vibepro/pr/story-brainbase-ontology-production-compatibility/decision-index.summary.json)（bounded summary / 全文: [.vibepro/pr/story-brainbase-ontology-production-compatibility/decision-index.json](.vibepro/pr/story-brainbase-ontology-production-compatibility/decision-index.json)）
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.2.0-beta.2 37418424323e detached/package dirty (story=story-brainbase-ontology-production-compatibility)
