# ローカルAPIと退役済みUIを取り違えない

## 利用者成果

運用者がMac Companion、31013のローカルAPI、廃止済みブラウザUIを区別でき、タスク操作が未指定のローカルDBへ暗黙に向かわない。

## 受入条件

- Canonical Task運用スクリプトは接続先を明示必須とし、未指定なら通信前に失敗する。自動で本番書込みへ振り替えない。
- 引数、専用環境変数、従来の明示環境変数の優先順位をテストする。認証・タスクAPI・再試行用キーを維持する。
- 現役runtimeの文書は31013をローカルAPIと呼び、旧launchd識別子を製品UIと誤認させない。
- ルーティン、認証、learning/MCPの共有依存を残す理由と、Companionの接続設定の正本を説明する。
- 旧ブラウザUIを復活させず、DB・過去データ・別作業の設定を削除しない。

詳細: [Spec](../../specs/story-local-api-boundary-cleanup-spec.md)。開発runtimeの所有権は[ADR-019](../../architecture/ADR-019-codex-owns-development-runtime.md)を維持する。
