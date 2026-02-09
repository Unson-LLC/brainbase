# brainbaseセッション復旧コマンド生成

左パネルに表示されているセッション名から、復旧コマンドを即座に生成する。

---

## 使い方

ユーザーがセッション名を指定したら、以下の手順で復旧コマンドを生成：

1. `/Users/ksato/workspace/shared/var/state.json` を読む
2. セッション名で検索してセッションIDを特定
3. 復旧コマンドを出力

---

## 実行手順

### Step 1: state.jsonからセッションIDを検索

```bash
jq '.sessions[] | select(.name | contains("セッション名の一部")) | {id: .id, name: .name, project: .project}' /Users/ksato/workspace/shared/var/state.json
```

**例**：
- 「営業パイプライン」を含むセッションを検索
  ```bash
  jq '.sessions[] | select(.name | contains("営業")) | {id: .id, name: .name}' /Users/ksato/workspace/shared/var/state.json
  ```

- 「RAGW」という名前のセッションを検索
  ```bash
  jq '.sessions[] | select(.name == "RAGW") | {id: .id, name: .name}' /Users/ksato/workspace/shared/var/state.json
  ```

### Step 2: セッションIDが見つかったら復旧コマンドを出力

セッションIDが `session-1770104017573` の場合：

```bash
export BRAINBASE_SESSION_ID='session-1770104017573' && claude
```

**フルコマンド（LANG設定付き）**:
```bash
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 LC_CTYPE=en_US.UTF-8 && export BRAINBASE_SESSION_ID='session-1770104017573' && claude
```

**パーミッションスキップ版**:
```bash
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 LC_CTYPE=en_US.UTF-8 && export BRAINBASE_SESSION_ID='session-1770104017573' && claude --dangerously-skip-permissions
```

---

## ログファイルの確認（オプション）

復旧前にログの存在を確認したい場合：

```bash
# セッションのログディレクトリを確認
ls -la ~/.claude/projects/-Users-ksato-workspace-shared--worktrees-session-セッションID-*/

# ログファイルの内容を確認（最初の数行）
head -20 ~/.claude/projects/-Users-ksato-workspace-shared--worktrees-session-セッションID-*/*.jsonl | jq -r 'select(.type == "user") | .content[0].text' | head -100
```

---

## brainbaseのセッション管理の仕組み

### セッション名の保存場所

- **正本**: `/Users/ksato/workspace/shared/var/state.json`
- **フォーマット**:
  ```json
  {
    "sessions": [
      {
        "id": "session-1770104017573",
        "name": "営業パイプライン（全案件）をリスト化し角度・入金時期を整理",
        "project": null,
        "worktree": true,
        ...
      }
    ]
  }
  ```

### 左パネル表示のコード

- **レンダリング**: `/Users/ksato/workspace/code/brainbase/public/modules/session-list-renderer.js`
  - 21行目: `const displayName = escapeHtml(session.name || session.id);`
  - `session.name` から表示名を取得

- **状態管理**: `/Users/ksato/workspace/code/brainbase/public/modules/state-api.js`
  - `/api/state` エンドポイントで `state.json` と同期

### ログファイルの保存場所

- **Claude Codeログ**: `~/.claude/projects/-Users-ksato-workspace-shared--worktrees-session-{SESSION_ID}-{PROJECT}/`
- **形式**: `{uuid}.jsonl`
- **インデックス**: `sessions-index.json` (Claude Code管理)

---

## 使用例

**ユーザー**: 「営業パイプライン」のセッションを復旧したい

**Assistant**:
1. state.jsonから検索:
   ```bash
   jq '.sessions[] | select(.name | contains("営業")) | {id: .id, name: .name}' /Users/ksato/workspace/shared/var/state.json
   ```

2. 結果:
   ```json
   {
     "id": "session-1770104017573",
     "name": "営業パイプライン（全案件）をリスト化し角度・入金時期を整理"
   }
   ```

3. 復旧コマンド出力:
   ```bash
   export BRAINBASE_SESSION_ID='session-1770104017573' && claude
   ```

---

## トラブルシューティング

### セッション名が見つからない

- `state.json` が古い可能性
- brainbase UIで名前を変更したか確認
- 全セッション一覧を表示:
  ```bash
  jq '.sessions[] | {id: .id, name: .name}' /Users/ksato/workspace/shared/var/state.json
  ```

### ログファイルが見つからない

- Claude Codeがまだディスクに同期していない可能性
- セッションを一度開いてから終了すると同期される

---

最終更新: 2026-02-04
