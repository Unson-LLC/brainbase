// @ts-check
/**
 * SessionManager
 * テスト互換用の wrapper。production code は createSessionServices() を使う。
 */
import { createSessionServices } from './create-session-services.js';

export class SessionManager {
    constructor(options = {}) {
        const services = createSessionServices(options);
        services.sessionApi.services = services;
        return services.sessionApi;
    }
}
