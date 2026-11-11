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

`ui/workspace-kit.js`、既存画面、利用できるカタログは部品を探す参考にできる。用途に合う既存部品の再利用を推奨するが、カタログの参照・取得・部品利用は必須ではない。合う部品がない・見つからない・不適合なら、画面固有の部品を作って進めてよい。カタログへの追加やデザイン確定を機能開発の前提にせず、後から共通化すると便利なものだけ整理する。資料の参照権限がなくても手元の既存ソースで継続できる。

正本は本体の実装と正式な共通部品で、カタログは見本。採用時は対象版との差を確認する。独自部品の作成と、既存の共通部品の改変・複製による別正本化は区別する。共通部品やトークンの変更で他画面へ影響する場合は、影響範囲を確認し、既存の所有境界・承認・互換性の手順に従う。画面ごとの共通部品のコピーやホストからのCSS上書きを増やさない。説明を減らしても、未確認・取得失敗・権限・再試行・保存後のreadback情報は隠さない。

### ページヘッダー

- `workspaceTopbar(document, { title, query, tabs, tools })` は全ページ共通の52pxバー。下に1pxの線、左右24px、間隔8px。左に任意のタブ、右に検索と道具を置く。タイトルは最初の子のH1として常に保持し、`tabs` がある時だけ視覚的に隠す。タブなしは従来どおりタイトルを表示する。本文と同じcanvas背景でsticky固定し、`--bb-page-header-height` が検索帯の固定位置にも使われる。
- `setQuery(input | null)`、`setTabs(Node | Node[] | null)`、`setTools(Node | Node[] | null)` で内容を更新できる。検索inputの値とhandlerは所有元が保持する。同じinputを再指定しても包みを作り直さない。空slotはDOMを増やさない。道具の処理・名前・利用可否は呼び出す側が決める。
- `workspaceSearchControl(document, { input })` は幅240px・高さ36px・文字13px・アイコン16pxの共通検索部品。白い面と通常の枠を持ち、ヘッダー内と本文操作帯で同じ部品を使う。入力の値・検索処理・ラベルは所有元が渡す。
- タブの件数はタブ内、検索・追加・表示条件の道具は `tools` に合成できる。既存画面の本文操作帯は今回移設しない。用途の定まらない道具は追加しない。
- 世界のような没入型キャンバスはヘッダーを出さず、画面上端から内容を表示する。
- 単独ページの本文見出しもH1とし、`--bb-page-title-font-size` / `--bb-page-title-line-height` / `--bb-page-title-font-weight` を参照する。画面・viewportごとのサイズを定義しない。
- `workspacePageHeader` のleadは60字以内・1文までを表示し、それを超える全文は既存 `workspaceHelp` の「？」へ置く。`help` で明示の補足も渡せる。長いleadの全文に補足を続け、説明を失わない。権限を含むleadを呼び出し元で組み立てる場合は `preserveLead: true` で自動分割を止め、操作説明だけを `help` に渡す。状態・権限・失敗・出典は説明と分けて維持する。
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

`workspaceTabStrip(root, { memoryKey, appearance })` is the opt-in for keyboard switching and a sliding indicator ([Story](../stories/story-shared-tab-strip-keys-and-indicator-v1.md)). It applies `workspaceTabList` and returns `{ root, update, destroy }`; calling it again on the same root returns the same controller. On a `role="tab"` child, ←/→ move to the previous/next tab and wrap, Home/End go to the first/last; hidden and disabled tabs are skipped and modified keys are ignored. Selection is made by calling the tab's own `click()`, so the host's handler stays the owner. Only the selected tab has `tabindex="0"`. When the host redraws after a key move, focus returns to the new selected tab and it is scrolled into view, unless the viewer has moved focus elsewhere. The 2px indicator becomes one `::after` bar that slides between tabs; strips redrawn as new nodes pass the same `memoryKey` so the bar slides from the previous position. A host that replaces the children of a kept root calls `update()` after drawing. Reduced motion removes the slide. When a tab cannot be measured, the per-tab indicator above stays.

