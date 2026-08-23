export default {
  resolve: {
    alias: process.env.P0_AJV_2020
      ? { 'ajv/dist/2020.js': process.env.P0_AJV_2020 }
      : {}
  },
  test: {
    environment: 'node',
    include: [
      'tests/contracts/p0-negative-boundary-contract-v1/contract.test.js',
      'tests/contracts/p0-negative-boundary-contract-v1/planning-source-lock.test.js'
    ]
  }
};
