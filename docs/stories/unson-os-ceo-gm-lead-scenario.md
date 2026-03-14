# ストーリー: UnsonOS 経営者・事業責任者・現場責任者の通しシナリオ

## 文書メタ情報

- 状態: 有効
- 種別: ストーリー
- 主題: 経営者・事業責任者・現場責任者の通しシナリオ
- 親文書: [UnsonOS ズーム契約](../architecture/unson-os-zoom-contract.md)
- 派生元: [UnsonOS ズーム契約](../architecture/unson-os-zoom-contract.md)
- 関連文書: [UnsonOS UI コンセプト](../architecture/unson-os-ui-concept.md), [現場責任者コンソールストーリー](./unson-os-lead-control-console-story.md)
- 置換: なし

## ユーザーストーリー

**誰が**: 複数会社を束ねる経営者、1 社を預かる事業責任者、区画を預かる現場責任者  
**何を**: 同じ 会社 / project / 施策 を、違う高度から連続して見て、判断と上申を往復させたい  
**なぜ**: 世界観が経営者用の見た目で終わらず、経営者 / 事業責任者 / 現場責任者が同じ組織を運営している感覚を成立させたいから

## 背景

- 現場責任者面だけ見ると、実務語の board / flow / decision のほうが強く見える
- しかし UnsonOS の本命は CEO 視点を含む経営 OS であり、上位世界観自体は必要である
- 問うべきは世界観の有無ではなく、`経営者 -> 事業責任者 -> 現場責任者` の導線が同じ object と同じ state chain を共有しているかどうかである
- そのためには、見た目の統一ではなく `zoom contract` が必要になる

## シナリオ

### シーン 1: 経営者が危険な会社を見つける

1. 経営者は `Holding Region` 上で 4 会社を俯瞰する
2. ある `Company City` が赤く、`risk` と `blocked` が高まっているのを見る
3. 経営者はその city を選び、会社単位の `判断待ち一覧` を開く
4. 経営者は「この会社の allocation を維持するか、hold するか」を判断対象として認識する

### シーン 2: 事業責任者が company 内の原因を掘る

1. 経営者が選んだ company context を保持したまま、事業責任者 view に降りる
2. 事業責任者は `Company City / District` を見て、特定の `Project / Program` に施策群の滞留が集中しているのを把握する
3. 事業責任者は `reprioritize` 候補と `capacity misallocation` を確認する
4. 事業責任者は、その cluster を預かる現場責任者の面へ降りる

### シーン 3: 現場責任者が停滞中の施策を処理する

1. 現場責任者は `District / Building / Flow` で、`停滞中の施策` を開く
2. `即応パネル` で即応壁打ちを行い、ボトルネック、経路変更候補、不足証跡を把握する
3. まだ判断に迷う場合は `論点整理室` を開く
4. `論点整理室` では、文脈が事前読み込みされた状態で
   - 論点整理
   - 反対意見
   - リスク確認
   - 事業責任者向け上申準備
   を行う
5. 最後に `上申資料` か `判断メモ` を作成する

### シーン 4: 事業責任者が上申を裁く

1. 現場責任者が作った `上申資料` は事業責任者の `判断待ち一覧` に入る
2. 事業責任者は packet に紐づく evidence と rationale を見て
   - reroute で止めるか
   - capacity を増やすか
   - 会社単位の論点として経営者に上げるか
   を決める

### シーン 5: 経営者が上位判断を下ろす

1. 事業責任者が会社単位の論点を上げた場合、経営者の会社別判断待ち一覧に戻る
2. 経営者は
   - allocation を増やす
   - hold する
   - stop する
   - 会社横断で資源を移す
   のどれかを決める
3. その decision は事業責任者の `reprioritize / capacity` に落ち、現場責任者の `reroute / gate / artifact request` に翻訳される

## 目指す状態

- 経営者 / 事業責任者 / 現場責任者が別の画面を見ていても、同じ object chain を追っている
- 経営者の `company risk` が、事業責任者の `施策群 issue`、現場責任者の `checkpoint / evidence gap` に分解される
- 現場責任者の `上申資料` が、事業責任者と経営者の意思決定材料としてそのまま使える
- ただ filter されるだけではなく、縮尺ごとに主操作と要約粒度が変わる
- world layer が decorative skin ではなく、運営座標系として機能する

## 受け入れ条件

| AC | 内容 | 検証方法 |
|---|---|---|
| AC1 | 経営者 / 事業責任者 / 現場責任者の 3 役割が、同じ 会社 / project / 施策 を別縮尺で見ていることが明記される | ストーリーを読んで object identity が役割間で切れていないことを確認 |
| AC2 | 経営者の高位リスクが事業責任者 / 現場責任者の下位状態へ還元される | シナリオ中で `company risk -> cluster issue -> checkpoint / evidence gap` の分解が書かれていることを確認 |
| AC3 | 現場責任者の上申が事業責任者 / 経営者の意思決定 object に変換されて戻る | `Escalation Packet` が上下遷移の材料として扱われることを確認 |
| AC4 | 役割ごとに変わるのが `縮尺 / 要約粒度 / 主操作` であり、object 自体ではないことが明記される | role 差分が projection 差分であることを確認 |
| AC5 | 全体俯瞰面が decorative ではなく、同一 object への zoom 入口として使われている | `City -> District -> Building / Flow` の導線が明示されることを確認 |
| AC6 | 経営者用の気持ちいい地図と現場責任者用の実務画面が、見た目だけではなく decision chain / evidence chain で連続している | 同じ判断が上下で別粒度に変換される説明があることを確認 |

## 主な失敗条件

- 経営者の city alert が、事業責任者 / 現場責任者で別 object に見えてしまう
- 事業責任者への遷移がただの filter になり、主操作が変わらない
- 現場責任者の `Escalation Packet` が上位 queue に載らず、その場のメモで終わる
- 経営者の `hold / stop / allocate` が、現場責任者の具体行動へ翻訳されない
- world map が decorative で、運営判断の入口を変えない

## 優先度

**P0** - 世界観が経営者用の見た目で終わるのを防ぎ、UnsonOS 全体の運営座標系を固定するため

## 依存関係

- [`unson-os-zoom-contract.md`](/Volumes/UNSON-DRIVE/brainbase-worktrees/session-1773022945038-brainbase/docs/architecture/unson-os-zoom-contract.md)
- [`unson-os-canonical-domain.md`](/Volumes/UNSON-DRIVE/brainbase-worktrees/session-1773022945038-brainbase/docs/architecture/unson-os-canonical-domain.md)
- [`unson-os-lead-control-console.md`](/Volumes/UNSON-DRIVE/brainbase-worktrees/session-1773022945038-brainbase/docs/architecture/unson-os-lead-control-console.md)
- [`unson-os-terminology.md`](/Volumes/UNSON-DRIVE/brainbase-worktrees/session-1773022945038-brainbase/docs/architecture/unson-os-terminology.md)
