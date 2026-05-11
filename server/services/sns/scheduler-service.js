// @ts-check
/**
 * In-memory scheduler (SPEC-sns-posting-engine INV-4)
 * 旧 scheduled_post_runner.py 相当
 */

import { randomBytes } from 'crypto';

export class SchedulerService {
    constructor() {
        /** @type {Map<string, {run_at:Date, actor:any, input:any, fired:boolean}>} */
        this.jobs = new Map();
    }

    /**
     * @param {{run_at: Date|string, actor: any, input: any}} job
     * @returns {string} job_id
     */
    schedule(job) {
        const id = `job_${Date.now()}_${randomBytes(4).toString('hex')}`;
        const run_at = job.run_at instanceof Date ? job.run_at : new Date(job.run_at);
        this.jobs.set(id, { run_at, actor: job.actor, input: job.input, fired: false });
        return id;
    }

    /**
     * 現在時刻で due の job を発火
     * @param {Date} now
     * @param {(job:any) => Promise<any>} executor
     * @returns {Promise<{fired:number, results: Array<any>}>}
     */
    async tick(now, executor) {
        const results = [];
        let fired = 0;
        for (const [id, job] of this.jobs.entries()) {
            if (job.fired) continue;
            if (job.run_at <= now) {
                job.fired = true;
                fired += 1;
                const r = await executor({ id, ...job });
                results.push({ job_id: id, result: r });
            }
        }
        return { fired, results };
    }

    cancel(job_id) {
        return this.jobs.delete(job_id);
    }

    list() {
        return Array.from(this.jobs.entries()).map(([id, j]) => ({ id, ...j }));
    }
}
