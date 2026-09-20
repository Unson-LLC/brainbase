---
story_id: story-canonical-task-postgres-contract-fixtures
title: Canonical Task PostgreSQL契約fixtureを現行schemaへ追随させる
status: done
date: 2026-09-20
related_stories:
  - docs/stories/story-canonical-task-postgres-ssot.md
related_specs:
  - docs/specs/story-canonical-task-postgres-contract-fixtures-spec.md
---

# Canonical Task PostgreSQL契約fixtureを現行schemaへ追随させる

## Who / Problem / Outcome

- **Who**: Canonical Task PostgreSQL移行の契約テストを保守する開発者。
- **Problem**: 本番コードが要求する`project_codes`列と現行5本のindex契約をfixtureが返さず、schema preflightで停止していた。そのため、provider failure、conflict、persistence failureの各テストが本来の失敗分岐まで到達しなかった。
- **Outcome**: fixtureが現行schema契約を正確に表現し、production codeとassertionを緩めずに各シナリオの分岐を検証できる。

## Scope

対象は`tests/e2e/story-canonical-task-postgres-ssot-contract.spec.ts`のDB mock fixtureと、このStory/Specだけとする。
production code、公開契約、migration assertion、実DB schema、backend切替、本番反映は変更しない。

## Acceptance Criteria

- **AC-1**: fixtureが現行の必須列`project_codes`を含む。
- **AC-2**: fixtureが現行の5本のindex名を`indisvalid=true`かつ`indisready=true`で返す。
- **AC-3**: S-003、provider failure、S-006、persistence failureがschema preflightを通過し、本来の分岐を検証する。
- **AC-4**: 対象契約テストが11/11 passする。

## Evidence / Remaining Unknowns

ローカルの対象PlaywrightテストでAC-1〜AC-4を確認する。`VIBEPRO_EVIDENCE_ID=dummy`はwebServerを起動せずfixture契約だけを実行するため、CI・live PostgreSQL・本番migrationの証拠ではない。
