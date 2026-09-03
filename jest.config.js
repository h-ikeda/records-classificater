/** @type {import('ts-jest').JestConfigWithTsJest} */

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // 拒否される書き込みを並行して投げると、Firestore SDK が書き込みストリームを
  // 張り直しながらバックオフするため、1 ケースで既定の 5 秒を超えることがある。
  // 待ち時間の問題であって遅い処理ではないので、上限だけ緩める。
  testTimeout: 30000,
};
