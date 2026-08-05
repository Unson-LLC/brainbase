## 判断
- このPRで判断すること: 既存の仕事ソースから10分で自分の世界を立ち上げる を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-brainbase-portable-connected-world-onboarding - 既存の仕事ソースから10分で自分の世界を立ち上げる
- 正本: [docs/management/stories/active/story-brainbase-portable-connected-world-onboarding.md](docs/management/stories/active/story-brainbase-portable-connected-world-onboarding.md)
- 変更範囲: 18 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-brainbase-portable-connected-world-onboarding.md](docs/management/stories/active/story-brainbase-portable-connected-world-onboarding.md), [docs/architecture/story-brainbase-portable-connected-world-onboarding.md](docs/architecture/story-brainbase-portable-connected-world-onboarding.md), [docs/specs/story-brainbase-portable-connected-world-onboarding.md](docs/specs/story-brainbase-portable-connected-world-onboarding.md)
- 実装: [src/connected-onboarding.ts](src/connected-onboarding.ts), [src/import-extract.ts](src/import-extract.ts), [src/server.ts](src/server.ts), ...and 2 more
- テスト: [tests/connected-onboarding.test.ts](tests/connected-onboarding.test.ts), [tests/e2e/brainbase-mcp-only-acceptance.spec.ts](tests/e2e/brainbase-mcp-only-acceptance.spec.ts), [tests/e2e/onboarding-skills-installer-acceptance.spec.ts](tests/e2e/onboarding-skills-installer-acceptance.spec.ts), ...and 4 more

## 経緯
- 要求: 既存の仕事ソースから10分で自分の世界を立ち上げる
- 発生経緯: 公開版Brainbaseには、手入力とファイルimportを中心にした個人オンボーディングはある。しかし、ホストエージェントが実際に呼び出せるMCP、Drive、Gmail、限定ローカルフォルダ、単一ドキュメントを棚卸しし、最小範囲の証拠候補を人間レビューへつなぎ、承認済み事実だけで最初の価値を返す一続きの実行契約はない。 既存ソースの本文やsecretをBrainbaseへ保存せず、実在する接続、限定された取得範囲、候補ごとの根拠、人間の判断、Ontology-validな正本昇格を一続きにする。 Brainbaseを初めて使う人として、既に接続できる仕事ソースを追加の設定なしで棚卸しし、使える最小範囲だけから候補を確認し、承認した事実だけを使った最初の回答を10分以内に評価したい。そうすることで、大量の初期入力や不透明な自動学習なしにBrainbaseの価値を理解できる。 現在HEADに結び付いたunit、MCP contract、fixture E2E、full test、typecheck/build、VibePro Gateとrequired reviewがすべて成功した時に完了とする。mergeとnpm公開は実装完了とは別のrelease判断として証跡を分離する。


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/management/stories/active/story-brainbase-portable-connected-world-onboarding.md](docs/management/stories/active/story-brainbase-portable-connected-world-onboarding.md)

## 受入判定スコープ
- 判定単位: Story
- Story ID: story-brainbase-portable-connected-world-onboarding
- Task ID: なし
- 対象受入基準: 13件


## Release Notes

### Change Summary
Story文書を更新: [docs/management/stories/active/story-brainbase-portable-connected-world-onboarding.md](docs/management/stories/active/story-brainbase-portable-connected-world-onboarding.md)

### Compatibility
なし

