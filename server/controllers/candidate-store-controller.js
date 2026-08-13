// @ts-check
/**
 * CandidateStoreController
 * cross-repo source (mana / salestailor / zeims / SNS) からの
 * Raw Ledger envelope を受信して candidate-store に投入する。
 *
 * Story: story-candidate-store-cross-repo-write
 * Parent: STR-006 / ADR-010
 */

import { logger } from '../utils/logger.js';
import { validateEnvelope } from '../services/candidate-store/envelope-schema.js';
import { dreamingPass } from '../services/candidate-store/dreaming-job.js';
import { DuplicateCandidateError } from '../services/candidate-store/candidate-repository.js';

export class CandidateStoreController {
    constructor({ candidateRepository, defaultScope = 'personal', defaultOrgIds = [] } = {}) {
        if (!candidateRepository) {
            throw new Error('CandidateStoreController requires candidateRepository');
        }
        this.candidateRepository = candidateRepository;
        this.defaultScope = defaultScope;
        this.defaultOrgIds = defaultOrgIds;
    }

    /**
     * POST /api/candidate-store/raw-ledger
     * body: RawLedgerRecord envelope
     */
    ingestRawLedger = async (req, res) => {
        const source = req.candidateStoreSource;

        const envelope = req.body;
        const { valid, errors } = validateEnvelope(envelope);
        if (!valid) {
            return res.status(400).json({ error: 'invalid envelope', details: errors });
        }

        if (envelope.source_system !== source) {
            return res.status(400).json({
                error: 'envelope.source_system does not match x-cs-source header',
                expected: source,
                received: envelope.source_system
            });
        }

        const scope = req.body.scope || this.defaultScope;
        const { drafts, blocked } = dreamingPass([envelope], {
            scope,
            defaultOrgIds: this.defaultOrgIds
        });

        const candidateIds = [];
        const createErrors = [];
        const personalAccess = req.personalKnowledgeAccess;

        const scopedDrafts = drafts.map((draft) => ({
            ...draft,
            owner_person_id: personalAccess.personId,
            organization_id: personalAccess.organizationId,
            actor_person_id: personalAccess.actorPersonId,
            org_ids: [personalAccess.organizationId]
        }));

        const persistDrafts = async (repository) => {
            for (const draft of scopedDrafts) {
                try {
                    const created = await repository.create(draft);
                    candidateIds.push(created.id);
                } catch (error) {
                    if (error instanceof DuplicateCandidateError) {
                        logger.info('candidate-store ingestion: duplicate, ignoring', {
                            source,
                            raw_event_id: envelope.raw_event_id
                        });
                        continue;
                    }
                    logger.error('candidate-store ingestion: create failed', {
                        source,
                        raw_event_id: envelope.raw_event_id,
                        error: error?.message
                    });
                    createErrors.push(error?.message || 'create failed');
                }
            }
        };

        const transactionAccess = {
            ...personalAccess,
            projectCodes: [...new Set(scopedDrafts
                .map((draft) => draft.project_code)
                .filter(Boolean))]
        };
        if (typeof this.candidateRepository.transaction === 'function') {
            await this.candidateRepository.transaction(persistDrafts, { access: transactionAccess });
        } else {
            await persistDrafts(this.candidateRepository);
        }

        if (createErrors.length > 0 && candidateIds.length === 0) {
            return res.status(500).json({
                error: 'candidate creation failed',
                details: createErrors
            });
        }

        logger.info('candidate-store ingested raw-ledger envelope', {
            source,
            raw_event_id: envelope.raw_event_id,
            candidates_created: candidateIds.length,
            blocked_count: blocked.length
        });

        return res.status(202).json({
            raw_event_id: envelope.raw_event_id,
            candidate_ids: candidateIds,
            blocked,
            create_errors: createErrors
        });
    };
}
