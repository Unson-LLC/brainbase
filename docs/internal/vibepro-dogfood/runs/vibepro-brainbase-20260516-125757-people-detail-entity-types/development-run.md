# VibePro Autonomous Development Run: People Detail Entity Types (info-ssot-service)

## Request

`未実装のものもVibeProで実装して` — 個人実績データ (speaking/media/role/product/publication/press) を GraphDB に昇格した後の info-ssot-service.js 拡張。

## Interpreted Goal

`graph_entities.entity_type IN ('speaking','media_appearance','role_assignment','product','publication','press_mention')` のレコードが、`InfoSSOTService` の `formatEntityLabel()` / `summarizeEntities()` / `buildHumanReport()` でユーザー可読な形に整形されること。

## Findings

- 既存実装は `decision/raci_assignment/person/project/glossary_term/kpi/initiative/ai_decision/ai_query` の9型のみ対応。デフォルトでは `payload.title || payload.name || id` の弱いフォールバック。
- 新型6種は `seed-sato-personal-records.js` で投入済み (project_id=`prj_sato_portfolio`, 計27エンティティ)。
- buildHumanReport の sections 配列が公開APIフォーマットなので、ここに新型セクションを追加する必要あり。

## Implementation

Changed files:
- `server/services/info-ssot-service.js`

変更内容:

| メソッド | 拡張内容 |
|---|---|
| `formatEntityLabel()` | speaking→session_title, media_appearance→program, role_assignment→`role@org`, product→name, publication→title, press_mention→`medium: content` |
| `summarizeEntities()` | 上記6型に `[Type]: ...` 形式のサマリ文字列を追加 |
| `buildHumanReport()` | sections 配列に Speaking/Media/Role Assignments/Products/Publications/Press の6セクション追加。各 items は payload の主要フィールドを抜粋。 |

## Verification

Smoke test（`server/services/info-ssot-service.js` を直接importして6型のサンプルを `formatEntityLabel` / `summarizeEntities` に通した）:

```
--- labels ---
speaking         => Story Driven
media_appearance => ホリエモン
role_assignment  => CEO@雲孫
product          => SalesTailor
publication      => 生成AI導入
press_mention    => 佐賀新聞: 広告

--- summary ---
Speaking: 2026-04-15 AI駆動開発 - 「Story Driven」
Media: YouTube / ホリエモン
Role: CEO@雲孫 (現職)
Product: SalesTailor [sold]
Publication: 『生成AI導入』 佐藤
Press: 2025-07 佐賀新聞 - 広告
```

全6型でラベルとサマリ整形が想定通り。

## VibePro Judgment

`partial_go`.

- 機能: ✅ formatEntityLabel / summarizeEntities / buildHumanReport の3メソッドに6型を追加し、スモークテスト通過。
- リスク: vitest による既存テストの非実行（このセッションでは未確認）。次に migrate-graphdb-to-wiki.js を拡張するときに同時に CI で回す。

## Residual Risks

- `tests/server/info-ssot-service.test.js` 等の既存ユニットテスト未実行。新型追加で既存パスを壊していないか未検証。
- buildHumanReport の output_schema を消費する API / UI 側の互換性は未検証（sections 配列が増えるだけなので破壊的ではないはず）。

## Next Actions

- Run 2: migrate-graphdb-to-wiki.js 拡張時に `npx vitest run tests/server/info-ssot-service.test.js` を回す。
- buildHumanReport を消費するコードを grep して下流影響を確認。