The optional `appearance: 'prominent'` applies `.bb-ws-tabs--prominent`, the shared card-inbox appearance: 43px tabs, 14px text at weight500 (selected 600), 16px horizontal padding, 4px gap, `--bb-tab-prominent-ink` foreground/2px indicator (defaults to `--bb-color-accent`) and `--bb-tab-prominent-hover` (defaults to `--bb-inbox-tab-hover`). At 768px and below it wraps with 10px horizontal padding and uses a per-tab underline. The card inbox explicitly selects this variant; ordinary inbox and unspecified strips keep their prior appearance. Selection uses the existing ARIA state; hosts call `update()` after updating kept strips. Use the shared variant instead of importing inbox CSS or copying its selectors into hosts. Container placement and margins stay with the host; prominent strips do not draw a baseline, so the host toolbar owns its bottom border. The optional ink/hover properties are resolved with fallbacks on the strip instead of root aliases, preserving scoped accent/hover customization. A host with a different local accent can explicitly inject `--bb-tab-prominent-ink: var(--bb-color-action)` on its toolbar without overriding shared selectors.

Application must be explicit: do not style every `role=tablist` globally. Task list/kanban/Gantt view modes remain unmarked and retain their existing segmented appearance. Search toolbar placement and intake-page styling are independent changes. Organization hosts consume the published exact-pinned package; source-backed previews do not replace that release gate.


### 検索帯（明示適用）

`workspaceSearchBand(document, { root, query, filters, sort, reset, onResetSort })` は共通の検索帯を組み立てる。左は `primary`、右は文字検索 → `scopeSlot` → フィルターアイコン → 並べ替えアイコン。ホストが渡したinput、各条件、comboboxとhandlerの所有は変えない。`destroy()`で追加listenerとpopoverを破棄する。既存 `workspaceCompactToolbar` と各画面の既定表示は変更しない。

- 本文のスクロール領域で共通ヘッダー直下に固定（`--bb-search-band-header-height` は共通ヘッダー高に追従）。高さ56px、操作高さ32px、上下12px、下線とその下12px。スクロール領域と本文外枠の配置はホストが所有する。
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


### 標準テーマ（2026-10-30）

共通トークンの既定は紺の操作色とミントの補助面、Noto Sans JPです。本文はweight400、見出し・操作は500。余白・寸法・状態の意味は変えません。mintは小さい前景文字や白文字ボタンに使わず、操作前景は紺を使用します。警告・成功・失敗は既存の意味色を保持します。

フォント本体の配信方法はホストが所有します。共通部品は `--bb-font-sans` と `--bb-font-weight-body` / `--bb-font-weight-medium` を読み、フォント取得不能でもシステム書体で機能を維持します。


### Area navigation host presentation

`createAreaNav` keeps its existing presentation when the following options are omitted. `sectionIconFor(section)` can return a decorative `Node` or `null` for a section heading link. The component wraps the icon in `.bb-area-section-icon[aria-hidden="true"]` and keeps the visible label separate; the label, destination, current state and hidden-screen fallback remain owned by the navigation. The icon is created once per section and retained across `show`, `setHidden`, `setCount` and `setLinks`. Plain headings do not display the icon. `sectionLinkClassName` adds a host class only to heading links, independently of `linkClassName` for area and supplied section links.

Hosts set the following custom properties on their navigation container instead of overriding shared selectors. Every fallback preserves the existing appearance:

