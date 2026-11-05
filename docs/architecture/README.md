# ADR 一覧

[共通の書き方・配置・採番の規約](https://github.com/Unson-LLC/brainbase-project/blob/7e6c2d23bce654eb744ebb82d9ce2c31c48c5407/docs/architecture/adr-authoring.md)を参照する。
2026-11-03 に採用決定済み。共通規約 PR #140 は未マージのため、固定コミットを参照する。

この一覧の管理番号はリポジトリ内で一意。旧ファイルの名前・見出しの番号と異なる場合は、リンクと管理番号を合わせて参照する。旧名・旧置き場所は初期登録分だけを凍結し、新規の例外は増やさない。

検査: `node scripts/check-adr-index.mjs`（一覧漏れ・重複・壊れたリンク・新規ADRの配置とファイル名）。
新規ADRは `docs/architecture/ADR-NNN-short-title.md` に置く。採番前に一覧と作業中のPRを確認し、予約中の番号も避ける。欠番を再利用しない。廃止・予約した番号は検査器の `retiredNumbers` に追記して残す（初期登録以前は `baselineMax` でも保護）。履歴からの自動推定は行わない。

<!-- adr-index:start -->
| 管理番号 | 文書 | 旧名・旧配置 |
|---|---|---|
| ADR-001 | [ADR: Local SSOT writes use a recoverable aggregate commit](ADR-story-brainbase-local-ssot-atomic-commit.md) | 旧名（未採番） |
| ADR-002 | [ADR: npm publication is bound to reviewed default-branch history](ADR-story-brainbase-oss-npm-release.md) | 旧名（未採番） |
| ADR-003 | [ADR: OSS / Organization UI ownership](oss-organization-ui-ownership.md) | 旧名（未採番） |
| ADR-004 | [ADR: Company OS decision adapter](story-company-os-decision-adapter-v1.md) | 旧名（未採番） |
<!-- adr-index:end -->
