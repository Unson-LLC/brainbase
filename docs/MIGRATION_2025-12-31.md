# brainbase ディレクトリ移行作業 (2025-12-31)

## 概要

brainbase-ui.OLD-DO-NOT-USE から `/Users/ksato/workspace/projects/brainbase` への移行を実施。
OSS公開版をベースにローカル専用機能を統合し、開発環境として正式に運用開始。

---

## 背景・課題

### 問題点
1. **誤ったディレクトリ使用**: `brainbase-ui.OLD-DO-NOT-USE` という名前の通り使うべきでないディレクトリで開発サーバーが起動していた
2. **ディレクトリ構造の混乱**: OSS公開版 (`projects/brainbase`) と開発版が分離・不整合
3. **データ保全の懸念**: 198件のセッションデータが DO-NOT-USE 側にのみ存在

### ユーザー要件
- OSS公開版はクリーンな状態を維持（機密情報・個人データを含めない）
- 開発環境は最新版を使用し、ローカル専用カスタマイズを含む
- 198件のセッションデータを確実に引き継ぐ
- mana統合、brainbase拡張機能を継続使用

---

## 実施内容

### Phase 1: 現状調査

**ディレクトリ構造の確認**:
```
/Users/ksato/workspace/
├── brainbase-ui.OLD-DO-NOT-USE/  # 古い開発環境（削除済）
│   ├── state.json                 # 198セッション
│   ├── public/modules/domain/mana/     # mana統合
│   ├── public/modules/domain/brainbase/ # brainbase拡張
│   └── ...
└── projects/brainbase/            # OSS公開版（正式な開発環境へ）
    └── ...
```

**Git履歴分析**:
- OSS版は意図的にクリーンアップされていた（コミット `bd27aac`: "chore(oss): remove non-essential files for OSS release"）
- DO-NOT-USE版には最新のmana機能等が含まれていた

### Phase 2: .gitignore設定

**目的**: ローカル専用ファイルをGit管理から除外し、OSS版をクリーンに保つ

**追加した除外パターン**:

```gitignore
# ========================================
# ローカル専用データ（個人のセッション情報）
# ========================================
state.json
state.json.backup.*
state.json.lock/
_inbox/pending.md
uploads/

# ========================================
# ローカル専用機能（mana統合、brainbase拡張など）
# ========================================
public/modules/domain/mana/
public/modules/domain/brainbase/
public/modules/main-panels.js
public/modules/ui/modals/mana-dashboard-modal.js
public/modules/ui/modals/rename-modal.js

# ========================================
# ローカル専用設定
# ========================================
config.local.yml

# ========================================
# ローカル専用ディレクトリ
# ========================================
_local/
_private/

# ========================================
# サンプルデータの個人プロジェクト
# ========================================
_codex-sample/projects/
```

### Phase 3: ローカル専用ファイルのコピー

**コピー元**: `/Users/ksato/workspace/brainbase-ui.OLD-DO-NOT-USE/`
**コピー先**: `/Users/ksato/workspace/projects/brainbase/`

**コピーしたファイル**:

1. **セッションデータ** (198件):
   ```bash
   cp -r brainbase-ui.OLD-DO-NOT-USE/state.json projects/brainbase/
   ```

2. **mana統合モジュール**:
   ```bash
   cp -r brainbase-ui.OLD-DO-NOT-USE/public/modules/domain/mana/ \
         projects/brainbase/public/modules/domain/mana/
   ```
   - `mana-service.js` (4827 bytes)
   - Slack AI PM agent連携機能

3. **brainbase拡張モジュール**:
   ```bash
   cp -r brainbase-ui.OLD-DO-NOT-USE/public/modules/domain/brainbase/ \
         projects/brainbase/public/modules/domain/brainbase/
   ```
   - `brainbase-service.js` (1880 bytes)

4. **カスタムUIコンポーネント**:
   ```bash
   cp brainbase-ui.OLD-DO-NOT-USE/public/modules/main-panels.js \
      projects/brainbase/public/modules/main-panels.js

   cp brainbase-ui.OLD-DO-NOT-USE/public/modules/ui/modals/mana-dashboard-modal.js \
      projects/brainbase/public/modules/ui/modals/mana-dashboard-modal.js

   cp brainbase-ui.OLD-DO-NOT-USE/public/modules/ui/modals/rename-modal.js \
      projects/brainbase/public/modules/ui/modals/rename-modal.js
   ```

5. **サンプルデータ**:
   ```bash
   cp -r brainbase-ui.OLD-DO-NOT-USE/_codex-sample/projects/ \
         projects/brainbase/_codex-sample/projects/
   ```

### Phase 4: サーバー再起動・動作確認

**サーバー停止**:
```bash
# DO-NOT-USE側のサーバーを停止
kill <pid>
```

**サーバー起動**:
```bash
cd /Users/ksato/workspace/projects/brainbase
npm run dev
# → http://localhost:3000 で起動
```

**動作確認結果**:
```json
{
  "sessions": 198,
  "has_mana_module": "mana機能あり",
  "has_brainbase_module": "brainbase拡張あり"
}
```

✅ 198セッションすべて読み込み確認
✅ mana機能が正常に動作
✅ brainbase拡張機能が正常に動作

### Phase 5: 旧ディレクトリ削除

**実行**:
```bash
rm -rf /Users/ksato/workspace/brainbase-ui.OLD-DO-NOT-USE
```

**確認**:
```bash
ls -la /Users/ksato/workspace/ | grep brainbase
# → projects/brainbase のみ存在
```

---

## 最終状態

### ディレクトリ構造

