# Story: 新規プロジェクト作成をテナント規模に依存させない

## 利用者価値

組織管理者として、テナント内に既存プロジェクトが増えても、管理画面から新しいプロジェクトを待たされずに作成したい。

## 原因

新しいproject subjectを作る経路が、利用者の参照可能な全projectをGraph snapshotへ含めていた。このsnapshot適用が全projectのedgeをロックし、同時リクエストを待たせていた。

## 受け入れ条件

- `PRJSCOPE-AC-001`: 新しいproject subjectでは対象projectだけをsnapshotへ含める。
- `PRJSCOPE-AC-002`: subject再利用時は、事前検証で承認したsource projectだけを追加する。
- `PRJSCOPE-AC-003`: 冪等実行、rollback、receipt、validateの既存契約を維持する。
- `PRJSCOPE-AC-004`: 本番管理画面のproject作成が60秒以内に完了する。

## 対象外

- project subject再利用ルール自体の変更
- task CRUDの契約変更
- Graph schemaの変更
