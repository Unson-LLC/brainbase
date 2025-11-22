# 概念アーキテクチャ（超ざっくり一枚図）

```
                [あなた / Judgment Core]
                       |
        (価値観・判断基準・個人KPI)
                       |
                 [codex (運用ハブ)]
                       |
       ---------------------------------------------------------------------------------
       |                    |                            |            |          |
  [00_common]            [ops]                      [事業別]     [knowledge]  [meta]
  ルール/決裁/KPI       GM/AE/CS手順,               zeims /      定石/フレーム/過去決定   人・組織・契約メタ
  決定プロトコル        会議リズム, MaC/AGENTS      aitle /      (principles, EOS, WTS,
  テンプレ集            (自動化ルール)             techknight     prompts)
                                                   (戦略→オファー→営業/CS→KPI)
                       |
                 [プロジェクト]
                       |
   ----------------------------------------------------
   |          |            |             |            |
 [組織タグ] [アプリ]     [人:役割]    [顧客]     [契約/課金]
  (雲孫/      (Zeims等)   (GM/AE/CS/    (法人)    (前受・SLA・
   BAAO/                    Dev/PM)                 割引ルール)
   Aitle…)
```

- あなた（Judgment Core）：価値観・判断基準・個人KPIの源泉。`codex` に写経して“誰でも再現”を目指す。
- codex：運用ドキュ一元化。コードは置かない。共通ルール・テンプレ・KPI定義・会議リズム・事業別運用方針、決裁ルール/意思決定プロトコル/ナレッジを管理。
- プロジェクト：仕事単位。営業組織と実装組織が別でも、所属タグを柔軟に付与。
- 組織タグ：雲孫 / BAAO / SalesTailor / Aitle / TechKnight など。プロジェクト・人・契約に付与して「どこで行うか/誰と結ぶか」を明示。
- 人：役割は GM/AE/CS/Dev/PM など。所属タグは契約や案件で変動可能。
- アプリケーション：プロジェクトに紐づくプロダクト（Zeims, Aitle, SalesTailor …）。
- 顧客：法人。営業組織と実装組織が異なる場合、組織間契約（例: BAAO→顧客, BAAO→雲孫）が発生。
- 契約/課金：前受け・SLA・割引ルールを含む。例外は追加料金。決裁フローは codex/ops/gm_playbook に記載予定。
- KPI：
  - 個人：幸福資本論/7ルール遵守など。
  - 事業：MQL→商談→受注、前受率、粗利、TTFV、解約率 等。
  - プロジェクト/アプリ別に `ops/kpi_definitions.md` で定義。
- ナレッジ：`00_common/knowledge/` にフレーム（EOS, Work the System 等）と定石を集約。Decision Protocol とセットで参照し、再利用可能な判断パターンを蓄積。
- メタ：`codex/meta/` に人・組織タグ・顧客/契約・RACIの正本を置く。人/責任/契約ラインの一意表として使う。
- 自動化（MaC/AGENTS）：`ops/automation_mac.md` を起点に、AGENTS.md/Cursor Rules/LLM CoS などの機械可読ルールをまとめる。実行・調整をAI側に寄せる設計。

### 境界の定義（MECE整備）
- 00_common：必ず守る「運用ルール・決裁・プロトコル（義務）」を置く場所。
- knowledge：参照用の「フレーム・定石・過去決定の知見（任意・学習素材）」を置く場所。

## フォルダと代表ファイルの対応表
- 価値観・判断基準：`00_common/knowledge/principles.md`
- 決定プロトコル：`00_common/decision_protocol.md`
- 定石/フレーム：`00_common/knowledge/`（`eos_framework.md`, `work_the_system.md`, 各 playbook*, `case_studies.md`）
- プロンプト（価値観呼び出し用）：`00_common/knowledge/prompt_keigo_values.md`
- 共通ルール：`00_common/rules.md`
- 会議リズム：`ops/meeting_rhythm.md`
- 事業戦略の骨子：`<project>/01_strategy.md`（例: `zeims/01_strategy.md`）
- 人・組織・契約：`meta/people.md`, `meta/orgs.md`, `meta/customers.md`
- RACI：`meta/raci/<project>.md`
- MaC/自動化ルール：`ops/automation_mac.md`（AGENTS.md, Cursor Rules, LLM CoS の扱い）

## 運用メモ
- 用語・線の意味が変わったら、このファイルを必ず更新（単一の最新版を維持）。
- inbox は仮置き。週1で仕分けて、この図と矛盾が出ないようにする。
