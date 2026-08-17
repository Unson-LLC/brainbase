import {
    ContractUsageLedger,
    normalizeUsageEvent,
    validateIdempotencyClaim
} from './contract-usage-ledger.js';
import { assertCanonicalRevision } from './tenant-context.js';

export class PostgresContractUsageLedger {
    constructor({ repository, now = () => new Date() } = {}) {
        if (!repository) throw new Error('Multitenant PostgreSQL repository is required');
        this.repository = repository;
        this.ledger = new ContractUsageLedger({ now });
    }

    async decideQuota(input) {
        const contract = await this.repository.loadContractRevision({
            tenant_id: input.tenant_id,
            contract_revision: input.contract_revision
        });
        this.ledger.registerContract(contract);
        const decision = this.ledger.decideQuota(input);
        await this.repository.recordQuotaDecision(decision, {
            idempotency_key: input.idempotency_key,
            metric: input.metric
        });
        return decision;
    }

    async recordUsage(input) {
        const event = normalizeUsageEvent(input);
        await this.repository.recordUsage(event);
        return event;
    }

    async finalizeReceipt(input) {
        const receipt = this.ledger.finalizeReceipt(input);
        await this.repository.finalizeReceipt(receipt);
        return receipt;
    }

    async claimEffect(claim, { connection_revision } = {}) {
        validateIdempotencyClaim(claim);
        assertCanonicalRevision(connection_revision, 'connection_revision');
        await this.repository.claimBusinessEffect({ claim, connection_revision });
        return claim;
    }
}
