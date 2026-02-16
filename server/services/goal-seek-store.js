/**
 * GoalSeekStore
 *
 * ゴール逆算計算結果の永続化ストア
 */

export class GoalSeekStore {
    constructor() {
        this.goals = new Map();
    }

    async init() {
        // No-op for now
    }

    get(id) {
        return this.goals.get(id);
    }

    set(id, data) {
        this.goals.set(id, data);
    }

    delete(id) {
        this.goals.delete(id);
    }

    getAll() {
        return Array.from(this.goals.values());
    }
}
