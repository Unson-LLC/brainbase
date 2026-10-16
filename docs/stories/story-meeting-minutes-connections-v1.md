---
story_id: story-meeting-minutes-connections-v1
title: 議事録から、その会議で生まれたもの・残した場所・知らせた先へ移れる
status: in_progress
created_at: 2026-10-16
implementation_started: true
owner_repository: brainbase
development_mode: SIMPLIFICATION
depends_on: ["story-meeting-minutes-context-labels-v1"]
---

# 議事録から、その会議で生まれたもの・残した場所・知らせた先へ移れる

議事録を開いた人として、その会議がどのプロジェクトのもので、何（タスク・判断）が生まれ、どこ（GitHubなどの保存先）に残り、どこ（Slackなどの共有先）に知らされたかを1か所で見て、それぞれの記録へそのまま移りたい。

## 背景

- 2026-10-16、佐藤さんは組織版の議事録の画面で「ただ見るだけで、できることが少なすぎる」と指摘した。プロジェクトへのリンクが無い、タスクや判断が全く見えない、保存先（GitHub）と共有先（Slack）が見えない、の4点。
- 議事録が仕事（タスク・判断）への入口になることは、Brainbaseの価値の中心（台帳P17、哲学「見えなければ価値ではない」）。
- 議事録の正本（`MeetingRecord`・`MinutesDocumentRecord`・`MinutesVersionRecord`）は、プロジェクト・タスク・判断・保存先・共有先の欄を持たない。これらはホスト（組織版など）の記録にある。共有UIはホストが解決した値を表示するだけで、所属や結び付きを推測しない（台帳P9・P16）。
- 予定とのつながり（`story-meeting-minutes-page-review` の受け入れ条件9〜11）は別の作業で扱う。ここでは触れない。

## 受入条件

- [ ] AC-01: `meetingConnections({ meeting, minutes, versions })` を渡すと、詳細の見出しの下に「この会議から」の区画が出て、プロジェクト・タスク・判断・保存先・共有先の5行が並ぶ。
- [ ] AC-02: 各行は、記録があれば項目を並べ、`href` が http(s) か同じサイト内のパスならリンクにする。外部のリンクは新しいタブで開く。それ以外の値はリンクにしない。
- [ ] AC-03: ホストが「無いことを確かめた」（`status: 'none'`）行だけを「なし」と出す。値が無い・形が違う・`status: 'unrecorded'` の行は「記録なし」と出し、0件や「なし」に見せない（P9）。
- [ ] AC-04: ホストが読めなかった行（`status: 'unavailable'`）は「読み込めません」と理由を出し、記録なしとも0件とも区別する。
- [ ] AC-05: `meetingConnections` が例外を投げる、Promise が失敗する、形が違うときも画面を壊さず、5行すべてを「読み込めません」にする。古い詳細の応答は新しい詳細を上書きしない。
- [ ] AC-06: `meetingConnections` を渡さないホストでは、区画を出さず従来どおり表示する。右の「関連」のプロジェクトは、プロジェクトの行に `href` があればリンクにする。
- [ ] AC-07: 表示する値は文字列として描画し、HTMLとして解釈しない。共有UIはこの区画のために見える範囲を広げず、ホストが返した値だけを出す（ADR-022・ADR-023）。

## 範囲と境界

- 共有UIは表示の契約と描画だけを持つ。プロジェクト・タスク・判断・保存先・共有先の解決、権限の判定、URLの組み立てはホストが行う。
- 組織、テナント、Slack、GitHub などの固有の概念を共有UIへ持ち込まない。行の見出しは「保存先」「共有先」とし、項目の名前（例: `#brainbase` や `owner/repo/path.md`）はホストが渡す。
- 予定とのつながり、議事録の編集・取り下げ、一覧の絞り込みは扱わない。

## 実装・検証方針

`createMeetingMinutesUI` に省略可能な `meetingConnections` を足し、詳細の描画のあとに非同期で区画を埋める。詳細の世代番号で古い応答を捨てる。変更は共有UI・スタイル・UIテストと、この Story・Spec に限る。
