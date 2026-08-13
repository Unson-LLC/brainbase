---
spec_id: spec-brainbase-personal-organization-memory
status: accepted
story: story-brainbase-personal-organization-memory
architecture: docs/architecture/adr-personal-organization-memory-boundary.md
---

# Brainbase個人・組織記憶境界仕様

## 公開API

- `POST /api/personal-knowledge/events`
- `GET /api/personal-knowledge/search`
- `GET /api/personal-knowledge/cycles/:eventId`
- `POST /api/personal-knowledge/events/:eventId/promotion-requests`
- `POST /api/personal-knowledge/promotions/:requestId/decision`

全APIは認証必須とする。個人主体と組織は`req.access`から確定し、本文・queryの`owner_person_id`、`organization_id`による上書きを拒否する。本人を確定できない場合はfail-closedにする。service/internal actorは代理person、organization、理由を明示し、監査記録に成功しなければ処理しない。

## Personal Vault

`personal_knowledge_events`はevent ID、owner、organization、発生・取得時刻、出典、正本ポインタ、本文hash、任意の本人向け本文、親Episode、権限snapshotを持つ不変包絡である。処理段階、意味状態、訂正、利用結果は`personal_knowledge_event_transitions`へ追記する。

同じevent IDの再送は、不変identityが一致する場合だけ冪等成功にする。異なる場合は競合とする。個人検索は認証されたownerとorganizationのRLS内だけで行う。

## 個人から組織への昇格

1. 所有する個人イベントから共有候補を作る。
2. secret、credential、個人情報、個人絶対パス、原文引用を除去する。
3. 洗浄済みpreview、共有project、subjectを本人へ提示する。
4. 本人承認後、request identityから決定的な`knowledge_event.v1` IDを生成する。
5. 通常の組織イベント取込み、権限、競合、機密判定へ渡す。
6. `knowledge_promotion_lineage`へpersonal event、request、organization eventの関係と洗浄情報を追記する。

却下または未回答では組織イベントを発行しない。同じrequestの並行承認、再送、再起動で組織イベントを重複させない。訂正は元eventを更新せず、新eventとsupersede transitionを追加する。

## PostgreSQL認可

transaction開始後、次を`SET LOCAL`する。

- `app.person_id`
- `app.organization_id`
- `app.project_codes`
- `app.role`
- `app.clearance`

Personal Vault、個人transition、promotion request、lineage、Candidate StoreにはownerとorganizationのRLSを適用する。組織イベント、組織transition、組織Episode artifactにはorganization、project、role、clearanceのRLSを適用する。すべて`ENABLE ROW LEVEL SECURITY`と`FORCE ROW LEVEL SECURITY`を有効にする。コンテキスト欠落は空結果へ縮退せず認可エラーにする。

## ルーティン

- `/ohayo`: 本人のPersonal Vaultと閲覧可能なGraphを想起し、公開結果は最大3件にする。実際に選択され、正式な`pke_*`または`kev_*`へ解決できたIDだけに利用結果を記録する。
- `/oyasumi`: 個人と組織を別々に照合、圧縮、検索可能性確認する。個人原文を組織artifactへ含めない。
- `/retro`: 権限境界内の集計値だけを使用する。

`BRAINBASE_EXPECTED_GIT_SHA`が実行checkoutのSHAと異なる場合、Routine livenessは`runtime_git_sha_mismatch`を最上位例外として返す。

## 移行と完了条件

正式migrationは既存行を削除しない。不明なowner、organization、projectは隔離する。`BRAINBASE_PERSONAL_VAULT_READ_ENABLED=0`で`/ohayo`の個人想起だけを互換投影へ戻せる。

コード上の完了に加え、実環境で次を確認するまで移行完了としない。

1. 2人のPersonal VaultをAPIと直接SQLの両方で相互隔離できる。
2. 個人承認前は組織イベントがなく、承認後はEvent、Graph、検索、訂正、Receiptが一巡する。
3. 31013の実行Git SHAと期待SHAが一致する。
4. 3ルーティンが7回連続でRun Receiptと必須成果物を残す。
5. 新経路を2週間観測し、通常イベントの95%が10分以内に検索可能になる。
