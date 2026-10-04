---
story_id: story-personal-value-proof-home-cold-read-v1
title: しばらく開かなかった後でも、判断の見返しの一覧がすぐ出る
status: active
created_at: 2026-10-04
implementation_started: true
owner_repository: brainbase
depends_on: ["story-personal-value-proof-review-v1", "story-personal-human-decision-answer-record-v1"]
external_dependencies: []
---

# しばらく開かなかった後でも、判断の見返しの一覧がすぐ出る

## 利用者成果

所有者として、しばらく開かなかった後に判断の見返し画面を開いても、一覧がすぐ出てほしい。速くするために、新しく保存された判断や「会話で先に進んだ」の表示が古いまま出たり、判断journalが読めないのに0件として出たりしては困る。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: 判断journalからの value-proof の読み取り（`readJudgmentValueProofJournal`）と、見返しのHTTP（`GET /home`、`POST /answers`、`POST /feedback`）での使い方

## 既存実装との差分

2026-10-04、常駐の Personal Web で、しばらく読まれなかった後の最初の `GET /api/value-proofs/home` が 28.8秒・44.6秒・60秒超（時間切れ）かかった。2回目以降は0.2〜0.8秒。読み取りは、リクエストのたびに判断journalの全フォルダ（2,573、約6万4,700件、3.1GB）を1つずつ順に一覧していた。value-proof は20件だけである。温まった状態の内訳は、フォルダの一覧が約249ms、value-proof の読み取りが約6ms、会話が先に進んだかの判定が約4msだった。

## 受入条件

- [ ] AC-01: 見返しのHTTPは、前に一覧したフォルダのうち、その後に変わっていないものを一覧し直さない。変わったかどうかはフォルダの識別子と変更時刻で見る。増えたファイル・消えたファイル・作り直したフォルダは、次の読み取りに必ず出る。
- [ ] AC-02: value-proof の中身と「会話で先に進んだ」の判定は、読み取りのたびに読み直す。キャッシュのせいで、壊れた記録が受理されたまま残ったり、後の `.final.json` が来たのに会話で先に進んだが付かなかったりしない。
- [ ] AC-03: 判断journalが無い・読めない場合は従来どおり利用不可を返し、前回の結果で0件や成功として見せない。フォルダが読めなくなった場合も、前回の一覧で隠さず失敗させる。形式の誤り（`rejected`）と記録の停止の可能性（`possibly_stalled`）の意味は変えない。
- [ ] AC-04: 常駐の Personal Web で、しばらく読まれなかった後の最初の home が、改善前（28.8〜60秒超）より大きく短くなったことを実測で確かめる。

## 対象外

value-proof の索引や置き場所の変更（判断のホスト側の書き込みの変更）、プロセスの外へのキャッシュの保存、再起動直後の最初の読み取りの短縮、判断journalの整理・削除。

## 検証と完了

変わったフォルダだけを一覧し直すこと、中身と会話の判定を毎回読み直すこと、利用不可と失敗を隠さないことを、一時ディレクトリの実ファイルと実サーバーで確かめる。利用者に効いたかは、常駐の Personal Web へ反映した後、しばらく読まれなかった状態で最初の home の時間を計り直して確かめる。
