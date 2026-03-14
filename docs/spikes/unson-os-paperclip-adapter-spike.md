# スパイク: UnsonOS Paperclip アダプタースパイク

## 文書メタ情報

- 状態: 検証中
- 種別: スパイク
- 主題: Paperclip アダプター
- 親文書: [UnsonOS 現場責任者ランタイム構成](../architecture/unson-os-lead-runtime-architecture.md)
- 派生元: [UnsonOS 現場責任者ランタイム構成](../architecture/unson-os-lead-runtime-architecture.md)
- 関連文書: [UnsonOS 正準ドメイン](../architecture/unson-os-canonical-domain.md), [UI×制御面 整合性マトリクス](../architecture/unson-os-ui-architecture-alignment.md)
- 置換: なし

## 位置づけ

この文書は、`Paperclip` を UnsonOS の **実行基盤 / ガバナンス基盤候補** として短期検証するためのスパイク計画である。  
目的は採用可否を決めることではなく、**UnsonOS の正準ドメインにどう写像できるかを確認すること** にある。

## 先に固定する前提

- `Paperclip` を母艦にはしない
- `Paperclip` をいきなり fork しない
- `UnsonOS` 側で先に正準ドメインを持つ
- `Paperclip` の `company / ticket / heartbeat / board governance / audit` を、正準ドメインへどう写像するかだけを見る

## スパイクで検証したい問い

1. `Paperclip` の `company` は、UnsonOS の `Company` に自然対応するか
2. `Paperclip` の `ticket` は、UnsonOS の `Initiative / Story / Run / Decision` のどれに最も近いか
3. `heartbeat` は UnsonOS の `Run / Checkpoint / 稼働状況` と衝突しないか
4. `approval / board governance / audit log` は、現場責任者コンソールの `判断待ち一覧 / 監査 / 上申` に接続しやすいか
5. `Paperclip` を下に敷いたとき、UnsonOS の管理者向け制御面が `ticket dashboard` に逆流しないか

## 検証しないこと

- `Paperclip` の全面採用判断
- UI を `Paperclip` に寄せること
- world projection の見た目比較
- `Brainbase` の置き換え

## 想定する写像

### 暫定の第一候補

| Paperclip 側 | UnsonOS 側の暫定写像 | 注意点 |
|---|---|---|
| `company` | `Company` | 比較的自然だが、権限・予算境界の持ち方を確認要 |
| `board` | `判断待ち一覧` または `経営判断面の投影` の一部 | board を主画面正本にしない |
| `ticket` | `Initiative` または `Decision item` の候補 | `Run` に寄せると寿命が短すぎる可能性あり |
| `heartbeat` | `稼働状況の要約` または `実行の起床処理` | 進行のチェックポイントと混線しないか確認要 |
| `approval` | `Approval Request` | 現場責任者 / 事業責任者 境界へどう接続するか確認要 |
| `audit log` | `Transcript Trace / Audit ledger` | 主成果物ではなく下層記録として保持 |
| `budget` | `稼働枠の配分` または `会社ガバナンス` | 現場責任者と経営者のどちらが見るかを分ける必要あり |

### 暫定の非採用候補

- `ticket = Story`
  - ストーリーより寿命が長く、管理者の判断オブジェクトに近い可能性が高い
- `ticket = Run`
  - 実行単位に寄せると管理者画面の意味が消えやすい
- `company = Portfolio`
  - ユーザーの現実運用は 4 会社なので粒度が大きすぎる

## スパイクの実施手順

### フェーズ 1: 構造確認

見るもの:

- `company` の境界
- `ticket` のライフサイクル
- `board approvals`
- `heartbeat`
- `audit log`
- `budgets`

確認観点:

- 正準ドメインとの対応しやすさ
- 管理者向けに必要なオブジェクトの過不足
- 強すぎる前提の有無

### フェーズ 2: 写像表作成

最低限、次の写像を 1 枚にする。

- `Paperclip object`
- `UnsonOS canonical object`
- `変換ルール`
- `失われる意味`
- `新たに補う必要があるもの`

### フェーズ 3: 単一ワークフロー接続

検証対象は 1 本だけに絞る。

`停滞中の施策 -> 状況要約 -> 割り振り支援 -> 証跡確認 -> 事業責任者への上申`

この流れで `Paperclip` が提供できるのはどこまでかを確認する。

## 成功条件

| 条件 | 内容 |
|---|---|
| SC1 | `Company` 境界が UnsonOS 側の会社単位と無理なく一致する |
| SC2 | `ticket` を `Initiative` か `Decision item` のどちらかへ明確に寄せられる |
| SC3 | `heartbeat` を `稼働状況` または `実行の起床処理` として利用できる見込みがある |
| SC4 | `approval / audit` が現場責任者コンソールの `判断待ち一覧 / 監査` に接続可能だと判断できる |
| SC5 | `Paperclip` を入れても現場責任者コンソールが `ticket dashboard` に逆流しない |

## 失敗条件

次のどれかに当たったら、`Paperclip` の深採用を止める。

- `ticket` の意味が強すぎて `Initiative / Decision / Run` を分けられない
- `company` の境界が UnsonOS の `Company` とズレる
- `heartbeat` が flow / checkpoint と常に競合する
- board / dashboard をそのまま使う前提になり、現場責任者コンソールの独自面が消える
- プラグイン / 設定 / 接続の未成熟さが structural risk になる

## 想定リスク

### 1. 用語侵食

`ticket`, `company`, `board` の用語が、そのまま UnsonOS の正本を侵食するリスク。

### 2. workflow 不一致

`Paperclip` 側が workflow builder ではない場合、`Flow / Checkpoint / Evidence` の管理が外出し前提になりうる。

### 3. 管理者向け画面の消失

実行基盤が強すぎると、現場責任者コンソールが単なる接続 UI になるリスク。

### 4. fork の早すぎ問題

スパイク前に fork すると、あとから正準ドメインへ戻しにくい。

## 実施後に残す成果物

スパイクの成果物は transcript ではなく、次の 3 つにする。

- `写像メモ`
- `採用/非採用の判断メモ`
- `次に必要な adapter interface`

raw transcript や操作ログは Detail 側に保持してよいが、主成果物にはしない。

## 次の分岐

### 良い場合

- `Paperclip adapter` の最小境界を定義
- `Company / Approval / Audit / Heartbeat` だけ先に接続
- `判断待ち一覧 / 現場責任者コンソール` は UnsonOS 側で持つ

### 悪い場合

- `Paperclip` は reference only に下げる
- `Brainbase + UnsonOS canonical domain + 別 runtime adapter` 路線へ戻す

## 関連文書

- [`unson-os-canonical-domain.md`](/Volumes/UNSON-DRIVE/brainbase-worktrees/session-1773022945038-brainbase/docs/architecture/unson-os-canonical-domain.md)
- [`unson-os-lead-control-console.md`](/Volumes/UNSON-DRIVE/brainbase-worktrees/session-1773022945038-brainbase/docs/architecture/unson-os-lead-control-console.md)
