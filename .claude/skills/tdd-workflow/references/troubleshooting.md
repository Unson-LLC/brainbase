# TDD Troubleshooting Guide

TDD実践中に遭遇する一般的な問題と解決方法をまとめたガイドです。

---

## 問題1: テストが書けない

**症状**: テストを書こうとしても何をテストすべきかわからない

**原因**:
- 設計が不明確
- インターフェースが決まっていない
- 実装から考えている（テストファーストの逆）

**対処**:
```javascript
// ❌ Bad: 実装から考える
// 「どう実装するか？」 → テストが書けない

// ✅ Good: 仕様から考える
// 「何を実現したいか？」 → テストが書ける

// 1. 仕様を明確にする
// 「タスクをアーカイブすると、TASK_ARCHIVEDイベントが発火される」

// 2. テストを書く
it('archiveTask呼び出し時_TASK_ARCHIVEDイベントが発火される', async () => {
  const emitted = [];
  eventBus.on(EVENTS.TASK_ARCHIVED, (e) => emitted.push(e));

  await taskService.archiveTask('task-1');

  expect(emitted).toHaveLength(1);
});

// 3. 実装する
// （テストが仕様なので、実装が明確になる）
```

---

## 問題2: 仮実装と本実装の区別がつかない

**症状**: いつ仮実装から本実装に移行すべきかわからない

**原因**:
- 三角測量のタイミングが不明確

**対処**:
```javascript
// ルール: 2つ目のテストケースを追加したら本実装に移行

// Step 1: 仮実装（1つ目のテストケース）
it('タスク数取得_3件のタスクが返される', () => {
  expect(taskService.getTaskCount()).toBe(3);
});

getTaskCount() {
  return 3; // 仮実装: べた書き
}

// Step 2: 三角測量（2つ目のテストケース追加）
it('タスク数取得_5件のタスクが返される', () => {
  taskService.addTask({ title: 'Task 4' });
  taskService.addTask({ title: 'Task 5' });
  expect(taskService.getTaskCount()).toBe(5);
});

// Step 3: 本実装（2つのテストを通すために）
getTaskCount() {
  return this.tasks.length; // 本実装
}
```

---

## 問題3: リファクタリングが怖い

**症状**: テストはあるがリファクタリングに踏み切れない

**原因**:
- テストカバレッジが不足
- テストが壊れやすい（実装の詳細をテスト）

**対処**:
```javascript
// ❌ Bad: 実装の詳細をテスト（壊れやすい）
it('_applyFiltersメソッドが呼ばれる', () => {
  const spy = vi.spyOn(service, '_applyFilters'); // private method
  service.getTasks();
  expect(spy).toHaveBeenCalled();
});

// ✅ Good: 振る舞いをテスト（壊れにくい）
it('フィルタ適用_該当タスクのみ返される', async () => {
  const tasks = await service.getTasks({ status: 'pending' });
  expect(tasks.every(t => t.status === 'pending')).toBe(true);
});

// リファクタリング時
// - private methodの名前を変更 → ✅ Good のテストは通る
// - 内部実装を変更 → ✅ Good のテストは通る
```

**リファクタリングの安全性チェック**:
1. カバレッジ80%以上か？
2. 振る舞いをテストしているか？（実装の詳細ではない）
3. すべてのテストが通っているか？

→ すべてYesなら、安心してリファクタリングできる

---

## 問題4: TODOリストが膨大になる

**症状**: TODOが100個以上あり、管理できない

**原因**:
- TODOが大きすぎる
- 優先順位が不明確

**対処**:
```markdown
// ❌ Bad: 大きすぎるTODO
TODO:
  - [ ] プロジェクト管理機能を実装
  - [ ] タスク管理機能を実装
  - [ ] ユーザー管理機能を実装
  （100個以上...）

// ✅ Good: 小さく分割 + 優先順位付け
TODO: プロジェクト削除機能（P0）
  - [ ] ProjectService.deleteProject() メソッド追加
  - [ ] EVENTS.PROJECT_DELETED イベント定義
  - [ ] UI削除ボタン追加

TODO: タスクアーカイブ機能（P1）
  - [ ] TaskService.archiveTask() メソッド追加
  （後回し）

TODO: 将来的な改善（P2）
  - [ ] 削除履歴の記録
  （さらに後回し）
```

**TODOリスト管理の原則**:
1. **1機能 = 3-5個のTODO**: 大きすぎる場合は分割
2. **優先順位付け**: P0/P1/P2で分類
3. **完了したらアーカイブ**: TODOリストを常に整理

---

**参照元**: [tdd-workflow SKILL.md](../SKILL.md)
**最終更新**: 2025-12-29
