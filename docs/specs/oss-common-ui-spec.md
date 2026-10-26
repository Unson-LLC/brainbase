# Spec: OSS共通UIの境界と共通パーツの規約

## 配置

`ui/` はブラウザで直接利用できるES moduleとCSSを保持する。ホストはAPI関数、利用者・プロジェクト文脈、DOM rootを注入し、UIは認証tokenや保存層へ直接接続しない。

## 公開契約

- `@unson/brainbase-mcp/ui/outcome-knowledge`
- 対応するCSS

組織版はこれらを依存として利用し、組織固有のshell、組織切替、権限、承認、監査、外部接続だけを追加する。

Mana委任UI（`ui/outcome-mana`、そのCSSと`ui/icons/mana`）は、0.8.0の後に共通UIから外した。Unsonの実行基盤（Mana）に結びつくため、組織版の画面として`brainbase-organization`が持つ（横断ADR、brainbase-project ADR-011 U2）。

## 不変条件

- `unknown` を空や成功へ変換しない。
- mutation後のreadback契約を維持する。
- 顧客名、organization ID、URL、秘密、brandingを含めない。
- OSS機能を組織版で削除しない。


## 共通パーツを使うときの原則

**不要なセカンダリラベルや説明を避ける。レイアウトに説明させる。**

新しい部品を作る前に `ui/workspace-kit.js` と対象画面の既存部品を確認する。同じ役割の部品は同じ実装を使い、画面ごとのコピーやホストからのCSS上書きを増やさない。説明を減らしても、未確認・取得失敗・権限・再試行・保存後のreadback情報は隠さない。

### ページヘッダー

- `workspaceTopbar(document, { title })` はタイトルだけの共通バー。高さ44px、文字14px/20px・weight500、左右16px。スクロール領域の上端へsticky固定し、本文やfocus対象を隠さない。
- 件数、追加ボタン、画面固有のフィルターは本文の操作帯に置く。全ページ共通の用途が定義されていない3点メニューは追加しない。
- 世界のような没入型キャンバスはヘッダーを出さず、画面上端から内容を表示する。
- `workspacePageHeader` は本文の説明・出典・操作を組み立てる既存部品。共通バーを使うホストは `.bb-ws-has-topbar` で重複タイトルを省き、固有の操作や説明を保持する。

### 詳細パネル

- 常設の右詳細列ではなく、項目を選んだときだけ右から開くdrawerを使う。
- 継続して内容が更新される詳細は `workspaceDetailDrawer` を使う。`setContent` は内容更新、`open` は明示的なユーザー操作や詳細リンク、`close` は終了、`dispose` は画面破棄に対応する。
- 単発の詳細は `workspaceDialog(..., { presentation: 'drawer' })`。ホスト所有のdialogは `workspaceApplyDrawer` / `workspaceCloseDrawer` を使い同じ幅・開閉モーション・reduced motionへ揃える。
- Escape、背景クリック、閉じるボタン、モーダルのfocus制御、閉じた後の選択行へのfocus復帰を保持する。非同期応答が来ても、閉じたdrawerを勝手に開き直さない。画面離脱時は破棄して古い応答が前画面を復活させない。
- 知識・議事録は `detailPresentation: 'drawer'` を明示できる。互換性のため未指定時は既存のinline表示を保持する。会議作成、保存結果、失敗、再試行も到達可能な状態に保つ。

### 所有と変更手順

共通UIとトークンはこのOSSリポジトリ、組織のルーティング・認証・権限・監査は組織ホスト、テナントの値は設定リポジトリが所有する。[所有境界ADR](../architecture/oss-organization-ui-ownership.md)に従う。ブランド資料とトークンの役割も同ADRを参照する。

共通部品の変更はOSSへ先に実装・テストし、正式公開npmのexact pinを組織ホストへ取り込む。ホストによるコピー、共通CSSの上書き、DOM監視での共通部品の移設は避け、明示的なオプションとライフサイクルで合成する。

### 検証

desktop/mobile、長いタイトル、スクロール時の固定、詳細の開閉とfocus復帰、画面遷移、読み込み・未確認・失敗・再試行・保存結果を確認する。API/認証/権限/readbackの契約は見た目と別に維持する。合成fixtureでテストし、本番データを公開テストへ入れない。
