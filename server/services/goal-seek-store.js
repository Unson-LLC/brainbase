/**
 * GoalSeekStore V2
 *
 * ゴール・問題・エスカレーション・タイムラインの永続化ストア
 * var/goals.json に保存
 */

import fs from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export class GoalSeekStore {
    /**
     * @param {string} varDir - var/ ディレクトリパス
     */
    constructor(varDir) {
        this.filePath = path.join(varDir || 'var', 'goals.json');
        this.data = {
            goals: [],
            problems: [],
            escalations: [],
            timeline: []
        };
    }

    async init() {
        try {
            if (existsSync(this.filePath)) {
                const raw = readFileSync(this.filePath, 'utf-8');
                const parsed = JSON.parse(raw);
                this.data = {
                    goals: parsed.goals || [],
                    problems: parsed.problems || [],
                    escalations: parsed.escalations || [],
                    timeline: parsed.timeline || []
                };
            }
        } catch (err) {
            console.warn('[GoalSeekStore] Failed to load goals.json, starting fresh:', err.message);
        }
    }

    async _save() {
        try {
            const dir = path.dirname(this.filePath);
            if (!existsSync(dir)) {
                await fs.mkdir(dir, { recursive: true });
            }
            await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2));
        } catch (err) {
            console.error('[GoalSeekStore] Failed to save:', err.message);
        }
    }

    // ========== Goal CRUD ==========

    createGoal({ sessionId, title, description, criteria, managerConfig }) {
        const goal = {
            id: `goal_${randomUUID().slice(0, 8)}`,
            sessionId,
            title: title || '',
            description: description || '',
            criteria: {
                commit: criteria?.commit || [],
                signal: criteria?.signal || []
            },
            status: 'active',
            managerConfig: {
                autoAnswerLevel: managerConfig?.autoAnswerLevel || 'moderate'
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        this.data.goals.push(goal);
        this._save();
        return goal;
    }

    getGoal(id) {
        return this.data.goals.find(g => g.id === id) || null;
    }

    getGoalBySessionId(sessionId) {
        return this.data.goals.find(g => g.sessionId === sessionId && g.status !== 'completed' && g.status !== 'failed') || null;
    }

    getAllGoals() {
        return [...this.data.goals];
    }

    updateGoal(id, updates) {
        const idx = this.data.goals.findIndex(g => g.id === id);
        if (idx === -1) return null;

        const allowed = ['title', 'description', 'criteria', 'status', 'managerConfig'];
        for (const key of allowed) {
            if (updates[key] !== undefined) {
                this.data.goals[idx][key] = updates[key];
            }
        }
        this.data.goals[idx].updatedAt = new Date().toISOString();
        this._save();
        return this.data.goals[idx];
    }

    deleteGoal(id) {
        const idx = this.data.goals.findIndex(g => g.id === id);
        if (idx === -1) return false;
        this.data.goals.splice(idx, 1);
        this.data.problems = this.data.problems.filter(p => p.goalId !== id);
        this.data.escalations = this.data.escalations.filter(e => e.goalId !== id);
        this.data.timeline = this.data.timeline.filter(t => t.goalId !== id);
        this._save();
        return true;
    }

    // ========== Problem CRUD ==========

    addProblem({ goalId, sessionId, type, severity, title, description, analysisBy, suggestedActions }) {
        const problem = {
            id: `prob_${randomUUID().slice(0, 8)}`,
            goalId,
            sessionId,
            type,
            severity,
            title: title || '',
            description: description || '',
            analysisBy: analysisBy || 'detector',
            suggestedActions: suggestedActions || [],
            status: 'detected',
            timestamp: new Date().toISOString()
        };
        this.data.problems.push(problem);
        this._save();
        return problem;
    }

    getProblems(goalId) {
        return this.data.problems.filter(p => p.goalId === goalId);
    }

    updateProblemStatus(id, status) {
        const problem = this.data.problems.find(p => p.id === id);
        if (!problem) return null;
        problem.status = status;
        this._save();
        return problem;
    }

    // ========== Escalation CRUD ==========

    addEscalation({ goalId, sessionId, problemId, question, context, options }) {
        const escalation = {
            id: `esc_${randomUUID().slice(0, 8)}`,
            goalId,
            sessionId,
            problemId: problemId || null,
            question,
            context: context || '',
            options: options || [],
            status: 'pending',
            response: null,
            timestamp: new Date().toISOString()
        };
        this.data.escalations.push(escalation);
        this._save();
        return escalation;
    }

    getEscalation(id) {
        return this.data.escalations.find(e => e.id === id) || null;
    }

    getPendingEscalations(goalId) {
        return this.data.escalations.filter(e => e.goalId === goalId && e.status === 'pending');
    }

    respondToEscalation(id, response) {
        const escalation = this.data.escalations.find(e => e.id === id);
        if (!escalation) return null;
        escalation.status = 'responded';
        escalation.response = response;
        escalation.respondedAt = new Date().toISOString();
        this._save();
        return escalation;
    }

    // ========== Timeline ==========

    addTimelineEntry({ goalId, type, summary, details }) {
        const entry = {
            id: `tl_${randomUUID().slice(0, 8)}`,
            goalId,
            timestamp: new Date().toISOString(),
            type,
            summary: summary || '',
            details: details || ''
        };
        this.data.timeline.push(entry);
        this._save();
        return entry;
    }

    getTimeline(goalId) {
        return this.data.timeline
            .filter(t => t.goalId === goalId)
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }
}
