---
story_id: story-world-business-exits-v1
title: 世界の都市から、その事業で使う外の道具へ出られるようにする（OSS側）
status: draft
created_at: 2026-10-09
implementation_started: false
owner_repository: brainbase
depends_on: ["story-world-for-organization-web-v1"]
---

# 世界の都市から、その事業で使う外の道具へ出られるようにする（OSS側）

## 利用者成果

世界で事業の都市を見ている人が、その事業で使う外の道具（社内の運用画面、ファイル置き場、リポジトリなど）を、同じ画面の中で見つけて開ける。開けるのか、権限が足りないのか、状態を読めないのかも、そこで分かる。道具の名前やURLを、別の場所で探し直さずに済む。

## 背景

- 世界は、事業を都市、案件を区画、仕事を通りの現場として描く、読み取り専用の画面である。リンクの有無は「通りへの道」で、読めないものは霧と「0件とは確認できません」で表している。
- 今の世界から外へ出る口は、`projectHref`（プロジェクトの画面）と`taskHref`（仕事の画面）の2つだけで、どちらもホストの中の画面へ移る。事業で使う外の道具へ出る口は無い。
- 組織版では、Tech Knightの社内基盤をBrainbaseへ寄せる検討で、組織版の最初の画面を世界にし、世界から既存の道具へ移れるようにすると佐藤さんが決めた（2026-10-09）。組織側の画面・台帳・権限は`brainbase-organization`の`story-organization-world-first-and-tool-exits-v1`で扱う。
- 共通UIに組織固有の変更が要るときは、組織版で直さずOSSへオプションを足す（組織版`AGENTS.md`）。この部品は、組織・メンバー・役割・申請の概念を持たずに、一人の持ち主でも動くようにする（本リポジトリ`AGENTS.md`）。
- 判断の基準：哲学`phi_visible_or_not_value`（見えなければ価値ではない。2026-10-09登録）。道具があっても、世界の中で見えず、たどり着けなければ価値にしない。

## 受入条件

- [ ] AC-01: `createWorldView`に任意の`businessExits(business)`を渡せる。戻り値（Promise可）は`{ status, read_at, exits }`で、`status`は`complete`・`partial`・`failed`・`not_connected`のどれか。`exits`の各要素は次を持つ。
  - `id`・`label`（例：「Tech Knight HQ · 候補の審査」）
  - `href`（`https:`だけ。ほかのスキームは描かずに捨て、捨てた件数を出す）
  - `state`：`available`・`restricted`・`unknown`・`unavailable`
  - 任意の`note`（ログインの方式など、1行）
  - 任意の`action`（`{ label, href }`。ホストが与える。例：申請）
  - 任意の`attention`（`{ count, label, as_of }`）
- [ ] AC-02: `businessExits`を渡さなければ、今の世界と同じ表示・同じDOMになる（既存テストがそのまま通る）。
- [ ] AC-03: 都市の詳細（canvasの右端のパネル、standardのrail）の既存の欄の後に「この事業の道具」の欄を足す。各行に`label`・状態の言葉・`note`・「開く」リンク（新しいタブ、`rel="noopener noreferrer"`）を出し、`action`があればその操作を並べる。
- [ ] AC-04: 状態の言葉は持ち主が与えられる（`story-world-generic-graph-v1`の語彙と同じ仕組み）。既定は「使える」「権限が必要」「未確認」「読めない」とする。
- [ ] AC-05: `status`が`failed`・`not_connected`のとき、欄は空にせず「道具を読めません（0件とは確認できません）」と理由を出す。`partial`のときは「一部だけ読めた」と出す。読めた0件だけを「この事業の道具は登録されていません」と出す。
- [ ] AC-06: `attention`がある道具は、件数・`label`・`as_of`の時刻を並べて出す。`count`が無い、または数でないときは件数を出さず「件数は未確認」と出す。0として扱わない。
- [ ] AC-07: canvasでは、都市の外れに道具の数だけ「駅」を置く。駅の姿で状態を表す（`available`＝明かり、`restricted`＝改札が閉じた駅、`unknown`・`unavailable`＝霧の駅）。`attention`があれば駅の看板に件数を出す。駅を選ぶと都市の詳細を開き、その道具の行を選んだ状態にする。駅からは直接外へ移らない。
- [ ] AC-08: 世界の見方（凡例）に、駅の姿と状態の対応を足す。
- [ ] AC-09: 3Dを表示できない環境の一覧表示でも、都市ごとに同じ「この事業の道具」の欄を出す。
- [ ] AC-10: 世界は道具の情報を書き換えない。`businessExits`の応答が、別の都市を開いた後に届いたときは、古い都市の欄を開き直さない（既存の都市ごとの読み込みの保護と同じ）。

## 対象外

- 組織の道具の台帳、メンバーの権限から`state`を決めること、申請の作成（`brainbase-organization`の別Story）。
- 全社で使う道具（どの事業にも属さないもの）を描く「中央駅」。都市ごとの出口を確かめてから、別Storyで決める。
- `attention`の件数を各道具から集める仕組み。ここでは、ホストが渡した値を描くだけにする。
- 世界の中から外の道具の記録を書き換えること。

## 検証

- `tests/world-extension.test.ts`に、`businessExits`の4つの`status`、`https:`以外の`href`を捨てること、`attention`の`count`欠落を「件数は未確認」と出すことのテストを足す。
- 世界のDOMテストで、`businessExits`無しのDOMが変わらないこと（AC-02）、都市の詳細と一覧表示に同じ欄が出ること（AC-03・AC-09）を確かめる。
- 駅の配置と姿は、scene-runtimeテスト（実THREEの計算と、GPUを使わないレンダラー）で、状態ごとの部品が置かれることを確かめる。実際の見た目の受け入れは、組織版へ統合した後のブラウザでの確認に委ねる。
- 公開は、既存の公開手順に従って新しいpackageの版を出し、組織版の依存pinを上げてから確かめる。
