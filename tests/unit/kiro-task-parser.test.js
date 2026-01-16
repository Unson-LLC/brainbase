import { describe, it, expect, beforeEach } from 'vitest';
import { KiroTaskParser } from '../../lib/kiro-task-parser.js';

describe('KiroTaskParser', () => {
  let parser;

  beforeEach(() => {
    parser = new KiroTaskParser();
  });

  describe('parseCheckbox', () => {
    it('parseCheckbox呼び出し時_未完了タスクがtodoとして返される', () => {
      const result = parser.parseCheckbox('- [ ] タスク名');
      expect(result.status).toBe('todo');
      expect(result.name).toBe('タスク名');
    });

    it('parseCheckbox呼び出し時_完了タスクがdoneとして返される', () => {
      const result = parser.parseCheckbox('- [x] 完了したタスク');
      expect(result.status).toBe('done');
      expect(result.name).toBe('完了したタスク');
    });

    it('parseCheckbox呼び出し時_大文字Xも完了として認識される', () => {
      const result = parser.parseCheckbox('- [X] 完了したタスク');
      expect(result.status).toBe('done');
    });

    it('parseCheckbox呼び出し時_インデント付きタスクも解析される', () => {
      const result = parser.parseCheckbox('  - [ ] インデント付きタスク');
      expect(result.status).toBe('todo');
      expect(result.name).toBe('インデント付きタスク');
      expect(result.indent).toBe(2);
    });

    it('parseCheckbox呼び出し時_チェックボックスでない行はnullが返される', () => {
      const result = parser.parseCheckbox('普通のテキスト');
      expect(result).toBeNull();
    });

    it('parseCheckbox呼び出し時_メタデータ行はnullが返される', () => {
      const result = parser.parseCheckbox('  - _ID: task-123_');
      expect(result).toBeNull();
    });
  });

  describe('parseMetadata', () => {
    it('parseMetadata呼び出し時_ID値が抽出される', () => {
      const result = parser.parseMetadata('  - _ID: task-1736617200000_');
      expect(result.ID).toBe('task-1736617200000');
    });

    it('parseMetadata呼び出し時_Priority値が抽出される', () => {
      const result = parser.parseMetadata('  - _Priority: high_');
      expect(result.Priority).toBe('high');
    });

    it('parseMetadata呼び出し時_Due値が抽出される', () => {
      const result = parser.parseMetadata('  - _Due: 2025-01-15_');
      expect(result.Due).toBe('2025-01-15');
    });

    it('parseMetadata呼び出し時_Parent値が抽出される', () => {
      const result = parser.parseMetadata('  - _Parent: task-1736617200000_');
      expect(result.Parent).toBe('task-1736617200000');
    });

    it('parseMetadata呼び出し時_メタデータでない行はnullが返される', () => {
      const result = parser.parseMetadata('- [ ] タスク名');
      expect(result).toBeNull();
    });
  });

  describe('parseFile', () => {
    it('parseFile呼び出し時_単一タスクが解析される', () => {
      const content = `- [ ] タスク名
  - _ID: task-123_
  - _Priority: high_`;

      const tasks = parser.parseFile(content, 'brainbase');

      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('task-123');
      expect(tasks[0].name).toBe('タスク名');
      expect(tasks[0].status).toBe('todo');
      expect(tasks[0].priority).toBe('high');
      expect(tasks[0].project).toBe('brainbase');
    });

    it('parseFile呼び出し時_複数タスクが解析される', () => {
      const content = `- [ ] タスク1
  - _ID: task-1_
- [x] タスク2
  - _ID: task-2_`;

      const tasks = parser.parseFile(content, 'brainbase');

      expect(tasks).toHaveLength(2);
      expect(tasks[0].id).toBe('task-1');
      expect(tasks[0].status).toBe('todo');
      expect(tasks[1].id).toBe('task-2');
      expect(tasks[1].status).toBe('done');
    });

    it('parseFile呼び出し時_親子関係が解析される', () => {
      const content = `- [ ] 親タスク
  - _ID: task-parent_
- [ ] 子タスク
  - _ID: task-child_
  - _Parent: task-parent_`;

      const tasks = parser.parseFile(content, 'brainbase');

      expect(tasks).toHaveLength(2);
      expect(tasks[1].parentId).toBe('task-parent');
    });

    it('parseFile呼び出し時_Due日付が解析される', () => {
      const content = `- [ ] 締切付きタスク
  - _ID: task-1_
  - _Due: 2025-01-15_`;

      const tasks = parser.parseFile(content, 'brainbase');

      expect(tasks[0].due).toBe('2025-01-15');
    });

    it('parseFile呼び出し時_空ファイルは空配列が返される', () => {
      const tasks = parser.parseFile('', 'brainbase');
      expect(tasks).toEqual([]);
    });

    it('parseFile呼び出し時_IDがないタスクはスキップされる', () => {
      const content = `- [ ] IDなしタスク
- [ ] IDありタスク
  - _ID: task-1_`;

      const tasks = parser.parseFile(content, 'brainbase');

      expect(tasks).toHaveLength(1);
      expect(tasks[0].name).toBe('IDありタスク');
    });
  });

  describe('generateId', () => {
    it('generateId呼び出し時_task-プレフィックス付きIDが生成される', () => {
      const id = parser.generateId();
      expect(id).toMatch(/^task-\d+$/);
    });

    it('generateId呼び出し時_連続呼び出しで異なるIDが生成される', () => {
      const id1 = parser.generateId();
      const id2 = parser.generateId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('prependTask', () => {
    it('prependTask呼び出し時_タスクがファイル先頭に追加される', () => {
      const existingContent = `- [x] 既存タスク
  - _ID: task-old_`;
      const newTask = {
        id: 'task-new',
        name: '新規タスク',
        status: 'done'
      };

      const result = parser.prependTask(existingContent, newTask);

      expect(result).toMatch(/^- \[x\] 新規タスク/);
      expect(result.indexOf('新規タスク')).toBeLessThan(result.indexOf('既存タスク'));
    });

    it('prependTask呼び出し時_空ファイルでもタスクが追加される', () => {
      const newTask = {
        id: 'task-first',
        name: '最初のタスク',
        status: 'done'
      };

      const result = parser.prependTask('', newTask);

      expect(result).toContain('- [x] 最初のタスク');
      expect(result).toContain('_ID: task-first_');
    });

    it('prependTask呼び出し時_複数タスクの順序が保持される', () => {
      let content = '';
      const task1 = { id: 'task-1', name: 'タスク1', status: 'done' };
      const task2 = { id: 'task-2', name: 'タスク2', status: 'done' };
      const task3 = { id: 'task-3', name: 'タスク3', status: 'done' };

      content = parser.prependTask(content, task1);
      content = parser.prependTask(content, task2);
      content = parser.prependTask(content, task3);

      // 最後に追加されたtask3が先頭にあるべき
      const pos1 = content.indexOf('タスク1');
      const pos2 = content.indexOf('タスク2');
      const pos3 = content.indexOf('タスク3');

      expect(pos3).toBeLessThan(pos2);
      expect(pos2).toBeLessThan(pos1);
    });
  });

  describe('serializeTask', () => {
    it('serializeTask呼び出し時_未完了タスクが正しくシリアライズされる', () => {
      const task = {
        id: 'task-123',
        name: 'タスク名',
        status: 'todo',
        priority: 'high'
      };

      const result = parser.serializeTask(task);

      expect(result).toContain('- [ ] タスク名');
      expect(result).toContain('_ID: task-123_');
      expect(result).toContain('_Priority: high_');
    });

    it('serializeTask呼び出し時_完了タスクが正しくシリアライズされる', () => {
      const task = {
        id: 'task-123',
        name: 'タスク名',
        status: 'done'
      };

      const result = parser.serializeTask(task);

      expect(result).toContain('- [x] タスク名');
    });

    it('serializeTask呼び出し時_親タスクIDが含まれる', () => {
      const task = {
        id: 'task-child',
        name: '子タスク',
        status: 'todo',
        parentId: 'task-parent'
      };

      const result = parser.serializeTask(task);

      expect(result).toContain('_Parent: task-parent_');
    });

    it('serializeTask呼び出し時_Due日付が含まれる', () => {
      const task = {
        id: 'task-123',
        name: 'タスク名',
        status: 'todo',
        due: '2025-01-15'
      };

      const result = parser.serializeTask(task);

      expect(result).toContain('_Due: 2025-01-15_');
    });
  });
});
