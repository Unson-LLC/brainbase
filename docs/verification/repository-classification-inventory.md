# リポジトリ分類の現物確認（2026-09-20）

## 確認済み

| 対象 | 現物 | 判定 |
| --- | --- | --- |
| `brainbase-organization` | `apps/web`、`packages/organization-client`、組織版境界ADR、境界チェックスクリプト | 組織に依存しない組織版の配布repoとして整合 |
| `brainbase-unson` | Brainbase本体、Skills、Commands、Unson固有の運用・設定 | Unsonの共有動作と設定の所有repo |
| `growin-project` | 顧客文書と `deliverables/growin-brainbase-local/` | 顧客設定・受入証跡の所有先。ただしローカルGraph/MCP実装の複製を含むため、そのまま最終配布物にはしない |
| `brainbase-unson/examples/codex/README.md` | `_codex` を本番正本として作成する旧手順 | 現行方針と矛盾。移行用サンプルへ修正 |
| `settings/nocodb/`、`common/frameworks/` | 現行 `origin/develop` に存在しない | 旧移設一覧から除外。復活は自動チェックで防止 |

## Growin提供前の残作業

1. `growin-project/deliverables/growin-brainbase-local/` から顧客固有の設定・seed・受入資料を特定する。
2. 汎用のローカルGraph server、MCP proxy、共通スクリプトは `brainbase-organization` の正式版へ置換できるか照合する。
3. 置換後にGrowinのOAuth、Calendar/Meet/Docs/Gmail draft、43分時点、会議完了後の一連動作を顧客アカウントで受入確認する。
4. 受入証跡を `growin-project` に残してから、重複実装を退役する。

## 未確認

- Growin端末での現行組織版の配備版・commit
- `deliverables/growin-brainbase-local/` の各ファイルが現在も実行経路にあるか
- Growin Workspace管理者が承認したOAuth scopeと接続結果

未確認項目は、ファイルが存在することやローカルテストの成功で完了扱いにしない。
