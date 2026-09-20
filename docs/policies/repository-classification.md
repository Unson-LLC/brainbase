# Brainbase リポジトリ分類方針

## 目的

Brainbaseを社内と顧客へ安全に配布するため、動作・設定・事実・文書・素材の正本を所有者ごとに分ける。コピー先の都合ではなく、誰が変更を承認し、どこから配布するかで配置を決める。

この文書は配置原則の正本とする。個々の現物については [`docs/contracts/repository-ownership.json`](../contracts/repository-ownership.json) に、現所在地、最終所有repo、製品スコープ、移管条件を記録する。repo名に `unson` が含まれることだけで、そこにある全コードをUnson固有とは判定しない。

## 判定表

| 対象 | 正本 | 例 |
| --- | --- | --- |
| 公開Brainbaseの共通能力 | `brainbase` | Graph、判断、Canonical Task、公開MCP/CLIとデータ契約 |
| 全組織で再利用する組織版のWeb/BFF/client | `brainbase-organization` | 接続設定UI、OAuth開始、組織権限、`organization-client` |
| Unson固有のBrainbase運用・配備設定 | `brainbase-unson` | Skills、Commands、hooks、秘密情報注入、Unson環境の配備と運用手順 |
| 顧客固有の設定・導入・受入資料 | 顧客管理repo | Growinの場合は `growin-project` の設定、seed、受入記録 |
| 人・組織・顧客・プロジェクト・意思決定の事実 | Brainbase Graph | 関係、RACI、現在の決定、識別子 |
| レビュー済みの設計・方針・運用文書 | その動作を所有するrepoの `docs/` | ADR、policy、runbook、Story、Spec |
| 原本資料・録音・大容量素材 | Google Drive | 会議資料、録音、顧客提供素材 |
| 個人のメモ・個人設定・一時作業 | 個人ホーム | 個人KG、端末固有設定、下書き |
| 実行時データ | 所有サービスのDBまたはCredential Store | token、セッション、処理状態 |

## 配布境界

### `brainbase-organization`

会社に依存しない組織版の製品境界を所有する。Growinを含む顧客向けUI/API/clientはここから配布し、顧客名、顧客ドメイン、顧客秘密情報を実装へ埋め込まない。

ここでいうAPIは、組織権限、接続管理、画面用BFFなど組織製品の境界を指す。Graph、判断、Canonical Taskなど公開Brainbaseの共通能力を別正本として再実装しない。

### `brainbase-unson`

Unsonで共有する運用、Unson固有の設定・配備を所有する。現在このrepoに残る公開Brainbase共通能力や組織製品コードは、所有台帳で `migration_pending` として扱い、現所在地を正しい最終所有先と誤認しない。組織版の汎用実装をここだけに置いて顧客へコピーしない。顧客へ渡す成果物は `brainbase-organization` の版と顧客repoの設定を組み合わせる。

### 顧客管理repo

顧客固有の設定、導入判断、seed、受入証跡を所有する。Growinでは `growin-project` を使う。汎用Web/API、OAuth token交換、ローカルGraph serverなどの製品実装を複製しない。

## 禁止する正本

- Wiki、`shared/`、`_codex/`、submodule共有を正本として復活させない。
- 個人の絶対パス、個人端末のtoken、個人文脈を配布repoやチームGraphへ入れない。
- 顧客repoに組織版の汎用実装をコピーして派生版を作らない。
- `brainbase-unson` の設定を顧客既定値として扱わない。
- 現物が残っていることを根拠に、そのrepoを最終所有先とみなさない。

## UIと機能互換性

現行の公開BrainbaseはMCP・CLIを入口とし、組織版が継承する共通Web UIを提供していない。したがって、存在しないOSS UIとの継承構造を作らない。組織版Webの正本は `brainbase-organization` とし、公開Brainbaseとの互換性は機能、データ、権限、保存後readbackの契約で確認する。

将来、公開Brainbaseが正式なWeb UIを提供し、同じ画面実装を複数製品で共有する必要が確認できた場合だけ、ADRを経て共通packageへ切り出す。`partial` のような曖昧な互換状態は使わず、能力を分解して、提供済み、意図的に別系統、未提供を区別する。

## 移設の進め方

1. 現物の所有者、利用者、配布経路を確認する。
2. 移設先に正本を作り、参照元を切り替える。
3. テストまたはreadbackで新しい参照を確認する。
4. 旧配置を削除する。未確認の旧配置は「ないもの」にせず、移設候補として残す。

移管完了とは、最終所有repoに実装と契約テストがあり、利用側の参照切替とreadbackが通り、旧配置が削除された状態をいう。台帳だけ更新して完了にしない。

顧客提供は、汎用実装、顧客設定、認証・秘密情報、配備、受入結果を別々に確認してから完了とする。
