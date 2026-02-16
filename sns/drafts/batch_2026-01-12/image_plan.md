# 画像生成計画（投稿順・テンプレート分散版）

**生成日**: 2026-01-12
**方針**: 連続して同じテンプレートを使わない（投稿順で確認）

---

## 投稿スケジュール（scheduled_posts.yml準拠）

### 1/13（月）
| 時間 | 投稿 | テンプレート |
|------|------|-------------|
| 09:00 | Day 12: タスク依存関係の可視化 | `framework` |
| 12:00 | 27歳で会社を潰した | `confession` |
| 21:00 | 仕組み化への執着 | `infographic` |

### 1/14（火）
| 時間 | 投稿 | テンプレート |
|------|------|-------------|
| 09:00 | Day 13: 自動アーカイブ | `progress` |
| 12:00 | 3つの資本論 | `framework` |
| 21:00 | 失敗前提の思考 | `mystery` |

### 1/15（水）
| 時間 | 投稿 | テンプレート |
|------|------|-------------|
| 09:00 | Day 14: タスクテンプレート | `gap` |
| 12:00 | 覚悟の表明 | `character` |
| 21:00 | 自分がボトルネック | `whiteboard` |

### 1/16（木）
| 時間 | 投稿 | テンプレート |
|------|------|-------------|
| 09:00 | Day 15: アジェンダ自動作成 | `dashboard` |
| 12:00 | 時間の優先順位 | `infographic` |
| 21:00 | 人に任せることの難しさ | `recovery` |

### 1/17（金）
| 時間 | 投稿 | テンプレート |
|------|------|-------------|
| 09:00 | Day 16: フォローアップメール | `incident` |
| 12:00 | 構造化という武器 | `exploded` |
| 21:00 | AIと人間の役割分担 | `gap` |

### 1/18（土）
| 時間 | 投稿 | テンプレート |
|------|------|-------------|
| 09:00 | Day 17: 日程自動調整 | `poll` |
| 12:00 | 経営の全体像を見ること | `dashboard` |
| 21:00 | 哲学的視点の重要性 | `isometric` |

---

## 連続チェック（投稿順）

```
1/13 09:00 framework
1/13 12:00 confession ← 変更OK
1/13 21:00 infographic ← 変更OK
1/14 09:00 progress ← 変更OK
1/14 12:00 framework ← 変更OK
1/14 21:00 mystery ← 変更OK
1/15 09:00 gap ← 変更OK
1/15 12:00 character ← 変更OK
1/15 21:00 whiteboard ← 変更OK
1/16 09:00 dashboard ← 変更OK
1/16 12:00 infographic ← 変更OK
1/16 21:00 recovery ← 変更OK
1/17 09:00 incident ← 変更OK
1/17 12:00 exploded ← 変更OK
1/17 21:00 gap ← 変更OK
1/18 09:00 poll ← 変更OK
1/18 12:00 dashboard ← 変更OK
1/18 21:00 isometric ← 変更OK
```

**結果**: ✅ 連続なし

---

## 画像生成コマンド一覧（投稿順）

