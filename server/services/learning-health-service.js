import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import util from 'util';

const execFilePromise = util.promisify(execFile);

function toIso(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
}

function parseLaunchctlList(output = '') {
    const exitStatusMatch = output.match(/"LastExitStatus"\s*=\s*([0-9-]+)/);
    const pidMatch = output.match(/"PID"\s*=\s*([0-9-]+)/);
    return {
        loaded: output.includes('"Label" = "com.brainbase.learning"'),
        lastExitStatus: exitStatusMatch ? Number(exitStatusMatch[1]) : null,
        pid: pidMatch ? Number(pidMatch[1]) : null
    };
}

function parsePlistSchedule(text = '') {
    const hourMatch = text.match(/<key>Hour<\/key>\s*<integer>(\d+)<\/integer>/);
    const minuteMatch = text.match(/<key>Minute<\/key>\s*<integer>(\d+)<\/integer>/);
    return {
        hour: hourMatch ? Number(hourMatch[1]) : 21,
        minute: minuteMatch ? Number(minuteMatch[1]) : 0
    };
}

function computeExpectedRunAt(now, schedule) {
    const date = new Date(now);
    date.setHours(schedule.hour, schedule.minute, 0, 0);
    if (date.getTime() > now.getTime()) {
        date.setDate(date.getDate() - 1);
    }
    return date;
}

async function readJsonIfExists(filePath) {
    try {
        const text = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(text);
    } catch {
        return null;
    }
}

async function readTextIfExists(filePath) {
    try {
        return await fs.readFile(filePath, 'utf-8');
    } catch {
        return '';
    }
}

async function statIfExists(filePath) {
    try {
        return await fs.stat(filePath);
    } catch {
        return null;
    }
}

export class LearningHealthService {
    constructor({
        label = 'com.brainbase.learning',
        launchAgentPath = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.brainbase.learning.plist'),
        stateDir = path.join(os.homedir(), 'workspace', 'var', 'learning'),
        graceMinutes = 30
    } = {}) {
        this.label = label;
        this.launchAgentPath = launchAgentPath;
        this.stateDir = stateDir;
        this.graceMinutes = graceMinutes;
    }

    async _getLaunchctlState() {
        try {
            const { stdout } = await execFilePromise('launchctl', ['list', this.label]);
            return parseLaunchctlList(stdout);
        } catch (error) {
            return {
                loaded: false,
                lastExitStatus: null,
                pid: null,
                error: error?.message || String(error)
            };
        }
    }

    async getHealth(now = new Date()) {
        const summaryPath = path.join(this.stateDir, 'daily-summary.json');
        const varDir = path.dirname(this.stateDir);
        const stdoutLogPath = path.join(varDir, 'logs', 'learning-stdout.log');
        const stderrLogPath = path.join(varDir, 'logs', 'learning-stderr.log');

        const [launchctlState, plistStat, plistText, summary, summaryStat, stderrText, stderrStat] = await Promise.all([
            this._getLaunchctlState(),
            statIfExists(this.launchAgentPath),
            readTextIfExists(this.launchAgentPath),
            readJsonIfExists(summaryPath),
            statIfExists(summaryPath),
            readTextIfExists(stderrLogPath),
            statIfExists(stderrLogPath)
        ]);

        const schedule = parsePlistSchedule(plistText);
        const expectedRunAt = computeExpectedRunAt(now, schedule);
        const graceDeadlineAt = new Date(expectedRunAt.getTime() + this.graceMinutes * 60 * 1000);

        const generatedAt = summary?.generated_at
            ? new Date(summary.generated_at)
            : summaryStat?.mtime || null;
        const lastSuccessAt = generatedAt && !Number.isNaN(generatedAt.getTime()) ? generatedAt : null;
        const stderrIsRecent = Boolean(
            stderrText.trim()
            && stderrStat?.mtime
            && (!lastSuccessAt || stderrStat.mtime.getTime() > lastSuccessAt.getTime())
        );

        let status = 'healthy';
        let message = '学習の日次ジョブは正常です。';

        if (!plistStat || !launchctlState.loaded) {
            status = 'unconfigured';
            message = '学習の日次ジョブが launchd に登録されていません。';
        } else if ((launchctlState.lastExitStatus ?? 0) !== 0 || stderrIsRecent) {
            status = 'error';
            message = '学習の日次ジョブの直近実行でエラーが発生しています。';
        } else if (now.getTime() >= graceDeadlineAt.getTime() && (!lastSuccessAt || lastSuccessAt.getTime() < expectedRunAt.getTime())) {
            status = 'stale';
            message = '学習の日次ジョブが予定どおり更新されていません。';
        }

        return {
            status,
            label: this.label,
            message,
            issue_key: `${status}:${expectedRunAt.toISOString()}:${launchctlState.lastExitStatus ?? 0}`,
            agent_loaded: Boolean(plistStat && launchctlState.loaded),
            last_success_at: toIso(lastSuccessAt),
            expected_run_at: toIso(expectedRunAt),
            grace_deadline_at: toIso(graceDeadlineAt),
            last_exit_status: launchctlState.lastExitStatus,
            pid: launchctlState.pid,
            summary_path: summaryPath,
            stdout_log_path: stdoutLogPath,
            stderr_log_path: stderrLogPath
        };
    }
}
