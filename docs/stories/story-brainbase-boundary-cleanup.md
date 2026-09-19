# Brainbaseの正本と認証・応答境界を明確にする

Story ID: `brainbase-boundary-cleanup`

利用者として、旧実装への暗黙の切替や過大な機能説明なしに、Brainbaseの現在の結果と制約を判断したい。

## 受入条件

1. PortalのStory一覧はGraphを正本とする。成功した空一覧と取得不能を区別し、WikiのStoryを代替正本にしない。
2. Mesh RESTは検証済み認証を要求する。MCPは既存のトークン管理を使用し、偽装可能なヘッダーで認証を代替しない。
3. Mesh queryの成功は送信受付であり回答取得ではないことを、APIとMCPの契約に明示する。未実装の一斉送信を約束しない。
4. 退役したCodex App Server能力に、現行の実装・復旧指示や削除済みテストの実行指示を残さない。
5. 変更範囲の回帰テストと一度の独立レビューで上記を確認する。

## 対象外

Meshの回答待ち・回答保存・新しいリトライ基盤、旧ファイルの一括削除、実運用のMesh送信、本番デプロイ。

仕様: [brainbase-boundary-cleanup-spec.md](../specs/brainbase-boundary-cleanup-spec.md)
設計: [brainbase-boundary-cleanup.md](../architecture/brainbase-boundary-cleanup.md)
