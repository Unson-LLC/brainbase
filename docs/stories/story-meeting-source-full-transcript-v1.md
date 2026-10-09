---
story_id: story-meeting-source-full-transcript-v1
title: Plaud・Tactiqの会議を、途中で切れない全文として読み出せる
status: planned
created_at: 2026-10-09
implementation_started: false
owner_repository: brainbase
development_mode: SIMPLIFICATION
depends_on: []
---

# Plaud・Tactiqの会議を、途中で切れない全文として読み出せる

会議を録音・文字起こししている利用者として、PlaudとTactiqの会議を、長い会議でも途中で切れずに最後まで読み出したい。読めない会議は、読めない理由と次に読める時期が分かるようにしたい。

## 完成時の利用者成果

つないだアカウントと期間を指定すると、その期間の会議がすべて一覧に出る。各会議の全文は、最後のページまで読めたときだけ「全文」として返り、生成待ち・取得枠切れ・権限不足・取得不能は、理由と次に試す時刻とともに返る。途中までの全文を全文として扱わない。

## 受入条件

- [ ] AC-01: Plaudの全文を、`get_transcript`の`next_cursor`が無くなるまで読み、話者と時刻つきの全文と、全文から決まる`digest`を返す。50発話を超える会議でも欠けない。
- [ ] AC-02: Plaudの一覧を、期間の日付で絞ったうえで最後のページまで送る。件数がページの大きさを超える期間でも会議が漏れず、日付の時間帯の差で期間の端の会議が落ちない。
- [ ] AC-03: Tactiqの全文を、`get_transcript`のページを`hasMore`が偽になるまで読む。期間の一覧は`search_meetings`で取り、上限の50件に達した期間は分けて取り直す。
- [ ] AC-04: Tactiqの全文の読み取りの上限（1人1時間に異なる会議10件。同じ時間内に読み直した会議は数えない。`get_transcript`の定義）を超えない。超える会議は`rate_limited`と次に試す時刻で返す。
- [ ] AC-05: Teamプランでない・全文の許可が無い・認可が切れた・時間切れを、区別できる理由で返す。providerの失敗を「会議が無い」や空の全文にしない。Tactiqの`access_required`は、`get_access_options`で理由（プラン・接続・AIクレジット・プレビューだけの共有）と次の操作を取り、接続全体の理由と、その会議だけの理由（プレビューだけの共有）を分ける。
- [ ] AC-06: 録音サービスが作った要約（Plaudのnote、Tactiqの要約）は補助の情報として分け、全文の代わりにしない。
- [ ] AC-07: 読み出しは、ツールを呼ぶ関数を外から受け取り、認証・資格情報・保存先を持たない。話者つきの文への展開と`digest`は、今の`brainbase-unson`の正規化と同じ結果になる。
- [ ] AC-08: 実際のPlaudとTactiqのアカウントで、2026-09-01以降の会議を読み出し、全文の長さ・ページ数・読めなかった会議と理由を記録する。読み出しだけで、取り込み・投稿はしない。

## 範囲と境界

- 置き場はOSSの公開package（`@unson/brainbase-mcp`の新しい出口）。`brainbase-unson`の所有台帳で`meeting-source-sync`の移設先とされている部品に当たる。
- 接続（OAuth）・資格情報・接続ごとの同期の状態・取り込み先は扱わない。接続ごとの同期は`story-meeting-source-connection-sync-v1`、本番の接続は組織版のStoryで行う。
- `brainbase-unson`の今の同期に組み込むのは、このStoryの公開版を取り込むunson側のhost Storyで行う。
- Nangoなど外部の接続基盤は扱わない。

## 開発判断

全体はSIMPLIFICATION。新しい取り込みの仕組みは作らず、今の読み出しの欠け（Plaudの全文が50発話で切れる、Tactiqは要約しか読まない、一覧が1ページ目だけ）を直して、移設先の共通部品に置く。

全体の分割と根拠: [会議ソース（Plaud・Tactiq）の接続と取り込み：引き継ぎ設計](../../../brainbase-project/docs/architecture/meeting-source-connection-design.md) §2・§5.3・§8。

## 検証

- 影響テスト：Plaud・Tactiqの実際の応答の形を写した固定データで、ページ送り・上限・失敗の分類・正規化を確かめる。
- 実アカウント：AC-08の読み出しの記録。認可はアカウントの持ち主が行う。
- 未確認のまま残すもの：Tactiqの上限の公式の記載。
