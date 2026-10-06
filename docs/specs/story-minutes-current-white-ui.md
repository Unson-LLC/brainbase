# 議事録UIを現行白基調へ合わせる Spec

story_id: `story-minutes-current-white-ui`

## 目的

OSSの議事録画面を含むWebシェルを、現行組織版の白基調UIへ揃える。現行の共有トークン、サイドバーの密度、ナビゲーション状態、ワークスペースと詳細レールの余白を基準にする。

## 受入条件

### INV-001 白基調と共通色

議事録画面を含むOSS Webシェルは、現行組織v7と同じ次の表示を使う。

- レール: `#ffffff`
- キャンバス: `#f6f6f8`
- 本文: `#202124`
- アクセント: `#5b4bd8`

対象は `ui/brainbase-tokens.css` と `ui/local-web-shell.css` の共有UI層であり、議事録APIと保存契約は変更しない。

### INV-002 サイドバーの密度と状態

サイドバーは現行組織v7と同じ密度・状態表現にする。

- sidebar padding: `18px 12px 14px`
- brand padding: `0 10px 22px`
- brand font-size: `19px`
- nav gap: `2px`
- nav link min-height: `38px`
- nav link gap: `11px`
- nav link radius: `7px`
- nav link inline padding: `10px`
- 選択状態: accent文字色、accent-soft背景、影なし

### S-001 ワークスペースと詳細レール

デスクトップでは、ワークスペースのpaddingを `20px 24px 52px`、詳細レールのpaddingを `28px 22px 36px` に揃える。1260px以下とモバイルの既存レイアウト切替は維持する。

### INV-003 状態色の可読性

白背景上の警告・危険状態は、背景用soft色を文字色に流用せず、通常の `warning` / `danger` tokenで表示する。議事録APIおよびデータ保存の挙動は変更しない。

### C-001 検証

対象テストとビルドが成功し、実画面のcomputed styleで白レール、ナビ選択状態、議事録画面の操作可能性を確認できる。

## 対象ファイル

- `ui/brainbase-tokens.css`
- `ui/local-web-shell.css`
- `ui/meeting-minutes.css`（共有token参照の確認対象。固有CSSの追加は不要）

## 検証コマンド

```sh
npm test -- tests/ui/local-web-shell.test.mjs tests/ui/meeting-minutes.test.mjs
npm run build
git diff --check
```

実画面はOSS lineageハーネスで議事録画面を開き、白レール、選択中ナビ、本文・版確認操作を確認する。外部ハーネスのデータはリポジトリ外で管理し、検証時に既存データを保持する。

## 非対象

- 議事録API、native storage、外部保存先、Googleカレンダー、Google Drive、GitHub連携
- 組織版コードの変更
- データ移行、外部サービスへの書き込み、push、merge
