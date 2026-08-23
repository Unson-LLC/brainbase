export default {
  test: {
    environment: 'node',
    include: [
      'tests/contracts/p0-negative-boundary-contract-v1/contract.test.js',
      'tests/contracts/p0-negative-boundary-contract-v1/planning-source-lock.test.js'
    ]
  }
};
