# {コマンドタイトル}（条件分岐版）

{条件に応じて異なる処理を実行するコマンドの説明}

**モード**:
- **Mode A**: {モードAの説明}
- **Mode B**: {モードBの説明}

---

## 0. 前提チェック

実行前に以下を確認してください:
- {前提条件1}
- {前提条件2}

---

## 1. モード選択

### 質問: {モード選択の質問} [Y/n]

#### Option A: {オプションA}
- {オプションAの特徴1}
- {オプションAの特徴2}
- → **Phase 2A へ**

#### Option B: {オプションB}
- {オプションBの特徴1}
- {オプションBの特徴2}
- → **Phase 2B へ**

---

## Phase 2A: {オプションA実行}

```bash
# {オプションA選択時の処理}
echo "Mode A selected"

# {具体的なコマンド}
if [[ "$MODE" == "A" ]]; then
  command-a --option value
fi
```

---

## Phase 2B: {オプションB実行}

```bash
# {オプションB選択時の処理}
echo "Mode B selected"

# {具体的なコマンド}
if [[ "$MODE" == "B" ]]; then
  command-b --option value
fi
```

---

## Phase 3: 完了確認

```bash
# 結果確認
echo "✅ {コマンド名} 完了（Mode: $MODE）"

# {確認コマンド}
command --verify
```

---

**使用例**:
```bash
# Mode A実行
/{command-name}  # Y選択

# Mode B実行
/{command-name}  # n選択
```
