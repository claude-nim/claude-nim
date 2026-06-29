/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  moduleNameMapper: {
    '^~/(.*)$': '<rootDir>/src/$1',
    '^vscode$': '<rootDir>/tests/__mocks__/vscode.ts',
    '^chalk$': '<rootDir>/tests/__mocks__/chalk.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
    }],
  },
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', 'extension\\.test\\.ts$'],
  clearMocks: true,
  restoreMocks: true,
  testTimeout: 30000,
  maxWorkers: '50%',
  setupFiles: ['<rootDir>/tests/__mocks__/bun.ts'],
};
