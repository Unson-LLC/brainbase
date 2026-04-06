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
        this._overlayCache = null;
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
     * ポータルオーバーレイデータをロード（拡張API）
     * @param {string} projectCode
     * @returns {Promise<Object>}
     */
    async loadPortalOverlay(projectCode) {
        try {
            this._currentProject = projectCode;
            const data = await this.http.get(`/api/brainbase/portal/${projectCode}`);
            this._overlayCache = data;
            eventBus.emit(EVENTS.PORTAL_OVERLAY_DATA_LOADED, { projectCode, data });
            return data;
        } catch (error) {
            eventBus.emit(EVENTS.PORTAL_OVERLAY_DATA_ERROR, { projectCode, error: error.message });
            throw error;
        }
    }

    /**
     * Value Loopだけリフレッシュ
     * @param {string} projectCode
     * @returns {Promise<Object>}
     */
    async refreshValueLoop(projectCode) {
        try {
            const data = await this.http.get(`/api/brainbase/portal/${projectCode}/value-loop`);
            if (this._overlayCache) {
                this._overlayCache.valueLoop = data;
            }
            eventBus.emit(EVENTS.PORTAL_OVERLAY_DATA_LOADED, { projectCode, data: this._overlayCache, partial: 'valueLoop' });
            return data;
        } catch (error) {
            eventBus.emit(EVENTS.PORTAL_OVERLAY_DATA_ERROR, { projectCode, error: error.message });
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
     * キャッシュされたオーバーレイデータを取得
     */
    getOverlayData() {
        return this._overlayCache;
    }

    /**
     * 現在のプロジェクトコード
     */
    getCurrentProject() {
        return this._currentProject;
    }
}