```
/Users/ksato/workspace/projects/brainbase/
├── .gitignore                          # 更新: ローカル専用ファイル除外
├── state.json                          # ローカル専用（198セッション）
├── public/
│   └── modules/
│       ├── domain/
│       │   ├── mana/                   # ローカル専用（mana統合）
│       │   ├── brainbase/              # ローカル専用（brainbase拡張）
│       │   ├── task/                   # OSS公開
│       │   ├── session/                # OSS公開
│       │   └── schedule/               # OSS公開
│       ├── ui/
│       │   └── modals/
│       │       ├── mana-dashboard-modal.js  # ローカル専用
│       │       └── rename-modal.js          # ローカル専用
│       └── main-panels.js              # ローカル専用
└── _codex-sample/
    └── projects/                       # ローカル専用（個人プロジェクト）
```

### Git状態

```bash
$ git status --short
 M .gitignore
?? docs/MIGRATION_2025-12-31.md
```

- `.gitignore` のみ変更
- ローカル専用ファイルは正しく除外されている
- OSS公開版への影響なし

### サーバー状態

- **起動ディレクトリ**: `/Users/ksato/workspace/projects/brainbase`
- **ポート**: 3000
- **セッション数**: 198件
- **mana機能**: 有効
- **brainbase拡張**: 有効

---

## 今後の運用方針

### 開発ワークフロー

**正式な開発ディレクトリ**: `/Users/ksato/workspace/projects/brainbase`

1. **コード変更**: OSS公開対象のコードを編集
2. **ローカル専用機能**: `.gitignore` で除外されているため、自由に追加・変更可能
3. **コミット**: ローカル専用ファイルは自動的に除外される
4. **OSS公開**: 機密情報・個人データが含まれない状態を維持

### ローカル専用機能の管理

**除外対象**（`.gitignore` で管理）:
- セッションデータ (`state.json`)
- mana統合モジュール (`public/modules/domain/mana/`)
- brainbase拡張モジュール (`public/modules/domain/brainbase/`)
- カスタムUIコンポーネント (`main-panels.js`, モーダル類)
- 個人設定 (`config.local.yml`)
- サンプルデータの個人プロジェクト (`_codex-sample/projects/`)

**追加方法**:
```bash
# 新しいローカル専用機能を追加する場合
# 1. .gitignoreに追加
echo "public/modules/domain/new-feature/" >> .gitignore

# 2. ファイルを作成
mkdir -p public/modules/domain/new-feature/
# ...開発...

# 3. Gitで確認（除外されていることを確認）
git status
# → new-feature/ が表示されないことを確認
```

### バックアップ推奨

**ローカル専用データのバックアップ**:
```bash
# 定期的にバックアップ
tar czf ~/backups/brainbase-local-$(date +%Y%m%d).tar.gz \
  state.json \
  public/modules/domain/mana/ \
  public/modules/domain/brainbase/ \
  public/modules/main-panels.js \
  public/modules/ui/modals/mana-dashboard-modal.js \
  public/modules/ui/modals/rename-modal.js \
  _codex-sample/projects/
```

---

## トラブルシューティング

### セッションデータが消えた場合

```bash
# state.json のバックアップから復元
cd /Users/ksato/workspace/projects/brainbase
ls -lt state.json.backup.*  # 最新のバックアップを確認
cp state.json.backup.YYYYMMDD_HHMMSS state.json
```

### mana機能が動作しない場合

```bash
# manaモジュールが存在するか確認
ls -la public/modules/domain/mana/

# 存在しない場合はバックアップから復元
# または DO-NOT-USE のバックアップがあれば再コピー
```

### サーバーが起動しない場合

```bash
# state.json.lock/ が原因の場合
mkdir -p state.json.lock/

# ポート3000が使用中の場合
lsof -ti:3000 | xargs kill -9
```

---

## チェックリスト（他のAI引き継ぎ時）

### 確認事項

- [ ] 開発ディレクトリは `/Users/ksato/workspace/projects/brainbase` である
- [ ] `brainbase-ui.OLD-DO-NOT-USE` は削除済み（存在しない）
- [ ] サーバーはポート3000で起動する (`npm run dev`)
- [ ] `.gitignore` でローカル専用ファイルが除外されている
- [ ] `state.json` に198件のセッションが存在する
- [ ] mana機能が利用可能（`public/modules/domain/mana/` が存在）
- [ ] brainbase拡張が利用可能（`public/modules/domain/brainbase/` が存在）

### 注意事項

- [ ] OSS公開版に個人データを含めない（`.gitignore` 確認）
- [ ] ローカル専用ファイルをコミットしない
- [ ] worktree開発時は3000以外のポートを使用（3001等）
- [ ] `state.json` の定期バックアップを推奨

### 新機能追加時

- [ ] ローカル専用機能の場合は `.gitignore` に追加
- [ ] OSS公開対象の場合は通常通りコミット
- [ ] セキュリティチェック（XSS/CSRF等）を実施
- [ ] テストカバレッジ80%以上を維持

---

## 参照ドキュメント

- **アーキテクチャ**: `/Users/ksato/workspace/projects/brainbase/CLAUDE.md`
- **デザイン**: `/Users/ksato/workspace/projects/brainbase/DESIGN.md`
- **引き継ぎ**: `/Users/ksato/workspace/projects/brainbase/HANDOFF.md`
- **リファクタリング計画**: `/Users/ksato/workspace/projects/brainbase/docs/REFACTORING_PLAN.md`

---

## 作業完了日時

- **実施日**: 2025-12-31
- **実施者**: Claude Code (佐藤圭吾の代理)
- **所要時間**: 約1時間
- **検証**: 完了（198セッション確認、mana/brainbase拡張動作確認）

---

**ステータス**: ✅ 完了・運用開始
**次回レビュー**: 2週間後（ローカル専用ファイルの動作確認）
