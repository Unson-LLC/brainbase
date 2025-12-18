# アトミックコミット（小さく・頻繁に）

変更を小さな単位に分割してコミットします。SalesTailor流の高速開発を実現。

## 実行手順

1. `git status` と `git diff --stat` で現在の変更を確認
2. 変更を**論理単位**で分類:
   - ファイル単位ではなく、**機能単位・目的単位**で分ける
   - 例: 「UIの修正」「APIの追加」「テストの追加」「リファクタ」
3. 各単位ごとにステージング → コミット
4. コミットメッセージは必ず**何を・なぜ**を含める

## アトミックコミットの基準

**1コミット = 1つの目的**

| OK | NG |
|----|-----|
| `fix: ログイン画面のバリデーションエラー修正` | `fix: 色々修正` |
| `feat: ユーザー検索API追加` | `feat: 機能追加` |
| `refactor: 認証ロジックを共通化` | `refactor: リファクタ` |

## コミットメッセージフォーマット

```
<type>(<scope>): <何をしたか>

<なぜ>:
- 変更の理由・背景

<関連>: REQ-XXX / BUG-XXX（あれば）
```

## 変更が大きい場合の分割例

変更前:
```
 src/api/users.ts      | 100 ++++++
 src/components/Form.tsx | 50 +++
 src/utils/validation.ts | 30 +++
 tests/users.test.ts    | 80 ++++++
```

分割後:
1. `feat(api): ユーザーAPIの基本実装`
2. `feat(ui): ユーザーフォームコンポーネント追加`
3. `feat(utils): バリデーション関数追加`
4. `test: ユーザーAPIのテスト追加`

## 実行コマンド

```bash
# 特定ファイルのみステージング
git add src/api/users.ts
git commit -m "feat(api): ユーザーAPIの基本実装"

# 次の変更をステージング
git add src/components/Form.tsx
git commit -m "feat(ui): ユーザーフォームコンポーネント追加"
```

## 注意事項

- 1コミットの変更行数は**300行以内**を目安に
- 「fix」「fix:」のような曖昧なメッセージは禁止
- 迷ったら分割（後でsquashできる）
