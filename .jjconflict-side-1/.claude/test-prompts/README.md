# テストプロンプト集

このディレクトリには、Playwright E2Eテストを実装するためのプロンプトテンプレートが格納されています。

## 使い方

### 1. AIにテスト実装を依頼する場合

```bash
# プロンプトファイルの内容をコピーして、Claude/ChatGPTに貼り付ける
cat .claude/test-prompts/bug-040-playwright-implementation-prompt.txt
```

または、Claude Codeを使用している場合：

```bash
# プロンプトファイルを直接参照
# @.claude/test-prompts/bug-040-playwright-implementation-prompt.txt の内容に基づいて、Playwrightテストを実装してください
```

### 2. テスト仕様を確認する場合

```bash
# 詳細な仕様書を確認
cat .claude/test-prompts/bug-040-beginner-navigation-test.md
```

## 利用可能なプロンプト

### BUG-040: 初心者ナビゲーション テンプレート作成テスト

**概要**: テンプレート作成後に初心者ナビゲーションが3/5から4/5に進むことを検証

**ファイル**:

- 仕様書: `bug-040-beginner-navigation-test.md`
- 実装プロンプト: `bug-040-playwright-implementation-prompt.txt`

**対象PR**: https://github.com/Unson-LLC/salestailor/pull/819

**使用例**:

```typescript
// AIに以下を依頼:
// "bug-040-playwright-implementation-prompt.txt の内容に基づいて、
//  tests/e2e/basic/beginner-navigation-template-creation.spec.ts を実装してください"
```

## プロンプトファイルの構造

各バグ修正・機能追加に対して、以下の2つのファイルを作成します：

1. **`*-test.md`** - 詳細な仕様書

   - テスト目的
   - 背景・修正内容
   - テストシナリオ
   - 検証ポイント
   - 期待される結果

2. **`*-implementation-prompt.txt`** - AI実装依頼用プロンプト
   - 目的と背景
   - 実装要件
   - 必須テストケース
   - 実装ガイドライン
   - 完了条件

## プロンプトテンプレート

新しいテストプロンプトを作成する場合は、以下のテンプレートを使用してください：

```markdown
# BUG-XXX: [バグタイトル]

## テスト目的

[何を検証するか]

## 背景

- **修正内容**: [修正の概要]
- **修正PR**: [PRのURL]
- **期待動作**: [期待される動作]

## 実装要件

[詳細な実装要件]

## 必須テストケース

[テストケースのリスト]

## 実装ガイドライン

[コード例やベストプラクティス]

## 完了条件

- [ ] チェックリスト
```

## AIへの依頼の流れ

1. **プロンプトファイルの選択**

   - 実装したいテストに対応するプロンプトファイルを選択

2. **AIへの依頼**

   - プロンプトファイルの内容をコピー
   - Claude Code, ChatGPT, または他のAIツールに貼り付け

3. **実装の確認**

   - AIが生成したテストコードを確認
   - 必要に応じて修正を依頼

4. **テスト実行**

   ```bash
   npx playwright test [生成されたテストファイル] --ui
   ```

5. **調整とデバッグ**
   - テストが失敗する場合、AIにエラーメッセージを共有して修正を依頼
   - セレクターやタイミングの調整

## ベストプラクティス

### プロンプト作成時

- 具体的な手順を明記する
- 期待される結果を明確にする
- 既存ファイルへの参照を含める
- エッジケースも記載する

### AI依頼時

- プロンプト全体をコピーして一度に依頼
- 段階的な実装が必要な場合は明示
- 不明点は事前に確認

### テスト実装時

- 既存のテストパターンを参考にする
- セレクターは `data-testid` を優先
- 適切な待機処理を入れる
- クリーンアップを忘れない

## 関連ドキュメント

- [Playwright公式ドキュメント](https://playwright.dev/)
- [プロジェクトE2Eテストガイド](../../../tests/e2e/README.md)
- [E2Eテスト戦略](../../../CLAUDE.md#E2Eテスト戦略)

## トラブルシューティング

### Q: AIが生成したテストが実行できない

A: 以下を確認してください：

- ファイルパスが正しいか
- インポート文が正しいか
- 既存の認証ヘルパーを使用しているか

### Q: セレクターが見つからない

A: Playwright Inspectorを使用：

```bash
npx playwright test --debug
```

### Q: テストがタイムアウトする

A: 待機処理を追加：

```typescript
await page.waitForResponse("**/api/templates");
await page.waitForSelector('[data-testid="element"]');
```

## 貢献

新しいテストプロンプトを追加する場合：

1. このREADMEのテンプレートに従う
2. 仕様書（`*-test.md`）と実装プロンプト（`*-implementation-prompt.txt`）の両方を作成
3. このREADMEの「利用可能なプロンプト」セクションに追加
