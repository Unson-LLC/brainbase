# VibePro リスク台帳

| 項目 | 内容 |
|------|------|
| Run ID | 2026-08-02T163157Z |
| 検出リスク | 4件 |

| ID | カテゴリ | リスク概要 | 深刻度 | 推奨対応 |
|----|----------|------------|--------|----------|
| VP-STATIC-003 | セキュリティ | XSS につながり得る DOM 操作がある | High | ユーザー入力をHTMLとして挿入しない。必要な場合はサニタイズし、textContentなど安全な代替を使う。 |
| VP-UI-001 | UI品質 | 旧デザインコンポーネントのトークン候補が残っている | Medium | 対象コンポーネントをdesign tokenまたは新しいcomponent styleへ置き換え、スクリーンショット証跡で確認する。 |
| VP-FLOW-006 | 導線設計 | クリック可能に見えるUIに操作契約がない候補がある | High | クリック可能に見える要素は、保存、表示変化、画面遷移、scroll/focus、disabled、または準備中表示のいずれかに分類できるようにする。画面単位で全クリック可能要素を棚卸しし、Playwrightでは主要導線だけでなく押せそうなUIの反応も確認する。 |
| VP-NET-003 | Network Contract | 静的にroute実体を確定できないAPI client callがある | Medium | template literalやwrapper経由のAPI pathは、候補route・テスト・Playwrightネットワーク証跡で契約を補強する。 |

## API境界の保護状態

- api-boundary は適用されていない

## 診断レビュー分類

| Finding | Status | Suggested | Action | Rationale |
|---------|--------|-----------|--------|-----------|
| VP-STATIC-003 | unreviewed | implementation_gap | - | VP-STATIC-003 は対象リポジトリ内の公開面、API境界、または配信設計に対する実装不足候補として検出された。 |
| VP-UI-001 | unreviewed | implementation_gap | - | VP-UI-001 は対象リポジトリ内の公開面、API境界、または配信設計に対する実装不足候補として検出された。 |
| VP-FLOW-006 | unreviewed | implementation_gap | - | VP-FLOW-006 は対象リポジトリ内の公開面、API境界、または配信設計に対する実装不足候補として検出された。 |
| VP-NET-003 | unreviewed | implementation_gap | - | VP-NET-003 は対象リポジトリ内の公開面、API境界、または配信設計に対する実装不足候補として検出された。 |

## 次アクション候補

- なし
