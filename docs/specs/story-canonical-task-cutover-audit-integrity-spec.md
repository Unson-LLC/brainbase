# Spec: Canonical Task切替の監査完全性

## readiness操作

- CLIはenable/disableの双方で`--actor <stable-id>`と`--change-ref <ticket-or-run-id>`を必須とする。
- readiness singleton更新後、commit前に`canonical_task_readiness_audit`へ1行追加する。
- 監査行はappend-onlyとし、更新・削除経路を提供しない。
- DB insertが失敗した場合はreadiness更新もrollbackする。
- 戻り値へ`audit_id`を含め、実行直後のreadback対象を特定できるようにする。

## 全証跡収集

- `--all`ごとに64桁hexのrun IDを1つ生成する。
- 既存run IDの再利用は拒否し、保存済みrunを上書きしない。
- 各collectorが返したartifactを直後に`runs/<run-id>/raw/<evidence-id>.json`へatomic保存する。
- aggregateはregistryの共有artifact pathではなく、同一runのsnapshotを再読込してhashを確定する。
- aggregate自体も`runs/<run-id>/evidence-all-<head>.json`へ保存し、`run_id`を含める。
- 従来の単一ID artifact、runner、stdout pathは変えない。

## 検証

- readiness引数不足、enable/disableの監査insert、監査insert失敗時rollbackをテストする。
- snapshot作成後に共有artifactを上書きし、aggregateが同一run snapshotから成功することをテストする。
- schema migration checkが監査tableと必須columnを検査することをテストする。
