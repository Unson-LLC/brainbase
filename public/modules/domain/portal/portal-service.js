// @ts-check
/**
 * PortalService
 * プロジェクトポータルのデータ集約サービス
 * サーバー側の /api/brainbase/portal/:projectCode を呼び出し、
 * 方向性・課題・進捗・チームを1レスポンスで取得する
 */
import { eventBus, EVENTS } from '../../core/event-bus.js';

export class PortalService {
    constructor({ httpClient }) {
        this.http = httpClient;
        this._cache = null;
        this._currentProject = null;
    }

    /**
     * ポータルデータをロード
     * @param {string} projectCode - プロジェクトコード
     * @returns {Promise<Object>}
     */
    async loadPortal(projectCode) {
        try {
            this._currentProject = projectCode;
            const data = await this.http.get(`/api/brainbase/portal/${projectCode}`);
            this._cache = data;
            eventBus.emit(EVENTS.PORTAL_DATA_LOADED, { projectCode, data });
            return data;
        } catch (error) {
            eventBus.emit(EVENTS.PORTAL_DATA_ERROR, { projectCode, error: error.message });
            throw error;
        }
    }

    /**
     * キャッシュされたポータルデータを取得
     */
    getPortalData() {
        return this._cache;
    }

    /**
     * 現在のプロジェクトコード
     */
    getCurrentProject() {
        return this._currentProject;
    }
}
