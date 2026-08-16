import { expect } from 'vitest';

export function expectContractError(run, expected) {
    let caught;
    try {
        run();
    } catch (error) {
        caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).toMatchObject(expected);
}
