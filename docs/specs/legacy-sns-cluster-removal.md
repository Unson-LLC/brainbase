---
spec_id: SPEC-legacy-sns-cluster-removal
title: 退役SNS実装クラスタの限定除去
status: implemented
date: 2026-09-20
story_id: str.brainbase.legacy-sns-cluster-removal
related_specs: [SPEC-sns-retire, SPEC-legacy-sns-leaf-removal]
---

# 退役SNS実装クラスタの限定除去

## 目的

SNSの運用入口を退役させた後も、実行コードから到達できないM4実装と専用テストが残っていた。保守対象を現行の個人知識・候補・台帳処理に絞るため、参照不在を確認できた4モジュールだけを除去する。

## 除去対象

- `server/services/sns/feedback-service.js`
- `server/services/sns/posting-service.js`
- `server/services/sns/scheduler-service.js`
- `server/services/sns/providers/x-provider.js`
- 上記だけを検証する `tests/sns/feedback/`、`tests/sns/posting/`、`tests/sns/account-management/` の専用テスト
- 専用テストだけが使う `tests/sns/_m4-helpers.js`

`tests/sns/feedback/sns-metrics-poller.test.js`、`server/services/sns/sns-metrics-poller.js`、
`server/services/sns/providers/x-client.js` は、別の読み取り・台帳境界を持つため保持する。

## 保持する境界

- `server/services/sns/sns-readonly-curator.js`
- `server/services/sns/personal-knowledge-graph-reader.js`
- personal KG identity、candidate-store、meeting、ledger、SQL、保存データ

`sns-readonly-curator.js` は personal-KG SNS seed / Persona Brain / candidate-store の現行仕様と専用テストに参照される。退役仕様の「個人知識の読取り・人物同定・会議学習を残す」境界にも該当するため、今回の参照不在判定には含めず、削除しない。

## 参照調査

変更前に `server`、`scripts`、`tests`、`package.json`、`.github` の実行コードを検索した。4モジュールは実行コードからのimportがなく、参照は専用テスト（およびその共有helper）と履歴文書に限られていた。curatorは上記の現行仕様・テスト・reader契約に結び付くため別扱いとした。

Graphify lightweight lookup は変更前に実行した。5候補は全てmatchしたが、`freshness=unknown`、`impact=unknown`、`status=partial`、`truncated=true` だったため、参照検索とテスト結果を補助する情報としてのみ扱い、実行不在や本番不在の証拠にはしない。

## 受け入れ条件

1. 除去対象4モジュールと専用テスト以外のSNS共通処理・台帳・データを変更しない。
2. 除去後に対象4モジュールと `_m4-helpers.js` の実行コード参照が残らない。
3. curator、personal KG reader、metrics poller、X client、退役境界テストを保持する。
4. 変更前の対象専用テストが通過し、変更後は保持対象テストと退役境界テストが通過する。
5. Graphifyを変更後に再実行し、鮮度・影響が不明な場合は不明のまま報告する。
6. 本番ジョブ停止、SQL/DATA削除、deployはこの変更の対象外とする。

## 検証

| 段階 | 結果 |
| --- | --- |
| 変更前のSNS feedback / posting / account-management / curator | 51 files / 96 tests passed |
| 変更後のSNS・共有アカウント・provider契約・退役境界テスト | 73 files / 271 tests passed（Node.js 22.23.2、`--maxWorkers=1`） |
| 変更後の専用参照検索 | 実行コードから4モジュールとhelperへの参照なし（履歴文書は除外しない）。共有 `AccountService` / `PgAccountRepository` / `ProviderRegistry` の実装・契約テストは保持 |
| 変更後のGraphify lightweight lookup | 4除去対象は `unmatched_files`、保持対象の `x-client` / `sns-metrics-poller` / `sns-readonly-curator` はmatch。`freshness=unknown`、`impact=unknown`、`status=partial`、`truncated=true`、`invalid_edges=false` |
| 本番配備・予約ジョブ停止・保存データ | 未確認・対象外 |

独立レビュー、CI、通常PR経路での統合は親タスクで実施する。