| Custom property | Default |
| --- | --- |
| `--bb-area-nav-gap` | `2px` |
| `--bb-area-section-gap` | `2px` |
| `--bb-area-section-links-gap` | `2px` |
| `--bb-area-section-margin-top` | `var(--bb-space-4)` |
| `--bb-area-footer-margin-top` | `auto` |
| `--bb-area-footer-padding-top` | `var(--bb-space-4)` |
| `--bb-area-section-label-padding` | `0 10px 4px` |
| `--bb-area-section-label-color` | `var(--bb-color-rail-muted, var(--bb-color-muted))` |
| `--bb-area-section-label-font-size` | `11px` |
| `--bb-area-section-label-font-weight` | `var(--bb-font-weight-medium)` |
| `--bb-area-section-label-letter-spacing` | `.04em` |
| `--bb-area-section-link-padding-top` | `4px` |
| `--bb-area-section-link-gap` | `4px` |
| `--bb-area-section-link-indicator-display` | `inline` (`none` hides the decorative chevron) |

The heading link's padding-top token replaces the top edge of the label padding, as before. Presentation options do not change routing, remembered screens, section links, counts, keyboard focus or hidden-screen behavior. Hosts consume the published exact-pinned package for these options.

### セグメント型タブと絞り込み

- `workspaceTabStrip(root, { appearance: 'segmented' })` は外枠36px・内側30pxの囲みタブ。既存default/prominentの外観は変えない。選択状態・クリック処理は所有元、キー操作と選択面の移動・再描画後のfocusは共通部品が持つ。
- `workspaceFilterPopover` は幅280px・余白16px・角丸12pxの共通surfaceを持つ。`appearance: 'icon'` は36pxの絞り込みアイコンボタン。既存文字triggerは省略時のまま。条件やmenu semanticsは所有元が保持する。
- `setOpen(value, focus = false)` と `isOpen` が論理的な開閉の正本。閉じるとすぐaria-expandedをfalse、panelをinert/aria-hiddenにして非操作にし、180msで上へ8px移動しながら消したあとhiddenにする。開く動きは240ms。閉じる途中のhiddenを開閉判定に使わない。
- 再openは終了待ちを取り消す。`destroy()` は即時非表示・timer/listener清掃。Escapeはtriggerへfocusを戻し、reduced motionでは終了を待たずに非表示にする。DOM監視や見本専用のghostコピーは本体へ持ち込まない。

### Directory filter choices and applied conditions

`workspaceFilterOption(document, { label, count, checked, disabled, role, attrs, onClick })` returns a button with separate check, label and count cells. `count` may be an unknown/partial description and is never inferred as zero. Selection is expressed by `aria-checked` and a check, with a neutral background; only hover paints the row. Callers retain condition changes, dismissal and focus.

`workspaceFilterChip(document, { label, onRemove, attrs })` provides the shared mint applied-condition surface and individual remove action. The host retains removal and focus behavior. Search-bearing topbars use `--bb-page-header-inline-end` (default `--bb-space-5`) to align the search edge with the host content gutter.

The shared review orange is `--bb-color-review`; the inbox approval stripe aliases this token. Knowledge directory type labels use explicit type tokens and retain their text. `judgment`/`decision` and `document`/`knowledge` aliases share their respective type color; missing or unrecognized types retain the neutral label.


### これからの共通標準（0.50.10候補）

同じ目的で同じ動きをするものは同じ部品を使う。見た目が似ていても役目が違うものは区別する。業務データ、文言、取得・保存・権限判断はホストが渡す。既存ページの検索・プルダウン・主ボタンの置き換えは今回行わない。以下の明示選択以外は既定の見た目を維持する。ヘッダーの52px化だけは全利用画面へ適用する。世界のようにヘッダーを生成しない画面には影響しない。

これからの検索は `workspaceSearchControl({ input, appearance: 'compact' })`（210×32px、白面、内側1px枠、角7px、文字12.5px、アイコン14px）。入力の名前と検索処理はホストが持つ。ヘッダータブ付きのqueryにも同じ形を適用する。タブなしの既存queryは240×36pxを維持する。

