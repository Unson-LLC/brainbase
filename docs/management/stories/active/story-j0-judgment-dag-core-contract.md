---
story_id: story-j0-judgment-dag-core-contract
title: J0 typed DAG contract and preflight validation
status: active
category: architecture
spec: docs/specs/j0-judgment-dag-core-contract.md
architecture: docs/architecture/judgment-dag-core.md
created_at: 2026-08-20
updated_at: 2026-08-21
---

# J0 typed DAG contract and preflight validation

## Intent

Brainbase OSSを利用する実装者として、五層Judgment DAGの公開型、機械可読契約、決定的な事前検証を同じversionとsource-lockから利用したい。これにより、組織固有runtimeをOSSへ混ぜずに、後続runnerとconsumerを同じ意味モデルへ固定できる。

## 受け入れ基準

- [x] AC-1: node、edge、DAG、node type/layer compatibility、scope、runner、input/output contractをreadonlyな公開型とstrict schemaで固定する。
- [x] AC-2: 正常な五層fixtureを検証し、node ID昇順をtie-breakとする決定的なtopological orderを返す。
- [x] AC-3: missing dependencyをrunnerへ渡す前に`missing_dependency`として拒否する。
- [x] AC-4: reverse-layer dependencyを実行前に`reverse_layer_dependency`として拒否する。
- [x] AC-5: 同一layer内を含むcycleを実行前に`cycle`として拒否する。

## 境界

- package rootのMCP起動面と15 tool contractは変更しない。
- 組織固有tenant、authority、approval、hosted runtimeをOSS必須契約へ入れない。
- runner実行、artifact store、execution log、replay、evaluation mutation、Execution/Evaluation mutation protectionはJ0-2の後続範囲とする。
- production deploy、schema migration、customer data、credential、secretを扱わない。

## 完了証拠

公開schema/fixture/source-lock/digest、対象unit、公開契約test、npm consumer smoke、既存Host/MCP/CLI回帰、full test、build、typecheck、独立reviewを同一HEADへ結び付ける。PR作成とmergeはVibePro証跡がcurrent HEADで成立した後に別判断する。
