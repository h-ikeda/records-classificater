/** @type {import('ts-jest').JestConfigWithTsJest} */

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // エミュレータへの拒否リクエストはリトライを挟むため1テストで数秒かかる。
  // 既定の5秒では CI の負荷次第で不安定になるため余裕を持たせる。
  testTimeout: 20000,
};
