# VibePro リスク台帳

| 項目 | 内容 |
|------|------|
| Run ID | 2026-07-11T122559Z |
| 検出リスク | 6件 |

| ID | カテゴリ | リスク概要 | 深刻度 | 推奨対応 |
|----|----------|------------|--------|----------|
| VP-STATIC-003 | セキュリティ | XSS につながり得る DOM 操作がある | High | ユーザー入力をHTMLとして挿入しない。必要な場合はサニタイズし、textContentなど安全な代替を使う。 |
| VP-UI-001 | UI品質 | 旧デザインコンポーネントのトークン候補が残っている | Medium | 対象コンポーネントをdesign tokenまたは新しいcomponent styleへ置き換え、スクリーンショット証跡で確認する。 |
| VP-UI-002 | UI操作信頼性 | クリック可能要素のhit targetが不安定になるCSS候補がある | Medium | クリック可能要素はhover/focus/press中にhit targetを移動させず、状態表現は色・border・shadowに限定する。高頻度操作のtargetは最低28px程度を確保する。アイコンボタン配下のsvg/svg *はpointer-events:noneにし、Playwrightではlocator.clickだけでなくelementFromPoint(center)とpage.mouse.clickで物理クリックを確認する。 |
| VP-GESTURE-001 | ジェスチャー操作品質 | map/carousel/touch操作の契約不足候補がある | Medium | スワイプ、地図移動、tap、scrollの優先順位をStory/E2Eに明示し、Playwrightではdrag後のURL不変、scrollLeft/active card変化、elementFromPointでのhit targetを確認する。 |
| VP-FLOW-006 | 導線設計 | クリック可能に見えるUIに操作契約がない候補がある | High | クリック可能に見える要素は、保存、表示変化、画面遷移、scroll/focus、disabled、または準備中表示のいずれかに分類できるようにする。画面単位で全クリック可能要素を棚卸しし、Playwrightでは主要導線だけでなく押せそうなUIの反応も確認する。 |
| VP-NET-003 | Network Contract | 静的にroute実体を確定できないAPI client callがある | Medium | template literalやwrapper経由のAPI pathは、候補route・テスト・Playwrightネットワーク証跡で契約を補強する。 |

## API境界の保護状態

- api-boundary は適用されていない

## 診断レビュー分類

| Finding | Status | Suggested | Action | Rationale |
|---------|--------|-----------|--------|-----------|
| VP-STATIC-003 | unreviewed | implementation_gap | - | VP-STATIC-003 は対象リポジトリ内の公開面、API境界、または配信設計に対する実装不足候補として検出された。 |
| VP-UI-001 | unreviewed | implementation_gap | - | VP-UI-001 は対象リポジトリ内の公開面、API境界、または配信設計に対する実装不足候補として検出された。 |
| VP-UI-002 | unreviewed | implementation_gap | - | VP-UI-002 は対象リポジトリ内の公開面、API境界、または配信設計に対する実装不足候補として検出された。 |
| VP-GESTURE-001 | unreviewed | implementation_gap | - | VP-GESTURE-001 は対象リポジトリ内の公開面、API境界、または配信設計に対する実装不足候補として検出された。 |
| VP-FLOW-006 | unreviewed | implementation_gap | - | VP-FLOW-006 は対象リポジトリ内の公開面、API境界、または配信設計に対する実装不足候補として検出された。 |
| VP-NET-003 | unreviewed | implementation_gap | - | VP-NET-003 は対象リポジトリ内の公開面、API境界、または配信設計に対する実装不足候補として検出された。 |

## 次アクション候補

- なし
