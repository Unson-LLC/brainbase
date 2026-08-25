import {
    ContractUsageLedger,
    normalizeUsageEvent,
    validateIdempotencyClaim,
    validatePricingSnapshot
} from './contract-usage-ledger.js';
import { ContractError } from './errors.js';
import { assertCanonicalRevision } from './tenant-context.js';

export class PostgresContractUsageLedger {
    constructor({ repository, now = () => new Date() } = {}) {
        if (!repository) throw new Error('Multitenant PostgreSQL repository is required');
        this.repository = repository;
        this.ledger = new ContractUsageLedger({ now });
    }

    async decideQuota(input) {
        return this.repository.decideQuota(input);
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

    async finalizeReceiptWithPricing({ receipt: receiptInput, pricing_snapshot: pricingSnapshot }) {
        validatePricingSnapshot(pricingSnapshot);
        const contract = await this.repository.loadContractRevision({
            tenant_id: receiptInput.tenant_id,
            contract_revision: receiptInput.contract_revision
        });
        const expected = {
            rate_card_revision: String(contract.rate_card_revision),
            fx_table_revision: String(contract.fx_table_revision),
            sales_price_revision: String(contract.sales_price_revision)
        };
        if (Object.entries(expected).some(([field, value]) => pricingSnapshot[field] !== value)) {
            throw new ContractError('PRICING_REVISION_MISMATCH', { status: 409, fault_domain: 'brainbase_cloud' });
        }
        const finalized = this.ledger.finalizeReceiptWithPricing({
            receipt: receiptInput,
            pricing_snapshot: pricingSnapshot
        });
        await this.repository.finalizeReceiptWithPricing(finalized);
        return finalized;
    }

    async readReceiptHistory(input) {
        return this.repository.readReceiptHistory(input);
    }

    async claimEffect(claim, { connection_revision } = {}) {
        validateIdempotencyClaim(claim);
        assertCanonicalRevision(connection_revision, 'connection_revision');
        await this.repository.claimBusinessEffect({ claim, connection_revision });
        return claim;
    }
}
