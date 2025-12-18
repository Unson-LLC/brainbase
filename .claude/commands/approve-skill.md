# Skills更新案を承認・適用（ワンクリック）

`/learn-skills` で生成された更新案を**ワンクリックで**承認し、Skillsを自動更新します。

## 使用方法

```
/approve-skill <update_id>
```

## パラメータ

- `<update_id>`: 更新案のID（例: `1732534800`）

## 実行内容（完全自動）

1. **更新案を確認** ✅ 自動
   - 指定されたIDの更新案を読み込み
   - 更新内容を表示

2. **バックアップ作成** ✅ 自動
   - 既存Skillを自動バックアップ
   - `.claude/learning/history/backups/` に保存
   - ロールバック用のコマンドを提示

3. **Skillsを更新** ✅ 自動
   - `.claude/learning/scripts/apply_update.sh` を実行
   - 更新案を適用
   - SKILL.mdファイルを書き換え

4. **履歴を記録** ✅ 自動
   - 更新履歴を `.claude/learning/history/YYYY-MM-DD.md` に追記
   - 更新内容、理由、信頼度を記録

5. **学習キューをクリーンアップ** ✅ 自動
   - 処理済み候補のステータスを更新

## 実行例

```
/approve-skill 1
```

## 出力例

```
✅ Skills更新を適用しました

## 更新サマリ
- Skill: strategy-template
- 種別: 既存Skill更新
- 更新日時: 2025-11-25 17:00:00

## 変更内容
- Instructions セクションに「定量性チェック」を追加
- 6つの新しいチェック項目を追加

## バックアップ
- 場所: .claude/learning/history/backups/strategy-template_2025-11-25_17-00-00.md
- ロールバック: /rollback-skill strategy-template 2025-11-25_17-00-00

## 履歴
- 記録: .claude/learning/history/2025-11-25.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 次回から、このSkillを使用する際に新しい内容が反映されます。
```

## ロールバック

更新後に元に戻したい場合：

```
/rollback-skill strategy-template 2025-11-25_17-00-00
```

---

この承認プロセスにより、Skillsの品質を保ちながら、継続的な進化を実現できます。
