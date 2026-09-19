# マージ済み変更の反映確認

ソースのマージと稼働環境への反映は別です。PRがマージされたという報告だけでdeployや再起動を始めません。

1. 対象PRのMERGED状態とmerge SHAを確認する。
2. `brainbase-capability-map` を使い、`runtime.launchd` と `docs/brainbase-capabilities/runbooks/verify-31013-source.md` に従って現在の起動元・SHA・dirty状態を読み取る。
3. 稼働SHAと意図した対象を比較する。自動updaterやpinの設定を確認し、未反映を成功扱いしない。個人checkoutのswitch/resetで反映しない。
4. 即時反映が依頼・承認されている場合だけ、現在の `docs/brainbase-capabilities/runbooks/restart-31013-launchd.md` に従う。既存作業・外部影響・起動設定が不明なら先に確認する。
5. 反映後はAPIのSHA・cwd・clean状態とMCP reconciliation receiptを照合する。タイムアウトや不一致は未確認として報告する。

旧ブラウザUI、旧session API、tmuxセッション数、トップページのHTMLだけを反映判定に使いません。開発runtime所有権は `docs/architecture/ADR-019-codex-owns-development-runtime.md` を参照します。
