---
story_id: story-judgment-history-speed-ui
title: 判断の履歴の読み込みを速くし、見た目を作り直す
requirement_id: 08869080-7105-4cba-942f-50e5de9a9d6e
status: active
created_at: 2026-10-14
---

# 判断の履歴の読み込みを速くし、見た目を作り直す

要件: 08869080-7105-4cba-942f-50e5de9a9d6e

## Problem Frame

判断の履歴を開くたびに、同じセッションの journal をファイルの更新時刻が変わっていなくても読み直している。resolution id ごとの照合も、1件ずつ journal を走査する形になっている。画面では、取得元の内部コードと再読み込みが帯の中で折れ、一覧の始まりが画面の下の方に寄っている。全件数が未確認のときに「0件」と言い切らない、という既存の約束は残す。

## Constraints

- キャッシュのキーは session、turn、ファイル名、mtime とする。mtime が変わったらそのファイルだけ読み直す。
- resolution id の照合は1回の journal 読みでまとめて行い、結果の順は要求の順に合わせ、無い id は null にする。
- journal の読み取りには並列上限を置く。一覧は新しい順で、1ページちょうどなら次ページを出さない。空の journal は0件で次ページなし。応答には Server-Timing を付ける。
- 画面の受け入れは design.md の Given/When/Then 1〜14。帯は1つ。一覧があるときの再読み込みは1つで、最後に確かめた時刻を隣に置く。失敗して一覧がないときだけ、帯の中に再読み込みを置く。
- 未知の理由コードは「理由を確かめられません」とし、コードは「取得元の詳細」だけに出す。ラベルのない参照は「名前のない参照 n件」。judgment.status が unknown のときは「状態は未記録」。
- 読み込みが 0.3 秒より長いときだけ骨組みを出す。10秒を超えたら「時間がかかっています。届いた分だけ先に見られます。」。prefers-reduced-motion のときは骨組みを光らせない。
- brainbase-unson は使わない。judgment prepare、DAG の起動、採択、判断 JSON の手書きはしない。
- このリポジトリの外にあるアプリと brainbase-unson は、この作業環境から参照できない。findByResolutionId はこのリポジトリには無く、record_id が resolution id である。一括照合は OSS の findByResolutionIds と GET /api/judgment-history/resolutions を境目にする。

## Options

- journal の再走査を、ソースインスタンスが持つ (session, turn, file, mtimeNs) キャッシュにする。並列読みは mapWithConcurrencyLimit、既定の上限は 8。上限に入れるファイルは新しい mtime から選ぶ。
- 画面は ui/judgment-history.js の既存コントローラを、モックの帯・1行の要約・4列・読み込み中の骨組みに合わせる。このリポジトリの外のアプリへは、この OSS の画面を取り込む側で版を上げる。

## 受け入れ条件

- [ ] AC-01: 同じソースで journal を再読したとき、mtime が同じファイルは readFile しない。mtime が変わったファイルは読み直す。
- [ ] AC-02: findByResolutionIds は 1〜100 件を1回の read で返し、欠ける id は null、順は要求どおり。
- [ ] AC-03: 同時に読む journal ファイル数は read_parallel を超えない。空 journal は total 0 で次ページなし。件数が limit と一致し残りが無いページは has_more false。
- [ ] AC-04: home 応答の Server-Timing に journal、page、cache、parallel、newest-first が出る。
- [ ] AC-05: 一部取得の帯は「一部の記録だけを表示中」が1つで、取得元は「名前：状態（理由）」。再読み込みは帯の外に1つで、確かめた時刻が隣にある。
- [ ] AC-06: 未知の理由コードは帯に出さず「理由を確かめられません」。コードは取得元の詳細だけ。ラベルのない参照は一覧で「名前のない参照 n件」、ID は詳細の「記録ID」。unknown の判断状態は「状態は未記録」。
- [ ] AC-07: 読み込みが遅延を超えたら、本物の見出しと列の骨組み5行、押せない再読み込み、「確認しています…」（role=status）。届いた行は選べ、未到着の取得元は「確認中…」。10秒超過の文言を出す。reduced motion では is-reduced-motion を付ける。
- [ ] AC-08: 取得失敗の帯は role=alert で「データが0件とは確認できていません」と再読み込みを帯の中に出す。全件数が未確認の空一覧は「0件とは確認できません」とし、件数を0件とは言い切らない。
