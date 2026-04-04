// @ts-check
/**
 * NocoDBIssueRepository
 * NocoDB課題APIとの通信を抽象化
 */
export class NocoDBIssueRepository {
    constructor({ httpClient }) {
        this.http = httpClient;
    }

    async fetchAllIssues() {
        return this.http.get('/api/nocodb/issues');
    }

    async createIssue(payload) {
        return this.http.post('/api/nocodb/issues', payload);
    }

    async updateIssue(recordId, baseId, fields) {
        return this.http.put(`/api/nocodb/issues/${recordId}`, { baseId, fields });
    }
}
