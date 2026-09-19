# テナント境界付き用語登録仕様

## 入力境界

- actorはrequest bodyから受け取らず、認証後の `access.personId` を正本とする。
- `BRAINBASE_EXPECTED_ORGANIZATION_ID` が設定されたMCPをテナント固定とみなす。
- テナント固定MCPでは `BRAINBASE_EXPECTED_PROJECT_CODES` の各codeがJWT `projectCodes` に含まれ、JWT `exp` が現在時刻より後でなければならない。

## 保存と確認

用語登録は一つのDBトランザクションで次を行う。

1. actorとprojectのGraph正本を解決する。
2. event、glossary_term、belongs_to_project edgeを書き込む。
3. 3件をIDで再取得し、actor、種別、project、関係が一致することを確認する。
4. 一致時だけcommitし、`readback_verified: true` を返す。不一致はrollbackする。

## テスト

- unit: actor伝播、actor欠落、readback結果、tenant/project/expiryの不一致。
- PostgreSQL integration: NOT NULL/FKを含む実schema上で登録し、event/entity/edgeを別queryで再取得する。
