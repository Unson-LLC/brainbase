# 共有ローディングステージ（Growin UR-009 / RQ-077）

## 目的

GrowinのUR-009（RQ-077）として、画面全体で使える friendly で中央寄せのローディング表示を共通化する。これまで画面ごとに違っていた読み込み中の見た目と通知を揃え、何を待っているのかをその場で伝える。

## コンポーネントAPI

`ui/workspace-kit.js` の `workspaceLoadingStage(doc, { title, detail, slow })` を使う。

- `title` の既定値は `準備しています`。
- `detail` は非空文字列のときだけ表示する。
- `slow: true` で `is-slow` が付き、`detail` がない場合は「時間がかかっています。このままお待ちください。」を表示する。
- 返り値は `role="status"`、`aria-live="polite"`、`aria-busy="true"` を持つ `div.bb-ws-loading-stage`。中に3つの装飾用ドット、タイトル、任意の詳細を持つ。

## 利用画面

- 目的と現状（`ui/foundation-overview.js`）: 単一画面の読み込み中と、コレクションで利用可能なsourceがまだ0件のときに表示する。sourceが一部でも読めている場合は従来どおり内容と集約ローディング通知を出す。
- 判断の履歴（`ui/judgment-history.js`）: 読み込み中で、まだ行が1件も届いていないときに表示する。行が届いた後は従来どおり行・スケルトン行・サマリーを表示する。

## reduced motion

`prefers-reduced-motion: reduce` ではドットのアニメーションを止め、`opacity: .7` と `transform: none` で静止表示にする。

## 失敗時

読み込み失敗は中央のステージに残さず、従来どおり右上の通知（`onNotice` / `workspaceErrorCard` / 判断履歴の通知スタック）で伝える。失敗後にステージが残り続けることはない。
