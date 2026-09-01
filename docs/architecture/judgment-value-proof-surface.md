# Judgment Value Proof Surface

Status: accepted candidate  
Story: `story-m3-judgment-value-proof-surface`  
Updated: 2026-09-01

## Problem

BrainbaseはJudgment Receipt、Autonomy Receipt、Tool Event、Final Receiptを保持しているが、利用者が日常の仕事で知りたいのは内部監査の件数ではない。

利用者が知りたいのは次である。

1. Brainbaseによって、どの確認を受けずに済んだか。
2. 代わりにどの判断が適用されたか。
3. その判断によって、仕事がどこまで進んだか。
4. 現実の成果を確認できたか。
5. その判断が誤っていた場合、次回へどう直せるか。

検索・取得・Entity IDを先に表示すると、Brainbaseが「働いた」ことではなく「検索した」ことしか伝わらない。

## Decision

### 1. 共通正本

`brainbase-judgment-value-proof-v1`を、既存のJudgment/Autonomy/Tool/Outcome証跡から生成するportableな派生projectionとする。監査正本を置き換えず、表示都合で正本を増やさない。

```text
Judgment Receipt
Autonomy Receipt
Tool Events
Artifact / canonical readback
Human feedback
        ↓
Judgment Value Proof projection
        ↓
Codex / Claude renderer
Mac Companion attention projection
Weekly digest renderer
```

`intent_id`は一つの利用者意図を、`decision_attempt_id`は一度の確認候補または代理判断を識別する。取得不能・未確認・対象外を0件へ丸めない。

### 2. 標準提供面

Agent-first方針に従い、標準面はCodex / Claude Codeとする。日常業務用Webダッシュボードは作らない。

| Timing | Surface | Display |
|---|---|---|
| 通常のBrainbase参照 | 非表示 | 既存監査には残すが、価値表示は出さない |
| Brainbaseが行動を変え、長い作業を続行 | Codex / Claudeの途中経過 | 判断と仕事への影響を1行だけ表示 |
| 代理判断を含む作業の完了 | Codex / Claudeの最終回答 | 結果から始まる判断レシートを表示 |
| 新しい価値判断・権限・不可逆操作が必要 | Codex / Claude + Mac Companion | AIで決めない理由、選択肢、影響を表示 |
| blocked / unconfirmed / correction pending | Mac Companion | 要介入項目だけを投影 |
| 定期振り返り | Codex / ClaudeまたはCompanionのダイジェスト | 代理判断、成果確認、人間判断、訂正、未確認を分離集計 |
| 監査・診断 | Codex / Claude via MCP | Receipt、Entity ID、digest、Tool Eventを明示取得 |
| ブラウザ必須操作 | Brainbase Web | login、OAuth、consent、pairing、break-glassのみ |

成功runをMac Companionへ常時通知しない。Companionは人間の注意が必要な項目に限定する。

### 3. 表示順

利用者向け既定表示は必ず次の順にする。

```text
結果
→ 判断
→ 仕事への影響
→ 根拠の適用内容
→ 成果確認状態
→ 証拠の人間向けラベル
→ 修正方法
```

Entity ID、raw ref、digest、検索query、Tool Event本文は既定表示に出さない。監査詳細から明示取得する。

### 4. 表示抑制

次では判断レシートを表示しない。

- Brainbaseを参照しただけで行動が変わらなかった。
- 通常回答、翻訳、単純整形など、代理判断が発生していない。
- Outcome、feedback、blockedのいずれも対象外である。

表示自体が認知負荷になるため、「Brainbaseを使った」だけを理由に毎回答へ表示しない。

### 5. 人間判断

`human_required`は失敗ではない。目的、価値判断、責任、権限、不可逆な外部作用など、AIが安全に推論できない境界を正しく残した状態である。

人間へは単なる質問ではなく、次をまとめて提示する。

- 判断対象
- AIで決めない理由
- 選択肢
- 各選択肢の影響

### 6. Feedback

代理判断の訂正は、回答の言い直しで終わらせない。`accepted`、`corrected`、`next_time_ask`、`reverted`を証拠参照付きで記録し、再利用可能な判断基準への昇格候補へ接続する。

## Repository boundary

- `Unson-LLC/brainbase`: public type、schema、fixture、pure placement/rendering functionsの正本。
- `Unson-LLC/brainbase-unson`: Resolver Host、Graph/PostgreSQL adapter、組織横断集計、Mac Companion delivery、権限・監査の実装。
- 組織版は固定commitまたはversionの`@unson/brainbase-mcp`を消費し、同じrendererをコピーしない。

## Security

- 質問本文は必須保存しない。表示が必要な場合のみredacted textを持ち、digestとの結合を維持する。
- Tool response本文を表示projectionへ転載しない。
- 既定レシートは内部Entity IDとraw evidence refを隠す。
- `outcome_verified`はverified evidenceが一つ以上ある場合だけ許可する。

## Verification

- 通常参照がsilentになること。
- 代理判断の途中表示が1行に限定されること。
- 完了レシートが結果から始まり、内部IDを露出しないこと。
- `human_required`が理由・選択肢・影響を提示すること。
- 成功runがCompanionへ常時投影されないこと。
- unconfirmed / unavailableを0件または成功へ丸めないこと。
