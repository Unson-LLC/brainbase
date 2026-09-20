---
story_id: str.brainbase.legacy-sns-cluster-removal
title: 退役SNS実装クラスタを安全に除去する
status: active
created_at: 2026-09-20
---

# 退役SNS実装クラスタを安全に除去する

## 利用者の意図

保守者として、運用入口の退役後も残っている旧SNS実装を、現役の個人知識・認証・台帳処理と混同せずに除去したい。実行コードから到達できないことを確認した範囲だけを削除し、共有アカウント境界と保存データは維持する。

## 受け入れ条件

- 実行コードから参照されていない旧 `FeedbackService`、`PostingService`、`SchedulerService`、`x-provider` と、それらだけを検証する専用テスト/helperを除去する。
- `AccountService`、`InMemoryAccountRepository`、`PgAccountRepository`、`ProviderRegistry` の実装と共有契約テストを保持する。
- `sns-readonly-curator`、personal KG reader/identity、candidate-store、meeting、ledger、SQL、保存データを変更しない。
- `sns-metrics-poller` と `x-client` の読み取り境界を保持し、curatorの現行契約テストを保持する。
- 除去後の参照検索、保持対象テスト、退役境界テストで、削除範囲と残存範囲を分けて確認できる。
- Graphifyの鮮度・影響が不明な場合は、不明のまま報告し、本番不在や本番停止を推測しない。

## スコープ外

- 本番ジョブの停止、デプロイ、SQLや保存データの削除。
- 現役の共有AccountService/PgAccountRepositoryまたはcuratorの再設計。

## 関連仕様

- [限定除去Spec](../../specs/legacy-sns-cluster-removal.md)
- [SNS廃止仕様](../../specs/retire-sns-spec.md)
