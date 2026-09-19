# 旧Brainbase UIメモリ最適化手順の退役

**ステータス: Retired**

旧UIがtmuxとMCPプロセスを管理していた時代の手順は[ADR-019](../architecture/ADR-019-codex-owns-development-runtime.md)により廃止しました。過去の調査本文はGit履歴で参照できます。

- プロセス数やdetached期間だけで不要と判断しない。
- 開発session・プロセスの終了は所有者であるCodexで行う。
- 手動調査ではowner、PID、cwd、起動元と稼働状態を確認する。名前一致によるMCPやtmuxの一括killは禁止。
- 旧cleanupとcron wrapperは副作用なしで非zero終了する。新規scheduler登録はしない。
- 既存schedulerの退役は登録先・所有者・影響を確認して個別に行う。全環境で登録がないとは保証しない。

旧cleanupによる自動終了やログ削除は行いません。履歴データも削除しません。
