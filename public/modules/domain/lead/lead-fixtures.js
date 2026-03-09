function deepClone(value) {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }

    return JSON.parse(JSON.stringify(value));
}

export const LEAD_BUILDING_TAB_MAP = {
    'building-validation-lab': '割り振り支援',
    'building-evidence-vault': '証跡確認',
    'building-approval-gate': 'リスク確認',
    'building-execution-hall': '状況要約'
};

export const LEAD_V0_FIXTURE = {
    district: {
        id: 'district-retention-improvement',
        name: '継続率改善区画',
        objective: '初回設定完了率を今週 8% 改善'
    },
    buildings: [
        { id: 'building-execution-hall', name: '実行棟', kind: 'execution' },
        { id: 'building-evidence-vault', name: '証跡庫', kind: 'evidence' },
        { id: 'building-approval-gate', name: '承認ゲート', kind: 'approval' },
        { id: 'building-validation-lab', name: '検証棟', kind: 'validation' }
    ],
    anomalies: [
        {
            id: 'anomaly-setup-evidence-gap',
            name: '比較資料不足',
            decisionItemId: 'decision-setup-simplification',
            initiativeId: 'initiative-setup-simplification',
            severity: 'high'
        },
        {
            id: 'anomaly-copy-approval-pending',
            name: '承認待ち',
            decisionItemId: 'decision-copy-change',
            initiativeId: 'initiative-copy-change',
            severity: 'medium'
        },
        {
            id: 'anomaly-mail-execution-failure',
            name: '実行失敗',
            decisionItemId: 'decision-mail-recovery',
            initiativeId: 'initiative-mail-recovery',
            severity: 'high'
        },
        {
            id: 'anomaly-onboard-stalled',
            name: '停滞中',
            decisionItemId: 'decision-onboard-stalled',
            initiativeId: 'initiative-onboard-ab',
            severity: 'medium'
        }
    ],
    initiatives: [
        {
            id: 'initiative-setup-simplification',
            title: '初回設定簡略化',
            stage: '検証',
            scope: '標準対象',
            executionHealth: '停滞中',
            evidenceState: '成果物不足',
            approvalState: '承認待ちなし',
            escalationState: '未上申',
            attentionLevel: '高',
            buildingId: 'building-validation-lab',
            subtitle: '比較資料不足',
            anomalyIds: ['anomaly-setup-evidence-gap']
        },
        {
            id: 'initiative-copy-change',
            title: '解約理由の聞き方変更',
            stage: '承認前確認',
            scope: '限定顧客のみ',
            executionHealth: '正常',
            evidenceState: '充足',
            approvalState: '承認待ち',
            escalationState: '未上申',
            attentionLevel: '中',
            buildingId: 'building-approval-gate',
            subtitle: '対象限定なら可',
            anomalyIds: ['anomaly-copy-approval-pending']
        },
        {
            id: 'initiative-mail-recovery',
            title: '継続率メール改善案',
            stage: '実行',
            scope: '標準対象',
            executionHealth: '実行失敗',
            evidenceState: '充足',
            approvalState: '承認不要',
            escalationState: '候補',
            attentionLevel: '高',
            buildingId: 'building-execution-hall',
            subtitle: 'ハルが回復案を検討',
            anomalyIds: ['anomaly-mail-execution-failure']
        },
        {
            id: 'initiative-onboard-ab',
            title: 'オンボード導線AB',
            stage: '証跡整理',
            scope: '標準対象',
            executionHealth: '停滞中',
            evidenceState: '収集中',
            approvalState: '承認不要',
            escalationState: '未上申',
            attentionLevel: '中',
            buildingId: 'building-evidence-vault',
            subtitle: 'ミナが比較表を作成',
            anomalyIds: ['anomaly-onboard-stalled']
        }
    ],
    decisionItems: [
        {
            id: 'decision-setup-simplification',
            initiativeId: 'initiative-setup-simplification',
            title: '初回設定簡略化',
            status: 'artifact_missing',
            statusLabel: '成果物不足',
            primaryCause: '比較資料不足',
            secondaryCause: '根拠リンクが弱い',
            overallRisk: '中',
            impactRange: '検証精度が落ちる',
            requiredEvidence: ['ベンチマーク比較表', '根拠リンク'],
            approvalTopics: [],
            relatedActorIds: ['actor-kai', 'actor-mina'],
            anomalyId: 'anomaly-setup-evidence-gap',
            options: [
                {
                    id: 'option-request-artifact',
                    label: '比較資料を先に補完',
                    risk: '低',
                    evidenceNeed: '比較表2点',
                    approvalNeed: '不要'
                },
                {
                    id: 'option-alternative-evidence',
                    label: '代替証跡で先に進める',
                    risk: '中',
                    evidenceNeed: '既存比較メモ',
                    approvalNeed: '現場責任者'
                },
                {
                    id: 'option-reroute-setup',
                    label: '証跡整理AIを追加して再開',
                    risk: '低',
                    evidenceNeed: '比較表1点',
                    approvalNeed: '不要'
                }
            ]
        },
        {
            id: 'decision-copy-change',
            initiativeId: 'initiative-copy-change',
            title: '解約理由の聞き方変更',
            status: 'approval_pending',
            statusLabel: '承認待ち',
            primaryCause: '対象顧客の境界が曖昧',
            secondaryCause: '文言差分の適用条件確認',
            overallRisk: '中',
            impactRange: '限定顧客',
            requiredEvidence: ['文言差分比較', '顧客群一覧'],
            approvalTopics: ['対象顧客の範囲', '実施タイミング'],
            relatedActorIds: ['actor-sui', 'actor-kai'],
            anomalyId: 'anomaly-copy-approval-pending',
            options: [
                {
                    id: 'option-approve-copy',
                    label: '限定顧客で承認',
                    risk: '低',
                    evidenceNeed: '現状で足りる',
                    approvalNeed: '現場責任者'
                },
                {
                    id: 'option-constrained-approve-copy',
                    label: '条件付きで承認',
                    risk: '中',
                    evidenceNeed: '顧客群条件メモ',
                    approvalNeed: '現場責任者'
                },
                {
                    id: 'option-return-copy',
                    label: '境界整理を差し戻す',
                    risk: '低',
                    evidenceNeed: '追加証跡不要',
                    approvalNeed: '不要'
                }
            ]
        },
        {
            id: 'decision-mail-recovery',
            initiativeId: 'initiative-mail-recovery',
            title: '継続率メール改善案',
            status: 'execution_failed',
            statusLabel: '実行失敗',
            primaryCause: '失敗理由が割れている',
            secondaryCause: '他施策へ影響が出始めた',
            overallRisk: '高',
            impactRange: '他施策2件に波及',
            requiredEvidence: ['失敗比較表'],
            approvalTopics: [],
            relatedActorIds: ['actor-haru', 'actor-nagi'],
            anomalyId: 'anomaly-mail-execution-failure',
            options: [
                {
                    id: 'option-retry-mail',
                    label: '同経路で再実行',
                    risk: '中',
                    evidenceNeed: '失敗比較表',
                    approvalNeed: '不要'
                },
                {
                    id: 'option-alt-route-mail',
                    label: '別経路で実行',
                    risk: '中',
                    evidenceNeed: '別経路案',
                    approvalNeed: '現場責任者'
                },
                {
                    id: 'option-stabilize-mail',
                    label: '停止して整理する',
                    risk: '低',
                    evidenceNeed: '失敗比較表',
                    approvalNeed: '不要'
                }
            ]
        },
        {
            id: 'decision-onboard-stalled',
            initiativeId: 'initiative-onboard-ab',
            title: 'オンボード導線AB',
            status: 'stalled',
            statusLabel: '停滞中',
            primaryCause: '比較表の更新待ち',
            secondaryCause: '対象顧客の絞り条件が揺れている',
            overallRisk: '中',
            impactRange: '次の検証着手が遅れる',
            requiredEvidence: ['比較表更新版'],
            approvalTopics: [],
            relatedActorIds: ['actor-mina', 'actor-kai'],
            anomalyId: 'anomaly-onboard-stalled',
            options: [
                {
                    id: 'option-reroute-onboard',
                    label: '比較表担当を再割り振り',
                    risk: '低',
                    evidenceNeed: '比較表更新版',
                    approvalNeed: '不要'
                },
                {
                    id: 'option-scope-onboard',
                    label: '対象群を絞って先行',
                    risk: '中',
                    evidenceNeed: '対象群メモ',
                    approvalNeed: '現場責任者'
                },
                {
                    id: 'option-briefing-onboard',
                    label: '論点整理室で整理する',
                    risk: '低',
                    evidenceNeed: '既存メモ',
                    approvalNeed: '不要'
                }
            ]
        }
    ],
    actors: [
        {
            id: 'actor-kai',
            name: 'カイ',
            role: '現場統括AI',
            buildingId: 'building-validation-lab',
            currentInitiativeId: 'initiative-setup-simplification',
            discretionScope: '検証枠の再割り振りまで可能',
            shortThought: '検証枠を1つ空ける',
            status: '要注意案件を担当中'
        },
        {
            id: 'actor-ren',
            name: 'レン',
            role: '割り振りAI',
            buildingId: 'building-validation-lab',
            currentInitiativeId: 'initiative-setup-simplification',
            discretionScope: 'worker追加提案まで可能',
            shortThought: 'worker 1枠追加',
            status: '今アクティブ'
        },
        {
            id: 'actor-mina',
            name: 'ミナ',
            role: '証跡整理AI',
            buildingId: 'building-evidence-vault',
            currentInitiativeId: 'initiative-setup-simplification',
            discretionScope: '比較資料と根拠リンクの補完',
            shortThought: '比較表2/3完了',
            status: '今アクティブ'
        },
        {
            id: 'actor-sui',
            name: 'スイ',
            role: '統制確認AI',
            buildingId: 'building-approval-gate',
            currentInitiativeId: 'initiative-copy-change',
            discretionScope: '条件付き承認の論点整理',
            shortThought: '対象拡張は境界外',
            status: '今アクティブ'
        },
        {
            id: 'actor-haru',
            name: 'ハル',
            role: '回復担当AI',
            buildingId: 'building-execution-hall',
            currentInitiativeId: 'initiative-mail-recovery',
            discretionScope: '回復経路の提案と引き継ぎ',
            shortThought: '回復案Bが有望',
            status: '要注意案件を担当中'
        },
        {
            id: 'actor-nagi',
            name: 'ナギ',
            role: '上申整理AI',
            buildingId: 'building-execution-hall',
            currentInitiativeId: 'initiative-mail-recovery',
            discretionScope: '上申要点を3行に圧縮',
            shortThought: '上申要点を更新',
            status: '待機中'
        }
    ],
    records: {
        decisionMemos: [],
        escalationPackets: [],
        artifactRequests: []
    }
};

export function createLeadFixtureSnapshot() {
    return deepClone(LEAD_V0_FIXTURE);
}

export function cloneLeadValue(value) {
    return deepClone(value);
}
