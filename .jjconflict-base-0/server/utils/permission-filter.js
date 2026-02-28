/**
 * Permission Filtering Utilities
 *
 * Phase 1: PostgreSQLベース権限管理システム
 * Story: E1-003.1
 *
 * 権限フィルタリングのロジック実装
 * - SecurityLevel判定
 * - ProjectAccess判定
 * - 業務委託制限判定
 */

class PermissionFilter {
    /**
     * SecurityLevel判定
     * @param {number} userLevel - ユーザーのアクセスレベル（1〜4）
     * @param {string} contentSecurityLevel - コンテンツのセキュリティレベル
     * @returns {boolean} アクセス可能かどうか
     */
    checkSecurityLevel(userLevel, contentSecurityLevel) {
        const securityLevelMap = {
            'PUBLIC': 1,
            'PROJECT_SENSITIVE': 3,
            'INTERNAL': 3,
            'CONFIDENTIAL': 4
        };

        const requiredLevel = securityLevelMap[contentSecurityLevel];
        if (requiredLevel === undefined) {
            // 未定義のセキュリティレベルはPUBLIC扱い
            return userLevel >= 1;
        }

        return userLevel >= requiredLevel;
    }

    /**
     * ProjectAccess判定
     * @param {number} userLevel - ユーザーのアクセスレベル
     * @param {Array<string>} userProjects - ユーザーのアサイン済みプロジェクト
     * @param {string} contentProject - コンテンツのプロジェクトID
     * @returns {boolean} アクセス可能かどうか
     */
    checkProjectAccess(userLevel, userProjects, contentProject) {
        // Level 3以上は全プロジェクトアクセス可
        if (userLevel >= 3) {
            return true;
        }

        // Level 1〜2は明示的にアサインされたプロジェクトのみ
        return userProjects.includes(contentProject);
    }

    /**
     * 業務委託制限判定（仕様確定: partnerはisContractor=false）
     * @param {string} employmentType - ユーザーの雇用形態
     * @param {boolean} contentInternalOnly - コンテンツがinternal専用かどうか
     * @returns {boolean} アクセス可能かどうか
     */
    checkContractorRestriction(employmentType, contentInternalOnly) {
        // internalOnly=falseのコンテンツは全員アクセス可
        if (!contentInternalOnly) {
            return true;
        }

        // internalOnly=trueのコンテンツは、業務委託（contractor）は不可
        // 仕様確定: partnerはisContractor=false扱いなのでアクセス可
        const isContractor = (employmentType === 'contractor');
        return !isContractor;
    }

    /**
     * 複合権限チェック（統合ヘルパー）
     * @param {Object} user - ユーザー情報
     * @param {number} user.level - アクセスレベル
     * @param {string} user.employmentType - 雇用形態
     * @param {Array<string>} user.projects - アサイン済みプロジェクト
     * @param {Object} content - コンテンツ情報
     * @param {string} content.securityLevel - セキュリティレベル
     * @param {string} content.projectId - プロジェクトID
     * @param {boolean} content.internalOnly - 内部限定フラグ
     * @returns {boolean} アクセス可能かどうか
     */
    hasAccessToContent(user, content) {
        // SecurityLevelチェック
        if (!this.checkSecurityLevel(user.level, content.securityLevel)) {
            return false;
        }

        // ProjectAccessチェック（projectIdが指定されている場合のみ）
        if (content.projectId && !this.checkProjectAccess(user.level, user.projects, content.projectId)) {
            return false;
        }

        // 業務委託制限チェック
        if (!this.checkContractorRestriction(user.employmentType, content.internalOnly)) {
            return false;
        }

        return true;
    }
}

// Named export
export { PermissionFilter };

// Default export
export default PermissionFilter;
