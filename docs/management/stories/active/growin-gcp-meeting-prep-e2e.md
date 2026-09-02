# Story: Growin会議準備をGCP版Brainbaseで実証する

## 利用者価値

Growinの利用者として、Claude CodeからGrowin専用Brainbaseへ接続し、会議前に過去の決定・関係者・未解決事項を短時間で確認したい。これにより、資料を横断して探す時間と確認漏れを減らせる。

## 受入条件

- AC-001: GrowinのGoogle Workspace利用者として認証され、許可されていない利用者は拒否される。
- AC-002: Claude CodeのMCPから、GCP上のGrowin専用Graphへ接続できる。
- AC-003: 初期登録済みの決定・関係者・未解決事項を会議準備用の問い合わせで取得できる。
- AC-004: Growinの応答へ雲孫環境のデータが混入しない。
- AC-005: 接続者、対象テナント、操作結果を監査できる。
- AC-006: 検証済みの接続・運用手順をBacklog Gitの資料リポジトリへ共有できる。

## 最小検証シナリオ

「次回のGrowin定例に向けて、これまでの決定、関係者、未解決事項を教えて」とClaude Codeから質問し、Growin専用データだけを根拠付きで取得する。

## 対象外

- Google Driveや会議録の自動取り込み
- Growin全社員への本番展開
- UIの新規開発
