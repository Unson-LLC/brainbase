import { createLeadFixtureSnapshot } from './lead-fixtures.js';

export class LeadRepository {
    createSnapshot() {
        return createLeadFixtureSnapshot();
    }
}
