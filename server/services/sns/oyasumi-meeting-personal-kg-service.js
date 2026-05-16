// @ts-check
import { DuplicateCandidateError } from '../candidate-store/candidate-repository.js';

const DEFAULT_OWNER_PERSON_ID = 'sato_keigo';
const DEFAULT_ACTOR_PERSON_ID = 'sato_keigo';
const MAX_BODY_LENGTH = 280;

const PROJECT_ORGS = {
    salestailor: ['unson', 'salestailor'],
    brainbase: ['unson'],
    baao: ['unson', 'baao'],
    techknight: ['techknight'],
    zeims: ['unson', 'zeims'],
    ncom: ['unson', 'ncom']
};

const SOURCE_SYSTEM = 'oyasumi-meeting-personal-kg';

function normalizeSpaces(value) {
    return String(value || '').replace(/\s+/gu, ' ').trim();
}

function stripMarkdown(value) {
    return normalizeSpaces(value)
        .replace(/^[-*]\s*/u, '')
        .replace(/[*_`]/gu, '')
        .replace(/:([a-z_]+):/giu, '')
        .trim();
}

function compact(value, max = MAX_BODY_LENGTH) {
    const body = normalizeSpaces(value);
    if (body.length <= max) return body;
    return `${body.slice(0, max - 1).trim()}…`;
}

function idPart(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, '-')
        .replace(/^-|-$/gu, '')
        .slice(0, 80);
}

function projectOrDefault(meeting) {
    if (meeting.project_code) return meeting.project_code;
    if (String(meeting.repo || '').includes('salestailor')) return 'salestailor';
    return 'brainbase';
}

function orgsFor(projectCode) {
    return PROJECT_ORGS[projectCode] || ['unson', projectCode].filter(Boolean);
}

function githubRef(meeting, suffix) {
    return `github:${meeting.repo}:${meeting.path}#${suffix}`;
}

function buildCandidate({ meeting, date, key, category, cognitiveType, body, confidence = 0.78 }) {
    const projectCode = projectOrDefault(meeting);
    const sourceEventId = githubRef(meeting, `${category}:${key}`);
    const meetingSlug = idPart(String(meeting.path || 'meeting').split('/').pop()?.replace(/\.[^.]+$/u, '') || 'meeting');
    const stableId = `oyasumi_${date.replace(/-/gu, '')}_${idPart(projectCode)}_${meetingSlug}_${idPart(key)}`.slice(0, 180);
    return {
        id: stableId,
        cognitive_type: cognitiveType,
        owner_person_id: DEFAULT_OWNER_PERSON_ID,
        actor_person_id: DEFAULT_ACTOR_PERSON_ID,
        source_system: SOURCE_SYSTEM,
        source_event_ids: [sourceEventId],
        workspace: 'github',
        project_code: projectCode,
        org_ids: orgsFor(projectCode),
        project_ids: [projectCode],
        visibility: 'owner',
        sensitivity: 'internal',
        role_min: 'member',
        agency_level: 'synthesize',
        promotion_status: 'candidate',
        requires_approval: true,
        confidence,
        body: compact(body),
        permission_snapshot: {
            oyasumi_meeting_personal_kg: {
                category,
                meeting_date: date,
                repo: meeting.repo,
                path: meeting.path,
                html_url: meeting.html_url || null,
                sha: meeting.sha || null,
                extraction_decision: 'adopted',
                rule_id: key,
                source_ref: sourceEventId
            }
        },
        evidence_ids: [{
            uri: meeting.html_url || sourceEventId,
            source_ref: sourceEventId,
            sha: meeting.sha || null
        }]
    };
}

const ADOPTION_RULES = [
    {
        key: 'ai-sales-agency',
        category: 'sales_philosophy',
        cognitiveType: 'insight',
        matches: (content) => /月20万.*半年500万円/u.test(content) && /営業代行/u.test(content),
        body: 'AI活用支援の相談は月20万から半年500万円規模まで幅があり、営業代行で現金化しながら自社プロダクトの導入機会を作る動線がある。'
    },
    {
        key: 'salestailor-conversion-proof',
        category: 'proof',
        cognitiveType: 'result',
        matches: (content) => /商談化率\s*3%\s*[→\-~〜]\s*10%/u.test(content),
        body: 'Own Proof: SalesTailorは高単価・未定形商材の営業で、商談化率3%から10%への改善実績が評価された。'
    },
    {
        key: 'letter-quality-reduces-rejection',
        category: 'sales_philosophy',
        cognitiveType: 'insight',
        matches: (content) => /文面.*断られることがほぼなく/u.test(content) || /文面作成.*本質的に伸びる/u.test(content),
        body: 'SalesTailorの手紙営業では、文面の質と相手理解を上げることで、断られにくい信頼形成を作れる。AI時代でも営業の価値は文面の審美眼に残る。'
    },
    {
        key: 'ai-adoption-aesthetic-judgment',
        category: 'operating_principle',
        cognitiveType: 'preference',
        matches: (content) => /組織的活用.*3%未満/u.test(content) || /重要なのは審美眼/u.test(content),
        body: 'AI活用で差が出るのはツール利用そのものではなく、何が良い出力かを見抜く審美眼と、組織で使える形に落とす運用設計である。'
    },
    {
        key: 'sales-prompt-knowledge-sharing',
        category: 'operating_principle',
        cognitiveType: 'preference',
        matches: (content) => /AIプロンプト.*Slack.*DM/u.test(content) || /生意気なChatGPTプロンプト/u.test(content),
        body: 'AI活用の学習は、抽象論ではなく現場で使えるプロンプトや判断基準を共有し、相手の業務文脈に合わせて使える状態にすることが重要である。'
    }
];

const MEDICAL_PATTERN = /医療|健康|病気|疾患|心臓|大動脈|気管|手術|医師|症状|遺伝/u;
const PRIVATE_PATTERN = /家族|娘|息子|奥様|妻|夫婦|個人的な近況|プライベート/u;
const COUNTERPARTY_CONFIDENTIAL_PATTERN = /顧問先|月5[〜~\-]10件|月額予算|未公開|NDA/u;

function extractSections(content) {
    const lines = String(content || '').split('\n');
    /** @type {Array<{title: string, body: string}>} */
    const sections = [];
    let current = { title: 'document', body: '' };

    for (const rawLine of lines) {
        const line = rawLine.trim();
        const headingMatch = line.match(/^(#{1,3}\s+|:[a-z_]+:\s*)?[*#\s]*([^*\n#]+?)[*#\s]*$/iu);
        const looksLikeHeading = /^#{1,3}\s+/u.test(line) || /^:[a-z_]+:\s*\*/iu.test(line);
        if (looksLikeHeading && headingMatch) {
            if (current.body.trim()) sections.push(current);
            current = { title: stripMarkdown(line), body: '' };
        } else {
            current.body += `${rawLine}\n`;
        }
    }
    if (current.body.trim()) sections.push(current);
    return sections;
}

function rejectSensitiveSections(meeting, date) {
    const rejected = [];
    for (const section of extractSections(meeting.content || '')) {
        const text = `${section.title}\n${section.body}`;
        const hasMedical = MEDICAL_PATTERN.test(text);
        const hasPrivate = PRIVATE_PATTERN.test(text);
        if (!hasMedical && !hasPrivate) continue;
        const reason = hasMedical ? 'medical_or_health' : 'private_or_family';
        rejected.push({
            reason,
            source_ref: githubRef(meeting, `section:${idPart(section.title || reason)}`),
            meeting_date: date,
            repo: meeting.repo,
            path: meeting.path,
            summary: compact(stripMarkdown(section.title || reason), 120)
        });
    }
    return rejected;
}

function needsHumanReview(meeting, date) {
    const content = String(meeting.content || '');
    if (!COUNTERPARTY_CONFIDENTIAL_PATTERN.test(content)) return [];
    return [{
        reason: 'counterparty_confidential',
        source_ref: githubRef(meeting, 'needs_review:counterparty-confidential'),
        meeting_date: date,
        repo: meeting.repo,
        path: meeting.path,
        summary: '相手企業や顧問先の未公開予算・リード数に見える情報は、人間確認なしにSNS素材へ使わない。'
    }];
}

function dedupeBySourceEvent(candidates) {
    const seenSourceEvents = new Set();
    const seenBodies = new Set();
    const deduped = [];
    for (const candidate of candidates) {
        const sourceKey = candidate.source_event_ids.join('|');
        const bodyKey = normalizeSpaces(candidate.body);
        if (seenSourceEvents.has(sourceKey) || seenBodies.has(bodyKey)) continue;
        seenSourceEvents.add(sourceKey);
        seenBodies.add(bodyKey);
        deduped.push(candidate);
    }
    return deduped;
}

function sanitizeAdopted(candidates) {
    return candidates.filter((candidate) => {
        const body = String(candidate.body || '');
        return !MEDICAL_PATTERN.test(body) && !PRIVATE_PATTERN.test(body) && !/懇親会|飲み会|会食で話した/u.test(body);
    });
}

function extractFromMeeting({ meeting, date }) {
    const content = normalizeSpaces(meeting.content || '');
    const adopted = [];
    for (const rule of ADOPTION_RULES) {
        if (!rule.matches(content)) continue;
        adopted.push(buildCandidate({
            meeting,
            date,
            key: rule.key,
            category: rule.category,
            cognitiveType: rule.cognitiveType,
            body: rule.body,
            confidence: rule.category === 'proof' ? 0.88 : 0.8
        }));
    }
    return {
        adopted: sanitizeAdopted(adopted),
        rejected: rejectSensitiveSections(meeting, date),
        needs_review: needsHumanReview(meeting, date)
    };
}

function summarizeExtraction({ date, adopted, rejected, needsReview }) {
    return {
        date,
        source_system: SOURCE_SYSTEM,
        counts: {
            adopted: adopted.length,
            rejected: rejected.length,
            needs_review: needsReview.length
        }
    };
}

function extractMeetingPersonalKgCandidates({ date, meetings = [] }) {
    const adopted = [];
    const rejected = [];
    const needsReview = [];
    for (const meeting of meetings) {
        const result = extractFromMeeting({ meeting, date });
        adopted.push(...result.adopted);
        rejected.push(...result.rejected);
        needsReview.push(...result.needs_review);
    }
    const finalAdopted = dedupeBySourceEvent(adopted);
    return {
        ...summarizeExtraction({ date, adopted: finalAdopted, rejected, needsReview }),
        adopted: finalAdopted,
        rejected,
        needs_review: needsReview
    };
}

async function writeMeetingPersonalKgCandidates({ candidateService, extracted }) {
    if (!candidateService || typeof candidateService.createCandidate !== 'function') {
        throw new Error('candidateService with createCandidate required');
    }
    const summary = {
        date: extracted.date,
        source_system: SOURCE_SYSTEM,
        total: extracted.adopted.length,
        inserted: 0,
        skipped: 0,
        blocked: 0,
        ids: [],
        rejected: extracted.rejected || [],
        needs_review: extracted.needs_review || []
    };

    for (const candidate of extracted.adopted) {
        try {
            const result = await candidateService.createCandidate(candidate);
            if (result.blocked) {
                summary.blocked += 1;
                continue;
            }
            summary.inserted += 1;
            summary.ids.push(result.candidate.id);
        } catch (error) {
            if (error instanceof DuplicateCandidateError || error?.name === 'DuplicateCandidateError') {
                summary.skipped += 1;
                continue;
            }
            throw error;
        }
    }

    return summary;
}

export {
    SOURCE_SYSTEM,
    extractMeetingPersonalKgCandidates,
    writeMeetingPersonalKgCandidates
};
