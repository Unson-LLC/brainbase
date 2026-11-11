# 開発判断: ui/ のWebの書き方を modern-web-guidance に合わせる

- story_id: `story-modern-web-guidance-standard`
- 日付: 2026-11-12
- 根拠決定: 佐藤さんの指示（2026-11-12）。「助言に頼る部分を受け入れる」案で進める。

## Story

UIを書く人とエージェントとして、`ui/` を現在のWebの機能で書きたい。古い書き方が学習データ由来で混ざるのを、書く前の参照と検査の両方で防ぐためである。

## 受け入れ条件

1. `workspaceDetailDrawer` と `workspaceDialog` は `closedby="any"` を持つ。`closedby` に対応するブラウザでは、自前のクリック判定を登録しない。
2. 未対応のブラウザでは、これまでと同じポインタ位置の判定で閉じる。
3. どちらの経路でも、drawerの終了アニメーションとfocusの復帰は変わらない。
4. `npm test` が `ui/` をスキャンし、指摘が1件でもあれば落ちる。
5. スキャナーの版は lockfile で固定し、利用状況の送信は止める。
6. 書く前に読む手順を、リポジトリのSkillと共通UIの規約から辿れる。
7. 対応ブラウザの基準を、Baselineの区分ごとに共通UIの規約へ書く。

## Scope OUT

- 使っていない新しい機能（container query、anchor positioning、view transition など）の一括導入。画面ごとに、体験が良くなるものだけ別のStoryで扱う。
- 組織版とunsonの指摘（4件と3件、9月時点のcheckoutで計測）。取り込み後にそれぞれのリポジトリで扱う。

## 残る限界

スキャンが機械的に見るのはガイドの約20%で、残りはSkillという助言に頼る。方針「注意喚起より決定論的ガード」とぶつかる点として、佐藤さんが受け入れた。
