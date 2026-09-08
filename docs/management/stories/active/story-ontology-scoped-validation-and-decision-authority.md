# Story: Ontology違反を正本境界に沿って解消する

## 利用者価値

Graph保守の検証結果が、対象プロジェクトで実際に有効な正本だけを評価し、修復が必要な実データ違反だけを残す。

## 現在の不具合

本番`brainbase`の構造検証は孤立0件だが、Ontology検証が16件を返す。内訳は、外部参照として投影した`app_brainbase`を所有関係の検証対象に含める1件、`lifecycle_status=retired`のDecisionを有効な判断として扱う5件、有効なDecisionにdecider edgeがない10件である。

## 受け入れ条件

- AC-001: metadata-onlyの外部参照Entityはendpoint型の証拠には使うが、対象projectのrequired relation検証対象にはしない。
- AC-002: `lifecycle_status=retired`のEntityはrequired relation検証対象にはしない。
- AC-003: 対象projectでactiveなEntityは従来どおりrequired relationを検証し、実際の欠損を隠さない。
- AC-004: 有効な10件のDecisionには、Graph正本の根拠に基づくperson decider edgeを付与する。
- AC-005: 修正後の本番`graph_validate(project_code=brainbase)`で、構造違反0件、Ontology違反0件、`valid=true`を同一読み戻しで確認する。
- AC-006: tenant/project境界、外部Entity payload非公開、既存のGraph Apply receipt契約を緩めない。
- AC-007: `graph_validate`はrequired relation検証に含めたactive local件数と、除外したretired・superseded local件数、external metadata件数を、Entity IDやpayloadを含まない集計として返す。`include_project_codes`で明示したprojectはlocal側の集計対象に含める。

## 対象外

- Ontology語彙やrequired relation規則そのものの弱体化
- 外部projectのpayload複製
- 無関係なGraph Entity/Edgeの整理
