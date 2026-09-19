# 退役した操作面の残存実装を整理し切る

Story ID: `legacy-surface-completion`

利用者として、Brainbaseの現役の責任と退役実装を混同せず、不要な旧操作面を保守する負担をなくしたい。

## 判断

開発モードは **SIMPLIFICATION**。直近の `retired-browser-cleanup` と `brainbase-boundary-cleanup` は部分削除を達成したが、旧入口にしか属さない実装が残った。新しい仕組みを足さず、残存の到達性を確認して削除する。

仮説は「旧入口の削除後に、その配下と専用テストが残った」。対立仮説は「現役の認証、Core、CLI、外部利用者が共通部品を必要としている」。本番入口、import、動的ロード、設定、スクリプト、テストの利用者を照合して選別する。ファイル名が古いことだけでは削除しない。

## 受入条件

1. `public/` の全資材を調べ、現役、退役して削除、移行が必要、未確認を区別する。任意のファイル数で調査を打ち切らない。
2. 現役から到達しない旧ブラウザ実装と専用テスト・起動設定を削除する。共通部品に現役利用があれば維持するか適切な所有先へ移す。
3. `/device` の認証、Graph、MCP、Run Receiptと旧APIの410を維持し、影響するテストで確かめる。
4. 旧session state/runtimeの残存設定・文書も照合し、未処理項目には根拠と必要な処理を明記する。過去データや別ドメインの現役stateは変更しない。
5. 独立レビュー、CI、通常のPR統合まで進める。ソースの整理と本番反映は別々に報告する。

正本: [ADR-019](../architecture/ADR-019-codex-owns-development-runtime.md)
仕様: [legacy-surface-completion-spec.md](../specs/legacy-surface-completion-spec.md)

本番デプロイ、共有データの削除、外部runtimeの変更は承認範囲に含めない。これらを理由にローカルの安全な調査・削除を打ち切らない。
