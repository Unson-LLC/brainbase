export class ContractError extends Error {
    constructor(code, {
        message = code,
        status = 400,
        retryable = false,
        fault_domain = 'customer_environment',
        details = { required_action: 'none' }
    } = {}) {
        super(message);
        this.name = 'ContractError';
        this.code = code;
        this.status = status;
        this.retryable = retryable;
        this.fault_domain = fault_domain;
        this.details = details;
    }
}
