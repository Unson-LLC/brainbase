---
name: raci-format
description: brainbaseにおける体制図（RACI）の標準フォーマット。「立ち位置」を最上位原則とし、法人単位で管理。RACIを定義する際に使用。
---

## Triggers

以下の状況で使用：
- RACIを定義・更新するとき
- 体制図のフォーマットを確認したいとき
- 権限範囲や決裁ラインを明確にしたいとき

# 体制図（RACI）フォーマット

brainbaseにおける体制図の標準フォーマットと運用ルールです。

## Instructions

### 1. 最上位原則：立ち位置

**仕事は立ち位置で全てが決まる。**

立ち位置とは、その人が持つ**資産**（実績、信頼、歴史、ネットワーク、リスクを取った経験）によって決まる。

- 立ち位置が**役割**を規定する
- 役割には**権利の範囲**がある
- 範囲を超える行為 = **越権** = 重く扱う

### 2. 管理単位

**法人単位で1ファイル**（プロジェクト/プロダクト単位ではない）

| ファイル | 法人 |
|---------|------|
| raci/unson.md | 雲孫合同会社 |
| raci/techknight.md | 株式会社Tech Knight |
| raci/salestailor.md | SalesTailor |
| raci/baao.md | 一般社団法人BAAO |

プロダクト/ブランドは管轄法人のRACIファイル内の「管轄プロダクト」セクションに記載。

### 3. フロントマター（必須）

```yaml
---
org_id: techknight        # 必須: orgs/*.md と一致させる
name: Tech Knight
members: [kuramoto_yuta, sato_keigo]  # 必須: people/*.md のファイル名
updated: 2025-11-28
---
```

**紐づけ構造:**
```
orgs/*.md ←── org_id ──→ raci/*.md
                              │
                          members
                              ↓
                      people/*.md
```

### 4. ファイル構造

```markdown
---
org_id: xxx
name: 法人名
members: [person_id]
updated: YYYY-MM-DD
---

# 体制図 - {法人名}

## 立ち位置

| 人 | 資産 | 権利の範囲 |
| --- | --- | --- |
| {CEO/代表} | CEO、創業者、... | 最終決裁、事業判断、... |
| {CTO/技術責任者} | 技術構築者、... | 技術判断 |

## 決裁

| 領域 | 決裁者 |
| --- | --- |
| 最終決裁 | {CEO/代表} |
| 技術判断 | {CTO} |

それ以外 → 都度相談

## 主な担当（柔軟に変わる）

| 人 | 領域 |
| --- | --- |

## 管轄プロダクト・ブランド
- プロダクト名
```

### 5. 重要なルール

**誰をRACIに含めるか:**
- **含める**: 権限者（CEO、CTO、CSO、GM、代表理事など）
- **含めない**: 業務委託（people.mdで管理）

**最終決裁者:**
- 各法人のCEO/代表が最終決裁者
- 「佐藤」が全法人の最終決裁者とは限らない
- 例: Tech Knight → 倉本、SalesTailor → 堀、BAAO → 山本

**GMの扱い:**
- GM（General Manager）は事業責任者として権限を持つ
- RACIに含める（例: Zeims GM の川合）

## Examples

### 例: 株式会社Tech Knight

```yaml
---
org_id: techknight
name: Tech Knight
members: [kuramoto_yuta, sato_keigo]
updated: 2025-11-28
---
```

```markdown
## 立ち位置

| 人 | 資産 | 権利の範囲 |
| --- | --- | --- |
| 倉本 | CEO、事業運営経験 | 最終決裁、事業判断、日常運営 |
| 佐藤 | 共同創業者、技術構築者、出資者 | 技術判断 |

## 決裁

| 領域 | 決裁者 |
| --- | --- |
| 最終決裁 | 倉本 |
| 事業判断 | 倉本 |
| 日常運営 | 倉本 |
| 技術判断 | 佐藤 |

## 管轄プロダクト
- Aitle
- HP Sales
- Smart Front
```

### よくある失敗パターン

**❌ プロダクト単位でファイル作成**
```
raci/aitle.md    # ❌ プロダクト単位
raci/zeims.md    # ❌ ブランド単位
```
→ **修正**: 法人単位で作成
```
raci/techknight.md  # ✅ Aitles等を含む
raci/unson.md       # ✅ Zeimsを含む
```

**❌ 佐藤を全法人の最終決裁者にする**
```markdown
| 最終決裁 | 佐藤 |  # ❌ CEOは倉本なのに
```
→ **修正**: 各法人のCEO/代表を最終決裁者に
```markdown
| 最終決裁 | 倉本 |  # ✅ Tech Knight CEO
```

**❌ フロントマターに紐づけ情報がない**
```yaml
---
name: Tech Knight
updated: 2025-11-28
---
```
→ **修正**: org_id と members を追加
```yaml
---
org_id: techknight
name: Tech Knight
members: [kuramoto_yuta, sato_keigo]
updated: 2025-11-28
---
```

**❌ 業務委託をRACIに含める**
```markdown
| 金田 | 業務委託 | ... |  # ❌
```
→ **修正**: 権限者のみRACIに記載、業務委託はpeople.mdで管理

---

正本: `_codex/common/meta/raci/<法人>.md`
テンプレート: `_codex/common/templates/raci_template.md`
