/**
 * 依存性注入コンテナ
 * シングルトンパターンでサービスを管理し、依存性を自動解決
 *
 * 機能:
 * - validate(): 起動時に全サービスを解決して検証
 * - freeze(): 登録を禁止（起動完了後）
 * - dispose(): リソース解放（シャットダウン時）
 */
export class DIContainer {
    constructor() {
        this.services = new Map();
        this._resolving = new Set(); // 循環依存検出用
        this._isFrozen = false;      // 登録禁止フラグ
    }

    /**
     * サービスを登録
     * @param {string} name - サービス名
     * @param {Function} factory - ファクトリ関数（DIContainerを引数に取る）
     * @throws {Error} コンテナがフリーズ済みの場合
     */
    register(name, factory) {
        if (this._isFrozen) {
            throw new Error(`Cannot register "${name}": container is frozen`);
        }
        this.services.set(name, { factory, instance: null });
    }

    /**
     * 全サービスを解決して検証（起動時に呼び出し）
     * @returns {boolean} 検証成功時true
     * @throws {Error} 検証失敗時
     */
    validate() {
        const errors = [];
        for (const [name] of this.services) {
            try {
                this.get(name);
            } catch (error) {
                errors.push(`${name}: ${error.message}`);
            }
        }
        if (errors.length > 0) {
            throw new Error(`DI validation failed:\n${errors.join('\n')}`);
        }
        return true;
    }

    /**
     * 登録を禁止（起動完了後に呼び出し）
     */
    freeze() {
        this._isFrozen = true;
    }

    /**
     * コンテナがフリーズされているか確認
     * @returns {boolean}
     */
    isFrozen() {
        return this._isFrozen;
    }

    /**
     * 全サービスのリソースを解放（シャットダウン時に呼び出し）
     * サービスがdispose()メソッドを持つ場合、それを呼び出す
     */
    dispose() {
        for (const [name, service] of this.services) {
            if (service.instance?.dispose) {
                try {
                    service.instance.dispose();
                } catch (error) {
                    console.error(`Failed to dispose "${name}":`, error);
                }
            }
        }
        this.services.clear();
        this._resolving.clear();
        this._isFrozen = false;
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
