/**
 * Config Parser - brainbaseの設定ファイル（YAML）を読み取り、統合ビューを提供
 */

import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';

export class ConfigParser {
    constructor(codexPath, configPath) {
        this.codexPath = codexPath;
        this.configPath = configPath;
        this.slackDir = path.join(codexPath, 'common/meta/slack');
    }

    /**
     * Slackワークスペース一覧を取得
     */
    async getWorkspaces() {
        try {
            const content = await fs.readFile(
                path.join(this.slackDir, 'workspaces.yml'),
                'utf-8'
            );
            const data = yaml.load(content);
            return data.workspaces || {};
        } catch (err) {
            console.error('Failed to load workspaces.yml:', err.message);
            return {};
        }
    }

    /**
     * Slackチャンネル一覧を取得
     */
    async getChannels() {
        try {
            const content = await fs.readFile(
                path.join(this.slackDir, 'channels.yml'),
                'utf-8'
            );
            const data = yaml.load(content);
            return data.channels || [];
        } catch (err) {
            console.error('Failed to load channels.yml:', err.message);
            return [];
        }
    }

    /**
     * Slackメンバー一覧を取得
     */
    async getMembers() {
        try {
            const content = await fs.readFile(
                path.join(this.slackDir, 'members.yml'),
                'utf-8'
            );
            const data = yaml.load(content);
            return data.members || [];
        } catch (err) {
            console.error('Failed to load members.yml:', err.message);
            return [];
        }
    }

    /**
     * プロジェクト設定（config.yml）を取得
     */
    async getProjects() {
        try {
            const content = await fs.readFile(this.configPath, 'utf-8');
            const data = yaml.load(content);
            return {
                root: data.root,
                projects: data.projects || []
            };
        } catch (err) {
            console.error('Failed to load config.yml:', err.message);
            return { root: '', projects: [] };
        }
    }

    /**
     * 全設定を統合して取得
     */
    async getAll() {
        const [workspaces, channels, members, projectConfig] = await Promise.all([
            this.getWorkspaces(),
            this.getChannels(),
            this.getMembers(),
            this.getProjects()
        ]);

        return {
            slack: {
                workspaces,
                channels,
                members
            },
            projects: projectConfig
        };
    }

    /**
     * 整合性チェック
     * - チャンネルに定義されているが、プロジェクトに存在しないproject_id
     * - ワークスペースに定義されているが、チャンネルがないワークスペース
     * - 重複したSlack ID
     */
    async checkIntegrity() {
        const [workspaces, channels, members, projectConfig] = await Promise.all([
            this.getWorkspaces(),
            this.getChannels(),
            this.getMembers(),
            this.getProjects()
        ]);

        const issues = [];

        // プロジェクトIDのセットを作成
        const configProjectIds = new Set(
            projectConfig.projects.map(p => p.id)
        );

        // ワークスペースで定義されているプロジェクトIDのセット
        const workspaceProjectIds = new Set();
        Object.values(workspaces).forEach(ws => {
            (ws.projects || []).forEach(pid => workspaceProjectIds.add(pid));
        });

        // チャンネルで使われているプロジェクトIDのセット
        const channelProjectIds = new Set(
            channels.map(ch => ch.project_id)
        );

        // 1. チャンネルのproject_idがconfig.ymlに存在するか
        // proj_otherは意図的な「その他」カテゴリなので除外
        const ignoredProjectIds = new Set(['proj_other', 'other']);

        channelProjectIds.forEach(pid => {
            // 除外リストにあるプロジェクトはスキップ
            if (ignoredProjectIds.has(pid)) return;

            // proj_xxx → xxxに変換してチェック
            const shortId = pid.replace(/^proj_/, '');
            if (!configProjectIds.has(shortId) && !configProjectIds.has(pid)) {
                issues.push({
                    type: 'missing_project',
                    severity: 'warning',
                    message: `Channel uses project_id "${pid}" but not found in config.yml`,
                    source: 'channels.yml'
                });
            }
        });

        // 2. ワークスペースごとのチャンネル数をカウント
        const workspaceChannelCount = {};
        channels.forEach(ch => {
            workspaceChannelCount[ch.workspace] = (workspaceChannelCount[ch.workspace] || 0) + 1;
        });

        Object.keys(workspaces).forEach(wsKey => {
            if (!workspaceChannelCount[wsKey]) {
                issues.push({
                    type: 'empty_workspace',
                    severity: 'info',
                    message: `Workspace "${wsKey}" has no mapped channels`,
                    source: 'workspaces.yml'
                });
            }
        });

        // 3. メンバーの重複チェック（同じslack_idが複数ある場合）
        const slackIdCount = {};
        members.forEach(m => {
            slackIdCount[m.slack_id] = (slackIdCount[m.slack_id] || 0) + 1;
        });

        Object.entries(slackIdCount).forEach(([slackId, count]) => {
            if (count > 1) {
                const memberNames = members
                    .filter(m => m.slack_id === slackId)
                    .map(m => m.brainbase_name);
                // 同一人物のサブアカウントの場合は問題なし
                const uniqueNames = [...new Set(memberNames)];
                if (uniqueNames.length > 1) {
                    issues.push({
                        type: 'duplicate_slack_id',
                        severity: 'error',
                        message: `Slack ID "${slackId}" is mapped to multiple people: ${uniqueNames.join(', ')}`,
                        source: 'members.yml'
                    });
                }
            }
        });

        // 4. チャンネルの重複チェック
        const channelIdCount = {};
        channels.forEach(ch => {
            channelIdCount[ch.channel_id] = (channelIdCount[ch.channel_id] || 0) + 1;
        });

        Object.entries(channelIdCount).forEach(([channelId, count]) => {
            if (count > 1) {
                issues.push({
                    type: 'duplicate_channel_id',
                    severity: 'warning',
                    message: `Channel ID "${channelId}" appears ${count} times`,
                    source: 'channels.yml'
                });
            }
        });

        return {
            issues,
            summary: {
                total: issues.length,
                errors: issues.filter(i => i.severity === 'error').length,
                warnings: issues.filter(i => i.severity === 'warning').length,
                info: issues.filter(i => i.severity === 'info').length
            },
            stats: {
                workspaces: Object.keys(workspaces).length,
                channels: channels.length,
                members: members.length,
                projects: projectConfig.projects.length
            }
        };
    }
}
