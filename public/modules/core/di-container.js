/**
 * 依存性注入コンテナ
 * シングルトンパターンでサービスを管理し、依存性を自動解決
 */
export class DIContainer {
    constructor() {
        this.services = new Map();
        this._resolving = new Set(); // 循環依存検出用
    }

    /**
     * サービスを登録
     * @param {string} name - サービス名
     * @param {Function} factory - ファクトリ関数（DIContainerを引数に取る）
     */
    register(name, factory) {
        this.services.set(name, { factory, instance: null });
    }

    /**
     * サービスを取得（シングルトン）
     * @param {string} name - サービス名
     * @returns {*} - サービスインスタンス
     * @throws {Error} サービスが未登録または循環依存の場合
     */
    get(name) {
        const service = this.services.get(name);
        if (!service) {
            throw new Error(`Service "${name}" not found`);
        }

        // 既にインスタンス化済みの場合
        if (service.instance !== null) {
            return service.instance;
        }

        // 循環依存チェック
        if (this._resolving.has(name)) {
            throw new Error(`Circular dependency detected: ${Array.from(this._resolving).join(' -> ')} -> ${name}`);
        }

        try {
            this._resolving.add(name);
            service.instance = service.factory(this);
            return service.instance;
        } finally {
            this._resolving.delete(name);
        }
    }

    /**
     * サービスが登録されているか確認
     * @param {string} name - サービス名
     * @returns {boolean}
     */
    has(name) {
        return this.services.has(name);
    }
}
