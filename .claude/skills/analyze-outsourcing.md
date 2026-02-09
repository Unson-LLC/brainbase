---
name: analyze-outsourcing
description: freee外注費とJibbleメンバーの照合・分析（月次/年次レポート生成）
location: project
tags:
  - finance
  - freee
  - jibble
  - reporting
user_invocable: true
---

# freee外注費分析Skill

## 目的

freee会計の外注費勘定科目とJibbleメンバーの稼働状況を照合し、以下を明らかにする：
- メンバー別の支払総額と理論稼働時間
- フルタイム度（月160時間基準）
- カテゴリ別支出の内訳
- 未照合取引の特定

## 実行タイミング

- **月次**: 毎月末（翌月初）に前月分を分析
- **四半期**: 四半期末に当期累計を分析
- **年次**: 年度末に通年分析
- **随時**: 支出状況の確認が必要な時

## 前提条件

### 必須ファイル
- `_codex/projects/unson/finance/outsourcing_mapping.md` - マッピング定義とルール
- `/Users/ksato/workspace/tools/freee-mcp/` - freee API クライアント
- Jibble MCP - メンバー情報取得（オプション）

### 環境変数
- freee認証トークン（自動リフレッシュ対応）
- Jibble認証情報

## 分析手順

### Phase 1: データ取得

1. **期間設定**
   - デフォルト: 当年1月1日〜現在
   - カスタム: ユーザー指定期間

2. **freee外注費取引を取得**
   ```python
   deals = client.list_deals(
       company_id=company_id,
       start_issue_date=start_date,
       end_issue_date=end_date,
       deal_type="expense",
       account_item_id=outsourcing_account_id,
       offset=offset,
       limit=100
   )
   ```
   - ページネーション対応（全件取得）
   - 証憑データ（receipts）を含む完全なJSON取得

3. **Jibbleメンバー情報を取得（オプション）**
   - 最新の時給単価
   - 在籍状況（Joined/Left）
   - メールアドレス

### Phase 2: マッピング適用

4. **マッピングファイルを参照**
   - `_codex/projects/unson/finance/outsourcing_mapping.md` を読み込み
   - 法人名 → メンバー名のマッピング
   - 異字体対応ルール
   - カテゴリ分類ルール

5. **証憑データから取引先名を抽出**
   ```python
   partner_name = deal["receipts"][0]["receipt_metadatum"]["partner_name"]
   ```
   - 証憑がない場合は `deal["partner_name"]` を使用
   - 両方ない場合は「（不明）」として記録

6. **異字体正規化**
   - 「渡辺」「渡邊」→「渡邊博昭」
   - その他の異字体パターンも適用

7. **照合処理**
   - **直接マッチ**: 個人名（Jibbleメンバー名）
   - **法人マッピング**: 法人名 → メンバー名（Social Wing → 太田葉音）
   - **カテゴリ分類**: BAAOリソース、クラウド費用、固定給など
   - **未照合**: 上記に該当しない取引

### Phase 3: 集計・計算

8. **メンバー別集計**
   - 支払総額
   - 支払回数
   - 平均支払額
   - 支払元内訳（個人名/法人経由）

9. **理論稼働時間計算**
   ```
   理論稼働時間（年間） = 支払総額 ÷ 時給単価
   月平均稼働 = 理論稼働時間 ÷ 分析月数
   フルタイム度 = 月平均稼働 ÷ 160時間 × 100
   ```

10. **カテゴリ別集計**
    - Jibbleメンバー
    - クラウド費用
    - BAAOリソース
    - 固定給
    - CSO報酬
    - その他

### Phase 4: レポート生成

11. **レポート構成**
    ```
    【外注費分析レポート】

    ■ サマリー
    - 分析期間
    - 外注費総額
    - カテゴリ別内訳

    ■ メンバー別稼働状況（フルタイム度順）
    - 支払総額
    - 月平均稼働時間
    - フルタイム度
    - 支払元内訳

    ■ カテゴリ別詳細
    - 各カテゴリの金額・件数
    - 主要取引先

    ■ 未照合取引
    - 金額上位10件
    - 要確認事項

    ■ 前回比較（オプション）
    - 前月/前四半期/前年との差異
    - 増減理由の推測
    ```

12. **出力形式**
    - コンソール出力（即座に確認）
    - Markdownレポート（`/tmp/outsourcing_report_YYYYMMDD.md`）
    - CSV出力（オプション、Excel用）

### Phase 5: フォローアップ

13. **未照合取引の確認**
    - 金額上位の取引をユーザーに確認
    - 新規取引先の分類ルール追加
    - マッピングファイルの更新提案

14. **異常値の検出**
    - 前月比で大幅増減（±30%以上）
    - 新規メンバーの出現
    - 長期未稼働メンバー（3ヶ月以上支払いなし）

15. **改善提案**
    - freee取引先登録の推奨
    - 備考欄の記載推奨
    - カテゴリ分類の見直し提案

## 注意事項

### 異字体対応
- 「渡辺」「渡邊」など、常に正規化を実施
- 新規パターン発見時はマッピングファイルに追記

### 法人経由支払い
- 法人名から個人を特定
- 1法人に複数メンバーの場合は個別確認（例: NamedFox）

### カテゴリ分類の境界
- BAAO関連は「リソース提供」と「プロモ費用」を区別
- 同一取引先で複数用途がある場合は明細レベルで分類

### トークンリフレッシュ
- freee API呼び出しで自動リフレッシュ
- 失敗時はユーザーに再認証を促す

## エラーハンドリング

1. **freee API エラー**
   - 401: トークンリフレッシュ
   - 429: レート制限、待機後リトライ
   - 500系: サーバーエラー、リトライ

2. **データ不整合**
   - 証憑なし取引: partner_nameで代替
   - 金額0円取引: 警告して除外
   - 日付不正: エラー表示

3. **マッピング不足**
   - 未定義の法人名: 未照合として記録
   - 未定義の異字体: 警告してそのまま処理

## 成果物の保存

- **レポートファイル**: `/tmp/outsourcing_report_YYYYMMDD.md`
- **マッピング更新**: `_codex/projects/unson/finance/outsourcing_mapping.md`
- **スクリプト**: `/tmp/analyze_outsourcing_YYYYMMDD.py`（再実行用）

## 次回改善のためのメモ

分析完了後、以下を記録：
- 新規発見事項（新しい取引先、異字体パターンなど）
- 未照合取引の多い理由
- 次回の改善案

---

## 実行例

```
ユーザー: /analyze-outsourcing
→ 当年1月〜現在の外注費を分析

ユーザー: /analyze-outsourcing 2025-10-01 2025-12-31
→ 2025年Q4の外注費を分析

ユーザー: /analyze-outsourcing 2025-01-01 2025-12-31
→ 2025年通年の外注費を分析
```

## 関連ドキュメント

- `_codex/projects/unson/finance/outsourcing_mapping.md` - マッピング定義
- `_codex/common/meta/people/` - メンバー情報
- `skill: freee-mcp-api-gui-mapping` - freee API理解