これからの候補選択は `workspaceCombobox({ appearance: 'compact', ... })`、ページの見方は `workspaceTabStrip(root, { appearance: 'header' })`、主操作は `workspaceButton({ variant: 'primary', ... })` の紺を使う。ページごとにCSSを写さず、tokens → workspace-kit.css → ホストのレイアウトCSSの順で読む。主ボタンの色や共通セレクタをホストで上書きしない。

#### ヘッダーの見方タブ

- 役目: 同じページの見方を選ぶ。文言・件数・選択はホストが持つ。
- 見た目: `appearance: 'header'`。52pxの文字タブ、左右14px、間2px、15px/600（選択700）。`.bb-ws-tab-count` は22pxのミント丸、文字11.5px/600。選択中は濃いミント。紺の3px下線はヘッダー下線と底をそろえる。
- 状態・動き: ホストのARIA選択を参照。下線は300ms、`cubic-bezier(.3,1.4,.5,1)`。←→/Home/End、非表示・disabledの除外、描画後のfocus復帰とスクロールは既存controllerを使う。reduced motionでは移動しない。
- 呼出: `workspaceTabStrip(root, { appearance: 'header', memoryKey })`。保持したrootの子を更新したら `update()`、破棄時は `destroy()`。tablist/tab/aria-selectedとclick処理はホストが用意する。
- 禁止: 既存stripへ自動適用、IDや件数の推測、同じ下線の二重描画。

#### 条件チップ

- 役目: かかっている条件と解除操作を並べる。
- 見た目: 24px高、角6px、ミント面、紺12px/500。×は18px、リセットは24pxのアイコン。6px間隔で折り返す。
- 状態・動き: `workspaceConditionChips(document, { items: [{ label, onRemove }], reset, resetLabel })`。`reset` は初期状態と違う時だけホストが渡す。選択状態を内部で推測しない。解除とリセットの後の描画・focusはホストが管理する。
- 禁止: 条件解除でqueryや別の条件を勝手に変える、業務条件を部品へ埋め込む。

#### 丸い選択印

- 役目: 2〜4個の排他的な短い選択肢。
- 見た目: `workspacePills(document, { label, items: [{ value, label, disabled, icon }], value, onChange })`。高さ28px・角999px・間2px、文字12.5px。入力枠内は30px/13px。選択は紺・白文字600、通常はslate/500、hoverはcanvas、disabledはopacity .35。
- 状態・動き: ネイティブbuttonのTab/Enter/Spaceを保つ。`aria-pressed` を使うgroupでありtablistではない。ホストが変更を受け入れた後 `root.update(value)` で反映する。装飾のiconはホストが渡す。
- 禁止: 押しただけで業務状態を確定、4択を超える一覧の代用、disabledの操作実行。

#### コンパクトなプルダウンと候補

- 役目: 単一または複数の候補選択。`workspaceCombobox` の `appearance: 'compact'` を明示する。
- 見た目: trigger28px・角6px（`className: 'is-boxed'` で通常枠、`is-active` で適用中のミント面を明示）、候補32px・角8px、popupはpadding4px・角10px・最小150px幅・最大260px高、通常面は白、hoverはcanvas。複数は15pxの四角いチェックで選択を表す。フォーム内はtrigger32px・候補34px・最小幅200px。
- 状態・動き: 単一は選んだら閉じる。複数は `multiple: true, values, onChange(values, option)` で選んでも閉じない。候補の空値は全解除。140ms ease-out、-6px/scale .98から現れて逆へ消える。閉じ始めにinert/aria-hiddenにし、アニメ完了またはfallbackで隠す。再openは古い終了を取消す。
- 呼出: 短い一覧は `searchable: false, showCount: false, showHints: false`。検索可能・空・上限案内・単複選択・候補icon・右揃え等の既存契約も使える。`update`/`open`/`close`/`destroy`を使う。Arrow/Home/End/Page/Enter/Space（複数）/Esc/Tab、外側クリック、focus復帰は既存制御を保つ。reduced motionは即時。
- 禁止: CSSで開閉だけをまねる、選択を色だけで示す、値を保存先へ直接送る、既存ページへ自動適用。

