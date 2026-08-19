---
title: Brainbase Memory Loop と Mana Operating Loop の製品境界
status: accepted
date: 2026-08-19
scope: OSS Brainbase
---

# Brainbase Memory Loop と Mana Operating Loop の製品境界

## 決定

OSS Brainbase は、個人が単体で利用しても価値が閉じる **Memory Operating System** として成立させる。

`ohayo` / `oyasumi` / `retro` は Brainbase から削除しない。ただし Brainbase における3ルーティンの責務は **記憶循環（Memory Loop）** に限定する。

Mana が導入されている場合、Mana は同名の上位ルーティン **Operating Loop** を所有し、その内部で Brainbase の Memory Loop と SSOT を利用する。

この境界により、OSS Brainbase は意図的に不完全な無料版ではなく「記憶する・整理する・想起する・改善する」までを完結する製品となり、Mana は「理解する・判断する・行動する」に対して課金できる。

## プロダクト原則

```text
Brainbase = Remember / Organize / Retrieve / Learn
Mana      = Understand / Decide / Act / Follow-through
```

Brainbase はユーザーや組織の状態を知識として保持し、正しく検索・更新・検証できることに責任を持つ。

Brainbase は、ユーザーや会社に代わって成果責任を負う常駐オペレーターにはならない。

## Brainbase Memory Loop

### `ohayo`: 何を思い出すべきか

Brainbase の朝ルーティンは、今日の行動命令を作ることではなく、今の判断に必要な記憶を安全に再提示する。

責務:

- Routine / Outbox / Knowledge Event の生存異常を確認する
- Graph / Personal KG / Episode から関連知識を想起する
- 前日から残っている未解決事項を提示する
- 使用した知識を記録し、想起品質のフィードバックへつなげる
- 情報源が取得不能な場合は、確認済み0件へ潰さず `coverage=partial|unavailable` とする

非責務:

- 会社目標から今日の優先順位を決定する
- 誰に何をやらせるか決定する
- タスクを自動実行する
- 人間へ継続的に催促する

### `oyasumi`: 何を記憶として閉じるべきか

責務:

- 未処理、矛盾、期限切れ、Outbox を照合する
- Episode を判断・結果・未解決事項を失わない形で圧縮する
- 圧縮後の記憶が検索可能であることを確認する
- Personal KG 登録候補と Graph 昇格候補を分離する
- 翌日へ持ち越すべき記憶上の未解決事項を残す

非責務:

- 今日の事業成果が十分だったかを評価する
- 明日の会社としての最優先を決定する
- 担当者の責任遂行を評価・督促する

### `retro`: 記憶システムから何を改善すべきか

責務:

- 誤登録率、訂正率、矛盾、処理時間、停止など記憶循環の品質を評価する
- 反復する記憶品質上の問題を抽出する
- Personal KG の登録・確定候補をレビュー可能にする
- Graph の昇格候補をレビュー可能にする
- Brainbase 自体の改善候補を生成する

非責務:

- 組織の事業戦略を変更する
- チーム運営を変更する
- 本番ポリシー、Skill、Graph を無承認で変更する

## Mana がある場合の合成

ユーザーから見える名称は同じでもよい。実行責務を分ける。

```text
User: "おはよう"
        |
        v
Mana Morning Operating Loop
        |
        +--> Brainbase Morning Memory Loop
        |
        +--> Goal / Milestone / Sprint / Task / Ship / RACI を取得
        |
        +--> 今日の優先順位を判断
        |
        +--> AIで実行可能なShipを開始
        |
        +--> 人間が必要な項目を依頼・リマインド
```

Mana が存在しない場合は Brainbase Memory Loop 単体で完結する。

## 実行Hostは製品概念から分離する

`ohayo` / `oyasumi` / `retro` の意味契約に、Codex Automation、Claude scheduled task、cron、EventBridge、Mana daemon 等の実行Hostを固定しない。

Brainbase が保持するべき契約は次のようなものとする。

```text
routine_id
scope
expected_schedule
owner_subject
status
coverage
required_artifacts
run_receipt
```

実行Hostは metadata / adapter として扱う。

```text
Codex Automation ----\
Claude Scheduler -----+--> Routine Trigger --> Brainbase Routine API
cron -----------------+
EventBridge -----------+
Mana Runtime ----------/
```

OSS onboarding は、利用可能なHost向けの定義を生成してよい。ただし「Codex AutomationでなければBrainbase Routineではない」という依存を作らない。

## OSSとして残す理由

Brainbase OSS は次の閉ループを単体で完成させる。

```text
Capture
  -> Organize
  -> Recall
  -> Feedback
  -> Improve
  -> Capture ...
```

無料版を意図的に壊してManaへ誘導しない。OSSの完成度そのものを配布・採用・信頼の獲得装置とし、Manaへのアップセルは「記憶」ではなく「判断と実行」に置く。

## 課金境界

Brainbase OSSの価値:

- 個人のローカル優先SSOT
- Ontology / Graph / Personal KG
- Episode / Judgment memory
- MCP / API
- Memory Loop

有償版にのみ置くべき価値ではないもの:

- 基本的な日次の記憶整理
- 想起
- 記憶品質の確認

Manaへ置く価値:

- 目的から優先順位を決める
- 状況変化を継続監視する
- AIで可能な仕事をShipする
- 人間の責務を追跡し、必要な時に介入する
- 成果から組織運営を改善する

## 移行方針

現在の Brainbase Routine 実装にある `today_focus`、`immediate_decisions`、`tomorrow_focus`、`system_changes` は即時削除しない。

ただし今後の変更では次を守る。

1. Brainbase内部で事業上の優先順位判断を増やさない。
2. Memory Loopとして説明できる出力へ意味を限定する。
3. 会社・個人の成果責任に関する判断は Mana Operating Loop へ移す。
4. Routine Runner と execution host を疎結合化する。
5. OSS単体での閉ループを壊さない。