### User Action
なし

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 4 件あるため履歴確認が必要だが、別Story lineageは検出されていない / split=split_by_lane_then_prepare
- Scope lineage evidence: -
- 分割判断: atomic rejected: atomic scope requires a current-head reviewer owner map with every configured role passing / owner repair roles: gate:gate_evidence / uncovered paths: tests/e2e/brainbase-mcp-only-acceptance.spec.ts, tests/e2e/onboarding-skills-installer-acceptance.spec.ts, tests/e2e/story-brainbase-portable-ontology-kernel-acceptance.spec.ts, docs/management/decisions/2026-08-04-budget-override-story-brainbase-portable-connected-world-onboarding-281eba5c.md, docs/manual/guide/mcp-install.md, docs/manual/reference/mcp-tools.md / commands: vibepro review prepare . --id story-brainbase-portable-connected-world-onboarding --stage gate --role gate_evidence / follow-up: vibepro review status . --id story-brainbase-portable-connected-world-onboarding / 自動勧告: split_recommended / split_by_lane_then_prepare / lanes: requirements-ssot, runtime-behavior, e2e-gate, misc-follow-up / 採用: split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/connected-onboarding.ts](src/connected-onboarding.ts), [src/import-extract.ts](src/import-extract.ts), [src/server.ts](src/server.ts), [src/skills.ts](src/skills.ts), ...
- テスト差分: [tests/connected-onboarding.test.ts](tests/connected-onboarding.test.ts), [tests/e2e/brainbase-mcp-only-acceptance.spec.ts](tests/e2e/brainbase-mcp-only-acceptance.spec.ts), [tests/e2e/onboarding-skills-installer-acceptance.spec.ts](tests/e2e/onboarding-skills-installer-acceptance.spec.ts), [tests/e2e/story-brainbase-portable-connected-world-onboarding-acceptance.spec.ts](tests/e2e/story-brainbase-portable-connected-world-onboarding-acceptance.spec.ts), ...
- Risk: 最新診断gateが needs_review

## 確認
- [x] Unit Gate - vibepro verify run executed the unit command: exit_code=0, duration_ms=8066, status=pass computed from the exit code | agent summary: Full executable non-release suite covers every changed path plus negative and recovery modes; evidence: [.vibepro/pr/story-brainbase-portable-connected-world-onboarding/verification-runs/unit.json](.vibepro/pr/story-brainbase-portable-connected-world-onboarding/verification-runs/unit.json) / gate: passed / evidence: [.vibepro/pr/story-brainbase-portable-connected-world-onboarding/verification-runs/unit.json](.vibepro/pr/story-brainbase-portable-connected-world-onboarding/verification-runs/unit.json)
- [x] Integration Gate - vibepro verify run executed the build command: exit_code=0, duration_ms=4672, status=pass computed from the exit code | agent summary: Current runtime path and public MCP surface compile on current HEAD; evidence: [.vibepro/pr/story-brainbase-portable-connected-world-onboarding/verification-runs/build.json](.vibepro/pr/story-brainbase-portable-connected-world-onboarding/verification-runs/build.json) / gate: passed / evidence: [.vibepro/pr/story-brainbase-portable-connected-world-onboarding/verification-runs/build.json](.vibepro/pr/story-brainbase-portable-connected-world-onboarding/verification-runs/build.json)
- [x] E2E Gate - vibepro verify run executed the e2e command: exit_code=0, duration_ms=1273, status=pass computed from the exit code | agent summary: Story AC-1 through AC-13 execute start ingest review first-value verdict and canonical search; evidence: [.vibepro/pr/story-brainbase-portable-connected-world-onboarding/verification-runs/e2e.json](.vibepro/pr/story-brainbase-portable-connected-world-onboarding/verification-runs/e2e.json) / gate: passed / evidence: [.vibepro/pr/story-brainbase-portable-connected-world-onboarding/verification-runs/e2e.json](.vibepro/pr/story-brainbase-portable-connected-world-onboarding/verification-runs/e2e.json)
- 最終E2E: pass: vibepro verify run executed the e2e command: exit_code=0, duration_ms=1273, status=pass computed from the exit code | agent summary: Story AC-1 through AC-13 execute start ingest review first-value verdict and canonical search（[.vibepro/pr/story-brainbase-portable-connected-world-onboarding/verification-runs/e2e.json](.vibepro/pr/story-brainbase-portable-connected-world-onboarding/verification-runs/e2e.json)）

## 詳細
- 証跡: [.vibepro/pr/story-brainbase-portable-connected-world-onboarding/](.vibepro/pr/story-brainbase-portable-connected-world-onboarding/)
- PR準備: [.vibepro/pr/story-brainbase-portable-connected-world-onboarding/pr-prepare.json](.vibepro/pr/story-brainbase-portable-connected-world-onboarding/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-brainbase-portable-connected-world-onboarding/decision-index.summary.json](.vibepro/pr/story-brainbase-portable-connected-world-onboarding/decision-index.summary.json)（bounded summary / 全文: [.vibepro/pr/story-brainbase-portable-connected-world-onboarding/decision-index.json](.vibepro/pr/story-brainbase-portable-connected-world-onboarding/decision-index.json)）
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.2.0-beta.2 37418424323e detached/package dirty (story=story-brainbase-portable-connected-world-onboarding)