#### 項目名と操作の2列の小窓

- 役目: 右上の道具から、関連する表示操作をまとめて開く。
- 見た目: `workspaceFilterPopover(document, { trigger, appearance: 'panel', content })`。372px幅、上40px、角14px、padding上下6px。`workspaceControlRow(document, { label, control, tight })` は左92px・右可変、左右16px、通常44px・tight38px。右に操作をそろえる。影は `--bb-shadow-control-panel`。
- 状態・動き: 160ms `--bb-filter-enter-ease`。既存のEsc・外側・終了中inert・focus復帰・reopen取消・destroyを使う。reduced motionは即時。内容の選択・初期化の処理はホストが持つ。
- 禁止: 設定項目や権限の内蔵、画面のDOM監視で移設、下位popupのEscで親まで閉じる。

#### 右から開く入力枠

- 役目: 共通のモーダル内へ道具、札、項目、決定操作を合成する。
- 呼出: `workspaceInputFrame(document, { title, opener, onClose, tools, preview, rows, footer, showTitle })`。返値は `workspaceDetailDrawer` の `dialog/setContent/setTitle/open/close/dispose` と、`top/tools/fields/footer` の各Node。札自身に見出しがある詳細では `showTitle: false` で重複を避ける（読み上げ名は保持）。`workspaceFormRow(document, { label, control, required, top })` をrowsへ渡す。id付きcontrolのlabelを関連付け、必須は※とaria-required、ネイティブ入力にはrequiredを設定する。
- 見た目: 幅600px（viewport以下）、canvasの上部・白い入力面。道具がある時は上部52px、ない時は上部22px。札slot、項目は左96px・右可変・高さ52px、focus-withinで下に紺2px。項目面は6px 28px 24px、下の決定行は14px 28px、主ボタンは紺。影・overlayは入力枠専用トークン。
- 状態・動き: drawer本体のshowModal、Esc、背景クリック、focus trapと戻り、非同期応答で勝手に開かない制御を共有する。入力枠だけ220ms `cubic-bezier(.2,.7,.2,1)` で右端から全面移動する。既存drawerの既定の見た目は変えない。reduced motionでは即時。非同期保存・エラー・必須項目の組合せ・未保存確認はホストの責務。
- 禁止: 保存・権限・業務状態遷移を部品内で判断、応答で再open、画面破棄後のDOM復活。

#### 一覧の札の行

- 役目: ホストの任意のセルを白い札へ並べる。
- 呼出: `workspaceCardRow(document, { key, label, cells, stripe, selected, onSelect, preview })`。`stripe` はホストの色またはtoken参照、列定義は親の `--bb-card-columns`。`onSelect(key)` があればnative button、なければ通常Node。セルのNodeをそのまま渡せる。
- 見た目: 最小48px、下3px、角8px、左右16px/22px、列間20px、左に5pxの色帯。hoverは影だけを150msで表示し、selectedは紺2px枠。previewは52px・列間16px・常設の薄い影。
- 状態・動き: `workspaceRowMotion(root)` の `capture()` → ホストが並べ替え/再描画 → `play()`。`data-key` で前後の位置を対応させ、既存行だけを320ms `cubic-bezier(.2,.8,.2,1)` で新位置へ移す。reduced motionは動かさない。`destroy()` で進行中の動きを取り消す。
- 禁止: 業務優先度や表示順の内蔵、重複key、focusできるセル操作をbutton行内へ入れる。複数の操作が要る行は非button行へホストが適切な意味付けを行う。

#### 互換性と検証

既存export/class/必須入力は削除・変更しない。未指定のtab、search、combobox、drawerの見た目と選択契約を保持する。共通tokenの既定色は変更せず、新しい影・slate・動きの値だけ追加する。合成fixtureで見た目・選択・キー・開閉・focus・reduced motionを検証し、npm tarballへ個人情報・ローカル照合資料を混ぜない。
