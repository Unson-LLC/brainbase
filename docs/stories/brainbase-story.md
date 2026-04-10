# Story: Brainbase ストーリー集

enemy/criteria/beat_map および business/user/dev 視点を持つ統合ストーリー。

**参照**: `common/stories/00_stories.md`（brainbaseプラットフォーム正本）

---

## Northstar Story

### id
`northstar.brainbase.org-os-for-ai-first-company`

### horizon
`northstar`

### view
`business`

### story
brainbaseとして、すべての状態・判断基準・文脈をAIが扱える形で正本化し、少人数チームが会議と属人性を排除してスケールできる「組織OS」になりたい。
そうすることで、人間は意思決定と創造に集中し、AIが会社を「回す」形を実現したい。

### criteria

**commit**
- [ ] 全事業（BAAO/SalesTailor/Senrigan/TechKnight/Zeims）のタスク・決定・文脈がbrainbaseで一本化されている
- [ ] AIエージェント（mana）が正本を参照して定時リマインド・進捗追跡・異常検知を自律動作する
- [ ] brainbaseにアクセスすれば誰でも全事業の現在地が5分以内で把握できる

**signal**
- [ ] 佐藤が「今日の会議」を減らせたという実感を持てる
- [ ] 新しいメンバーが1週間以内に自走できる（オンボーディングコスト削減）

### enemy
- 正本が複数箇所に散らばり「どこを見ればいいかわからない」状態が続くこと
- AIへの入力準備（文脈整備）を人間が毎回やり続けること
- ドキュメント管理ツールとして使われ、ワークフロー自動化が実現されないこと

### non_goal
- 汎用プロジェクト管理ツールとしての外部販売
- UIの美しさ・デザインの最適化（機能性優先）

### beat_map
```yaml
nodes:
  - id: B1
    label: タスク/決定/文脈が正本（NocoDB/Git）に記録される
  - id: B2
    label: manaが正本を定時スキャンして状態を把握する
  - id: B3
    label: 期限超過・停滞・ブロッカーを検知してSlackに通知
  - id: B4
    label: 人間が例外判断・意思決定だけを行う
  - id: B5
    label: 決定が正本に反映され、次のAIサイクルへ
edges:
  - from: B1
    to: B2
  - from: B2
    to: B3
  - from: B3
    to: B4
  - from: B4
    to: B5
  - from: B5
    to: B1
```

---

## Quarter Story 1

### id
`quarter.brainbase.mana-ambient-agent`

### horizon
`quarter`

### view
`business`

### story
brainbase開発チームとして、今四半期にmanaが人間のトリガーなしに「状態スキャン→異常検知→Slack通知」を自律動作させたい。
そうすることで、パイロット型（人がコマンドを入力）からアンビエント型（AIが常時監視）への移行を開始したい。

### criteria

**commit**
- [ ] mana M7（朝のエグゼクティブダッシュボード）が毎朝6時に自動実行される
- [ ] 期限超過タスクをmanaが自動検知してSlackに報告する
- [ ] manaが報告した内容に人間が「対応/スキップ」を返すだけで次アクションが確定する

**signal**
- [ ] 佐藤が「今日の全事業状況を確認するためにbrainbaseを開かなくなった」
- [ ] 人間がトリガーにならずにmanaが動いた日数が週5日以上になる

### enemy
- manaがコマンドを待ち続け、「使いたいときだけ使うツール」に留まること
- 自律動作の実装より新UI機能の追加が優先されること

### non_goal
- manaによる自動実行（承認なしの外部アクション）
- 外部サービスへの自動課金・送信

---

## Quarter Story 2

### id
`quarter.brainbase.session-ui-stability`

### horizon
`quarter`

### view
`user`

### story
brainbaseユーザー（佐藤・GMメンバー）として、今四半期にセッション切替・ターミナル表示・エージェント状態把握をストレスなく使えるようにしたい。
そうすることで、brainbaseを「仕事場として毎日使う」状態に持っていきたい。

### criteria

**commit**
- [ ] セッション切替が2秒以内でスナップショット→xterm遷移する
- [ ] エージェントのActivity状態（working/waiting/idle）がリアルタイムで反映される
- [ ] モバイルから改行キーで送信されてしまうバグが修正されている

**signal**
- [ ] 「またブラウザを閉じた」「また固まった」という発言がなくなる
- [ ] 1日あたりの利用セッション数が前月比で増加する

### enemy
- バグ修正より新機能追加を優先して「使いにくい」状態が続くこと
- モバイル利用を想定せずにデスクトップ優先設計が続くこと

### non_goal
- 外部ユーザー向けのUI設計
- 商用SaaSとしての課金・プラン機能

---

## Month Story 1

### id
`month.brainbase.mobile-input-fix`

### horizon
`month`

### view
`user`

### story
brainbaseのモバイルユーザーとして、今月中に「改行キーが送信になる」「二重送信が発生する」問題を解消したい。
そうすることで、外出先からでも安心してmanaに指示できるようにしたい。

### criteria

**commit**
- [ ] モバイルキーボードの改行キーがメッセージ改行として機能する（送信されない）
- [ ] 送信ボタンタップ後に即座にdisabled状態になり、二重送信が防止される
- [ ] 送信中はローディング表示が出て「反応している」と分かる

**signal**
- [ ] モバイルでの「誤送信した」「二重送信した」の報告がゼロになる
- [ ] モバイルからのメッセージ送信件数が前月比で増加する

### enemy
- デスクトップ動作を確認して「直った」とするが、モバイルで再発すること
- 改行キーの挙動がOS/ブラウザによってまた変わること

### non_goal
- モバイルアプリのネイティブ化
- オフラインモード

---

## Month Story 2

### id
`month.brainbase.story-precision-all-projects`

### horizon
`month`

### view
`dev`

### story
brainbase運用チームとして、今月中に全6プロジェクト（BAAO/Brainbase/SalesTailor/Senrigan/TechKnight/Zeims）のストーリーにenemy/criteria/beat_mapを追加し、quarter/monthレイヤーを具体化したい。
そうすることで、各プロジェクトの判断基準がAIも人間も参照できる形で正本化される状態を作りたい。

### criteria

**commit**
- [ ] 全6プロジェクトにdocs/stories/ディレクトリが存在し、story.mdが作成されている
- [ ] 各プロジェクトのストーリーにenemy・commit criteria・signal criteriaが定義されている
- [ ] northstar/quarter/month の3層がそれぞれ business/user/dev 視点で埋まっている

**signal**
- [ ] manaが「このプロジェクトの今月の優先事項は何か」という問いに答えられるようになる
- [ ] 新しいタスクが「どのストーリーに属するか」をメンバーが即答できるようになる

### enemy
- ストーリーが「読み物」として作られ、AIが参照しにくい構造になること
- northstar だけを書いて quarter/month の具体化が後回しになること

### non_goal
- 全プロジェクトのアーキテクチャドキュメント作成
- specs（仕様書）の作成
