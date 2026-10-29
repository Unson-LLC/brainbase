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

### 文字の濃さと主ボタン・失敗のカード

- 主ボタン（`.bb-ws-button.is-primary`）は `--bb-color-action` の地と枠、`--bb-color-action-text` の文字、hoverは `--bb-color-action-hover`。白い面の上でも普通のボタンより強く見える。画面のCSSで主ボタンの色を上書きしない。
- 11〜13pxの文字は、背景に対して4.5:1以上の色を使う。パンくずは `--bb-color-muted`。`--bb-color-quiet` は #f6f6f8 の上で4.17:1と4.5:1に届かないので、読ませる文字に新しく使わない（既存の28か所は画面ごとに直す）。淡い危険の面（`--bb-color-danger-soft`）の上の文字は `--bb-color-inline-error`。
- 色を直すときは、トークンの値ではなく使うトークンを替える（値の正本は組織版のデザイン）。
- `workspaceErrorCard` は既定で閉じた通知。画面の中身の代わりに置く失敗（一覧全体を読めなかった、など）には `open: true` を渡し、理由と「0件ではありません」を最初から見せる。

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

### 一覧の操作帯

- `workspaceCompactToolbar(document, { root, query, filters, sort, reset })` は、左の `primary` slotと右の文字検索・フィルター・並べ替えを1列に組み立てる。渡したinput、reset、`workspaceCombobox`の状態とhandlerは所有元で維持する。
- フィルターは文字と右の `⌄` を1つのtriggerに含める。条件適用中は淡いブランド面と識別可能な名前を使い、同じ位置を独立した解除 `×` へ切り替える。幅が変わって隣の操作を動かさない。解除後はtriggerへfocusを戻す。
- 並べ替えは既存comboboxのtriggerを使い、1回で候補を表示する。filter/sortはマウスとキーボードの両方で排他的に開き、破棄時にlistenerを外す。
- `.bb-ws-neutral-controls` は画面単位の明示適用。入力は通常の枠とcaretを使い、ボタンのキーボードfocusは中立色で示す。hover・expandedの枠やメニューの状態も共通規則に揃え、画面別の競合する色を増やさない。他画面へ自動適用しない。
- 議事録は `toolbarPresentation: 'compact'` を明示する。未指定は既存のexpanded表示を維持。通常の読込完了文は隠し、空状態は一覧内、失敗/再試行/保存結果は操作帯の下、詳細ロードはdrawer内に表示する。更新順でもカードの構造と日付見出しを保ち、日時未登録の会議も実際の更新順から動かさない。


### Tab strips

`workspaceTabList(root)` adds the opt-in `bb-ws-tabs` class to an existing strip and returns the same node. It is idempotent and adds no listeners, roles, IDs, selection state or lifecycle. Hosts can use the class directly; load `workspace-kit.css` and the shared tokens. Tab buttons retain `aria-selected`, destination links retain `href`/`aria-current`, and exclusive view buttons retain `aria-pressed`. Their owner keeps existing click, keyboard, focus and asynchronous behavior.

The shared appearance is 44px high, 13px text at weight500, no gap and 12px internal horizontal padding. Hover does not change foreground or background. The 1px baseline and 2px selected indicator share the same bottom edge. Strips scroll horizontally within their own bounds, preserve hidden nodes and show keyboard focus. Layout gutters and vertical margins remain the host's responsibility. Use `bb-ws-tab-count` only for existing counts, and `bb-ws-tabs--summary` when a tab already has a secondary line.

Application must be explicit: do not style every `role=tablist` globally. Task list/kanban/Gantt view modes remain unmarked and retain their existing segmented appearance. Search toolbar placement and intake-page styling are independent changes. Organization hosts consume the published exact-pinned package; source-backed previews do not replace that release gate.


### 検索帯（明示適用）

`workspaceSearchBand(document, { root, query, filters, sort, reset, onResetSort })` は共通の検索帯を組み立てる。左は `primary`、右は文字検索 → `scopeSlot` → フィルターアイコン → 並べ替えアイコン。ホストが渡したinput、各条件、comboboxとhandlerの所有は変えない。`destroy()`で追加listenerとpopoverを破棄する。既存 `workspaceCompactToolbar` と各画面の既定表示は変更しない。

- 本文のスクロール領域で共通ヘッダー直下44pxに固定。高さ56px、操作高さ32px、上下12px、下線とその下12px。スクロール領域と本文外枠の配置はホストが所有する。
- 検索は180px上限の薄灰・枠なし楕円。入力があると選択面へ変わる。scope選択は内容幅で伸縮し、複数時は「N件選択中」の選択面を使う。色・寸法は `--bb-search-band-*` で定義する。
- 右の操作は24px幅のアイコンで、互いの間は4px。適用時は選択面と太い線、名前にも「適用中」を含める。解除操作は各popoverの内部に置き、フィルター解除は左右中央。queryとscopeはフィルター解除で変えない。
- `workspaceDropdownChevron(document)` は10×6px、線幅1.2、丸端の浅いV字SVG。装飾として `aria-hidden`、クリック・focus・名前は親triggerが所有する。画面ごとの文字グリフ・上下位置補正を増やさない。

`workspaceCombobox` の複数選択は `multiple: true, values: string[]` と `onChange(values, option)` で使う。空値の候補は全選択解除。選択後も開いたまま、選択はチェックのみ、背景はhover時のみ。Arrow/Home/End/PageキーとEnter/Space、Escape/Tab、外側クリックの閉じる操作を保持する。スクロールは候補一覧の内部だけを動かし、同じoptionsと値の `update` でDOMを作り直さない。

- `renderIcon(option)` は表示用Nodeを返す。画像値・名称はホストの選択肢から渡す。
- `showHints: false` で識別子などの補足表示を隠す。`showCount: false` は単純な件数のみ隠し、候補なし・表示上限の案内は残す。
- `searchable: false` は入力欄を出さずlistboxにfocusする。`align: 'end'` はtrigger右端にpopupを揃える。長い候補一覧のscrollbar余白は両側に確保する。

議事録は `toolbarPresentation: 'search-band'` でこの共通部品を選ぶ。`hostFilters` は `placement: 'scope', multiple: true, values, options, renderIcon, showHints: false, onChange` を受け取る。任意の `matches(entry, values)` は取得済みの一覧を絞り込む。候補の可視性・許可、複数scopeの取得と合算、URL状態はホストが所有し、OSSが組織の認可や取得経路を変更しない。

`refresh({ quiet: true })` は既存結果を保って再取得し、正常な更新時に一時読込文で本文を押し下げない。失敗と再試行は隠さない。選択中のscope rootと開いたメニューを差し替えず、スクロールとfocusを保つ。

会議作成は一覧scopeとは独立して `createProjectOptions()` と `createProjectValue()` で保存先を選べる。候補にない保存先は送信せず、`createMeeting(payload, projectCode)` へ明示scopeを渡す。ホストが既存の認可・mutation・詳細readbackを担当する。callback未指定は従来の `mutate` を保つ。作成可否は引き続きホストの `canCreateMeeting` で決まる。

保存先が現在の一覧scope外なら、ホストは明示保存先でreadbackした後、`shouldOpenCreatedMeeting(created, projectCode)`でfalseを返せる。UIは一覧条件を変えず作成drawerを閉じ、誤った一覧scopeで詳細を再取得しない。未指定は従来の詳細表示を保持する。
