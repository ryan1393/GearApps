module.exports = {
  displayName: 'frontend-util-plant-dashboard',
  preset: '../../../../jest.preset.js',
  testEnvironment: 'node',
  transform: { '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }] },
};
