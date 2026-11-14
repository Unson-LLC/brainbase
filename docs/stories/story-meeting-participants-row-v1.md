---
story_id: story-meeting-participants-row-v1
title: 議事録の参加者の行で、結べた人を名前で、結べなかった人を未確認の札で見せ、その場で結ぶ
status: in_progress
created_at: 2026-10-18
implementation_started: true
owner_repository: brainbase
development_mode: NORMAL
depends_on: ["story-meeting-minutes-connections-v1"]
---

# 議事録の参加者の行で、結べた人を名前で、結べなかった人を未確認の札で見せ、その場で結ぶ

議事録を読む人として、この会議に誰が出ていたかを名前で見たい。名前が分からない参加者（Google Meet の表示名「白幡」など）は、議事録の画面を離れずにその場で人物に結びたい。

## 背景

- 前提台帳 D17（brainbase-project、佐藤採用 2026-10-17）。参加者の行で、結べた人は名前で「人と会社」へのリンクにし、結べなかった人は「白幡（未確認）」の札にする。札を押すとその場のパネルで候補を根拠つきで出し、「この人」「新しい人として登録」「人ではない」「あとで」を選ぶ。
- 共通UIは OSS に置き、組織版は読み書きの受け口だけを渡す（P16・D8）。結び付きの記録・権限・候補の計算はホストが持ち、共通UIは推測しない（P9）。
- 組織版側の受け口と書き込みは brainbase-organization の story-meeting-participant-link-v1。

## 受入条件

- [ ] AC-01: `createMeetingMinutesUI({ meetingParticipants })` に `read`・`candidates`・`link`・`unlink` を渡すと、詳細の見出しの下に「参加者」の行が出る。渡さないホストでは何も出さない。
- [ ] AC-02: `read` の `status: 'none'` なら行を出さない。`unavailable`・例外・形の違いは「参加者を読み込めませんでした」と出し、詳細は壊さない。古い詳細の応答は新しい詳細を上書きしない。
- [ ] AC-03: `linked` の参加者は名前を `href`（同じサイト内のパスか http(s)）へのリンクにし、表示名を添える。`unconfirmed` は「表示名（未確認）」のボタン、`not_person` は表示名だけ。`removable` なら「取り消す」を添える。`redrafting` なら「作り直しています」と出す。
- [ ] AC-04: 札を押すとその場でパネルを開き（同時に1つ）、`candidates` の人物・名刺・会社を根拠つきで並べ、同じ表示名の他の議事録の件数を出す。「この人」「この名刺の名前で登録」「新しい人として登録（名前を確かめる）」「この会社（人ではない）」「人ではない（結ばない）」「あとで」を置く。一括の操作は置かない。
- [ ] AC-05: 操作は `link` を1回呼び、送信中はボタンを止め、結果（作り直す件数）を読み上げてから行を読み直す。失敗はパネルに理由を出す。同じ名前の人がいると返されたら、その人の「この人」を出す。
- [ ] AC-06: 「取り消す」は `unlink` を呼び、行を読み直す。

## 範囲外

- 受信箱・世界・「人と会社」の未確認の参加者の並び（D17 段2）。
- OSS Personal の議事録への組み込み（OSS Personal に議事録の参加者の記録が無い）。