```bash
# === 1/13 ===
# 09:00 Day 12
/Users/ksato/workspace/.venv/bin/python /Users/ksato/workspace/brainbase-config/_codex/common/ops/scripts/nano_banana.py -t framework "タスク依存関係の可視化" "俺の頭の中→チーム全員が見れる" "ボトルネック解消"

# 12:00 27歳で会社を潰した
/Users/ksato/workspace/.venv/bin/python /Users/ksato/workspace/brainbase-config/_codex/common/ops/scripts/nano_banana.py -t confession "27歳で会社を潰した" "経営の全体像が見えてなかった" "構造化という武器を手に入れた"

# 21:00 仕組み化への執着
/Users/ksato/workspace/.venv/bin/python /Users/ksato/workspace/brainbase-config/_codex/common/ops/scripts/nano_banana.py -t infographic "仕組み化への執着" "2回やったら3回目は自動化" "自分がいなくても回る"

# === 1/14 ===
# 09:00 Day 13
/Users/ksato/workspace/.venv/bin/python /Users/ksato/workspace/brainbase-config/_codex/common/ops/scripts/nano_banana.py -t progress "自動アーカイブ" "完了タスクが視界に残る→今やるべきことだけ" "ノイズ削減"

# 12:00 3つの資本論
/Users/ksato/workspace/.venv/bin/python /Users/ksato/workspace/brainbase-config/_codex/common/ops/scripts/nano_banana.py -t framework "3つの資本論" "社会資本・人的資本・金融資本" "順番が大事"

# 21:00 失敗前提の思考
/Users/ksato/workspace/.venv/bin/python /Users/ksato/workspace/brainbase-config/_codex/common/ops/scripts/nano_banana.py -t mystery "失敗前提の思考" "失敗しないように=負け" "回復速度を上げる"

# === 1/15 ===
# 09:00 Day 14
/Users/ksato/workspace/.venv/bin/python /Users/ksato/workspace/brainbase-config/_codex/common/ops/scripts/nano_banana.py -t gap "タスクテンプレート" "毎回30分→選ぶだけ" "考えると作業を分離"

# 12:00 覚悟の表明
/Users/ksato/workspace/.venv/bin/python /Users/ksato/workspace/brainbase-config/_codex/common/ops/scripts/nano_banana.py -t character "覚悟の表明" "嫌われる覚悟" "マネジメントを人間がやる時代を終わらせる"

# 21:00 ボトルネック
/Users/ksato/workspace/.venv/bin/python /Users/ksato/workspace/brainbase-config/_codex/common/ops/scripts/nano_banana.py -t whiteboard "自分がボトルネック" "俺がいないと回らない=脆い" "brainbase/manaを作った理由"

# === 1/16 ===
# 09:00 Day 15
/Users/ksato/workspace/.venv/bin/python /Users/ksato/workspace/brainbase-config/_codex/common/ops/scripts/nano_banana.py -t dashboard "アジェンダ自動作成" "準備30分→0分" "議論の質で決まる"

# 12:00 時間の優先順位
/Users/ksato/workspace/.venv/bin/python /Users/ksato/workspace/brainbase-config/_codex/common/ops/scripts/nano_banana.py -t infographic "時間の優先順位" "家族→思考→創造→作業" "4番をゼロにしたい"

# 21:00 人に任せる
/Users/ksato/workspace/.venv/bin/python /Users/ksato/workspace/brainbase-config/_codex/common/ops/scripts/nano_banana.py -t recovery "人に任せる難しさ" "100%を求めると任せられない" "70%でOKにする"

# === 1/17 ===
# 09:00 Day 16
/Users/ksato/workspace/.venv/bin/python /Users/ksato/workspace/brainbase-config/_codex/common/ops/scripts/nano_banana.py -t incident "言った言わない問題" "会議の価値が消える" "自動サマリー送信"

# 12:00 構造化という武器
/Users/ksato/workspace/.venv/bin/python /Users/ksato/workspace/brainbase-config/_codex/common/ops/scripts/nano_banana.py -t exploded "構造化という武器" "経営=人×金×情報×時間×仕組み" "分解して最適化"

# 21:00 AI役割分担
/Users/ksato/workspace/.venv/bin/python /Users/ksato/workspace/brainbase-config/_codex/common/ops/scripts/nano_banana.py -t gap "AIと人間の役割分担" "80%をAIに任せる" "残り20%が人間の価値"

# === 1/18 ===
# 09:00 Day 17
/Users/ksato/workspace/.venv/bin/python /Users/ksato/workspace/brainbase-config/_codex/common/ops/scripts/nano_banana.py -t poll "日程調整の地獄" "5人分の調整→自動設定" "調整は人間の仕事じゃない"

# 12:00 経営の全体像
/Users/ksato/workspace/.venv/bin/python /Users/ksato/workspace/brainbase-config/_codex/common/ops/scripts/nano_banana.py -t dashboard "経営の全体像" "人・金・情報・時間・仕組み" "部分最適の罠"

# 21:00 哲学的視点
/Users/ksato/workspace/.venv/bin/python /Users/ksato/workspace/brainbase-config/_codex/common/ops/scripts/nano_banana.py -t isometric "AIと哲学" "技術の話じゃない" "人間とは何か"
```
