---
story_id: story-j0-judgment-dag-core-contract
title: J0 typed DAG contract and preflight validation
status: active
category: architecture
spec: docs/specs/j0-judgment-dag-core-contract.md
architecture: docs/architecture/judgment-dag-core.md
canonical_story_path: docs/management/stories/active/story-j0-judgment-dag-core-contract.md
created_at: 2026-08-20
updated_at: 2026-08-21
---

# J0 typed DAG contract and preflight validation

## Intent

Brainbase OSSを利用する実装者として、五層Judgment DAGの公開型、機械可読契約、決定的な事前検証を同じversionとsource-lockから利用したい。これにより、組織固有runtimeをOSSへ混ぜずに、後続runnerとconsumerを同じ意味モデルへ固定できる。

## 受け入れ基準

- [x] AC-1: node、edge、DAG、node type/layer compatibility、scope、runner、input/output contractをreadonlyな公開型とstrict schemaで固定する（`src/judgment-dag-core.ts`, `src/judgment-dag.ts`, `contracts/judgment-dag/schema.json`）。
- [x] AC-2: 正常な五層fixtureを検証し、node ID昇順をtie-breakとする決定的なtopological orderを返す（`tests/judgment-dag-core.test.ts`）。
- [x] AC-3: dependency integrityを実行前に検証し、missing dependency、reverse-layer dependency、cycle、重複、node type/layer不一致、およびnode `depends_on`と`relation=depends_on` edgeの完全ミラー不一致をmachine-readable errorで拒否する。`depends_on` edgeはduplicate declarationではなく、node dependencyの必須かつ完全なmirrorである（`src/judgment-dag-core.ts`, `tests/judgment-dag-core.test.ts`）。
- [x] AC-4: dependencyの両nodeの`scope.type`と`scope.id`が完全一致しない場合は`scope_boundary_violation`でfail-closedする。cross-scope promotion/authority evidenceは後続非目標であり、structural validは実行権限の証拠にならない（`src/judgment-dag-core.ts`, `docs/architecture/judgment-dag-core.md`, `tests/judgment-dag-core.test.ts`）。
- [x] AC-5: authority、provenance、evaluation metadataを再帰的にJSON互換として検証し、不正なネスト値を実行前に拒否する（`src/judgment-dag-core.ts`, `tests/judgment-dag-core.test.ts`）。
- [x] AC-6: validationは入力を変更せず、immutable fixtureと同値な並べ替えfixtureに対して安定した結果を返す。topological orderのtie-breakはnode ID昇順とする（`tests/judgment-dag-core.test.ts`）。
- [x] AC-7: versioned machine artifacts（schema、fixture、source-lock、digest）とruntimeの非空文字列受理集合を一致させ、同一candidate群をAjv/runtimeへ通し、side-effect-free `./judgment-dag` consumer importを検証する（`contracts/judgment-dag/*`, `tests/judgment-dag-public-contract.test.ts`, `tests/npm-consumer-smoke.integration.test.ts`）。

## 境界

- package rootのMCP起動面と15 tool contractは変更しない。
- 組織固有tenant、authority、approval、hosted runtimeをOSS必須契約へ入れない。
- runner実行、artifact store、execution log、replay、evaluation mutation、Execution/Evaluation mutation protectionはJ0-2の後続範囲とする。
- production deploy、schema migration、customer data、credential、secretを扱わない。

## 完了証拠

公開schema/fixture/source-lock/digest、対象unit、公開契約test、npm consumer smoke、既存Host/MCP/CLI回帰、full test、build、typecheck、独立reviewを同一HEADへ結び付ける。PR作成とmergeはVibePro証跡がcurrent HEADで成立した後に別判断する。
