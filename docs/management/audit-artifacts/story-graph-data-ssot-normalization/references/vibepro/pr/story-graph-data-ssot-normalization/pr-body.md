## 判断
- このPRで判断すること: Graphデータ正本の重複・欠落を可逆的に正規化する を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-graph-data-ssot-normalization - Graphデータ正本の重複・欠落を可逆的に正規化する
- 正本: [docs/management/stories/story-graph-data-ssot-normalization.md](docs/management/stories/story-graph-data-ssot-normalization.md)
- 変更範囲: 12 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/story-graph-data-ssot-normalization.md](docs/management/stories/story-graph-data-ssot-normalization.md)
- 実装: mcp/brainbase/src/sources/graphapi-source.ts, scripts/normalize-graph-data-ssot.mjs, scripts/seed-sato-personal-records.js, ...and 2 more
- テスト: mcp/brainbase/tests/sources/graphapi-source.test.ts, [tests/e2e/story-graph-data-ssot-normalization-contract.spec.ts](tests/e2e/story-graph-data-ssot-normalization-contract.spec.ts), [tests/server/controllers/info-ssot-controller.test.js](tests/server/controllers/info-ssot-controller.test.js), ...and 2 more

## 経緯
- 要求: Graphデータ正本の重複・欠落を可逆的に正規化する
- 発生経緯: ライブGraphでは、BAAOと雲孫の組織レコードがcanonical IDと旧IDで物理的に併存し、BAAO projectの表示名が空、BAAO固有のcore Philosophyが未設定になっている。佐藤圭吾のpersonも旧IDとcanonical IDが併存し、認可・RACI参照が分散している。 加えて、CI `graph.decision.vibepro_metrics_ssot` が要求するdecision `dec_vibepro_ai_self_evaluation_metrics_japanese_ssot` がREST/MCPから取得できない。直接DB監査では2026-04-25作成の同一ID・正本payloadが残っていたが、`role_min=gm`のため現在のCI tokenとMCPから不可視だった。監査/event/historyテーブルに意図的廃止を示す証跡はなく、2026-04-26の出荷証跡、Graph SSOT assessment、現行spec、現行CI契約はいずれも同IDを正本として参照している。そのためpayloadは上書きせず、正本の可視性driftだけを修復する。将来レコード自体が欠落した場合のみ、過去証跡とlive frame・用語レコードを突き合わせて同一IDで復元する。


## 原因
- 最新診断gateが needs_review

## 解決
- 1. canonical orgへ非秘密の最新属性を統合する。 2. 旧org IDは物理削除せず、`canonical_entity_id`を持つretired aliasへ変更する。 3. business edgeとpayload参照はcanonical IDへ付け替え、旧orgからcanonical orgへの`alias_of` edgeを残す。 4. 雲孫のfinance情報は一般org payloadから分離し、`ceo`かつ`finance` clearanceでのみ読めるレコードに保持する。 5. BAAO projectのGraph payloadへ表示名`BAAO`を設定する。 6. BAAOの既存mission/valueを根拠に固有のcore Philosophyを登録する。Operation Handbook v3の正式採用decisionは作らない。 7. legacy personは物理削除せずmerged状態にし、認可・RACIの現行参照だけcanonical personへ移す。監査ログは履歴のIDを保持する。 8. VibePro decisionが存在する場合はpayloadを保持し、CI/MCP契約に必要な`member`可視性だけを修復する。欠落時のみ、過去証跡、live frame、live glossary terms、現行CI契約に一致する最小payloadで同一ID復元する。

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 11 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- ADRなしで既存設計の範囲に収まっているか
- 主要ソース差分: mcp/brainbase/src/sources/graphapi-source.ts, scripts/normalize-graph-data-ssot.mjs, scripts/seed-sato-personal-records.js, server/controllers/info-ssot-controller.js, ...
- ...and 1 more
- Risk: 最新診断gateが needs_review

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: not_applicable / evidence: [.vibepro/evidence/story-graph-data-ssot-normalization/typecheck-current-head.json](.vibepro/evidence/story-graph-data-ssot-normalization/typecheck-current-head.json)
- 最終E2E: pass: current-head in-process flow replay passed 51/51; production runtime proof remains postmerge closure; Playwright 1/1 remains separate artifact_replay only, not runtime-path proof（[.vibepro/evidence/story-graph-data-ssot-normalization/targeted-vitest-current-head.json](.vibepro/evidence/story-graph-data-ssot-normalization/targeted-vitest-current-head.json)）

## 詳細
- 証跡: [.vibepro/pr/story-graph-data-ssot-normalization/](.vibepro/pr/story-graph-data-ssot-normalization/)
- PR準備: [.vibepro/pr/story-graph-data-ssot-normalization/pr-prepare.json](.vibepro/pr/story-graph-data-ssot-normalization/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-graph-data-ssot-normalization/decision-index.json](.vibepro/pr/story-graph-data-ssot-normalization/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.1.0-beta.0 88dd9d39aee5 detached/package clean (story=story-graph-data-ssot-normalization)
