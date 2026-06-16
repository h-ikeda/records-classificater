/** @type {import('ts-jest').JestConfigWithTsJest} */

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.spec.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        // pglite / firebase-admin / drizzle はテストでは CommonJS として解決する
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          jsx: 'react-jsx',
          target: 'ES2022',
          skipLibCheck: true,
        },
      },
    ],
  },
};
