// @ts-check
/**
 * NocoDBIssueService
 * 課題データの取得・更新・フィルタリング
 */
import { eventBus, EVENTS } from '../../core/event-bus.js';
import { NocoDBIssueAdapter } from './nocodb-issue-adapter.js';
import { NocoDBIssueRepository } from './nocodb-issue-repository.js';
import { appStore } from '../../core/store.js';

export class NocoDBIssueService {
    constructor({ httpClient }) {
        this.repository = new NocoDBIssueRepository({ httpClient });
        this.adapter = new NocoDBIssueAdapter();
    }

    async loadIssues() {
        try {
            const data = await this.repository.fetchAllIssues();
            const issues = (data.records || []).map(r => this.adapter.toInternalIssue(r));

            appStore.setState({ nocodbIssues: issues });
            eventBus.emit(EVENTS.NOCODB_ISSUES_LOADED, { issues, projects: data.projects });
            return issues;
        } catch (error) {
            eventBus.emit(EVENTS.NOCODB_ISSUE_ERROR, { error: error.message });
            throw error;
        }
    }

    async createIssue(payload) {
        try {
            const result = await this.repository.createIssue(payload);
            eventBus.emit(EVENTS.NOCODB_ISSUE_CREATED, result);
            await this.loadIssues();
            return result;
        } catch (error) {
            eventBus.emit(EVENTS.NOCODB_ISSUE_ERROR, { error: error.message });
            throw error;
        }
    }

    async updateIssue(issueId, updates) {
        try {
            const issue = this.getIssueById(issueId);
            if (!issue) throw new Error('Issue not found');

            const fields = this.adapter.toNocoDBFields(updates);
            const result = await this.repository.updateIssue(issue.nocodbRecordId, issue.nocodbBaseId, fields);
            eventBus.emit(EVENTS.NOCODB_ISSUE_UPDATED, result);
            await this.loadIssues();
            return result;
        } catch (error) {
            eventBus.emit(EVENTS.NOCODB_ISSUE_ERROR, { error: error.message });
            throw error;
        }
    }

    getIssueById(id) {
        const issues = appStore.getState().nocodbIssues || [];
        return issues.find(i => i.id === id);
    }

    getFilteredIssues({ project, status, impact } = {}) {
        let issues = appStore.getState().nocodbIssues || [];
        if (project) issues = issues.filter(i => i.project === project);
        if (status) issues = issues.filter(i => i.status === status);
        if (impact) issues = issues.filter(i => i.impact === impact);
        return issues;
    }
}
