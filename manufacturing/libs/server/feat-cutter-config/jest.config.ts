export default {
  displayName: 'server-feat-cutter-config',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: { '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }] },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/libs/server/feat-cutter-config',
};
