import { subscribeWithWatchdog } from '../src/firestore/watchdog';

// 「初回スナップショットが届かないまま無反応になる listen」を模した購読。
// notify を呼ばなければ、そのまま黙っている購読になる。
function createStubSubscribe() {
  const notifies: (() => void)[] = [];
  let unsubscribed = 0;
  const subscribe = (notify: () => void) => {
    notifies.push(notify);
    return () => { unsubscribed += 1; };
  };
  return {
    subscribe,
    /** subscribe が呼ばれた回数（＝張り直した回数 + 1） */
    get attempts() { return notifies.length; },
    get unsubscribed() { return unsubscribed; },
    /** n 回目の購読へスナップショットが届いたことにする */
    deliver(n = notifies.length - 1) { notifies[n](); },
  };
}

// 張り直しは必ずコンソールへ残す（自動復帰で症状が見えなくならないように）。
// 試験中は出力を抑えつつ、呼ばれたことを確かめられるようにする
let warn: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  warn.mockRestore();
});

test('スナップショットが届けば張り直さない', () => {
  const stub = createStubSubscribe();
  const onStalled = jest.fn();
  subscribeWithWatchdog(stub.subscribe, { timeoutMs: 1000, onStalled });

  stub.deliver();
  jest.advanceTimersByTime(10000);

  expect(stub.attempts).toBe(1);
  expect(stub.unsubscribed).toBe(0);
  expect(onStalled).not.toHaveBeenCalled();
});

test('時間内に届かなければ購読を捨てて張り直す', () => {
  const stub = createStubSubscribe();
  const onRetry = jest.fn();
  subscribeWithWatchdog(stub.subscribe, { timeoutMs: 1000, maxRetries: 2, onRetry });

  jest.advanceTimersByTime(1000);

  expect(stub.attempts).toBe(2);
  // 無反応のターゲットを残すと、あとから二重に届く。捨ててから張り直す
  expect(stub.unsubscribed).toBe(1);
  expect(onRetry).toHaveBeenCalledWith(1);
});

test('張り直した先で届けば、そこで見張りは終わる', () => {
  const stub = createStubSubscribe();
  const onStalled = jest.fn();
  subscribeWithWatchdog(stub.subscribe, { timeoutMs: 1000, maxRetries: 2, onStalled });

  jest.advanceTimersByTime(1000);
  stub.deliver();
  jest.advanceTimersByTime(10000);

  expect(stub.attempts).toBe(2);
  expect(onStalled).not.toHaveBeenCalled();
});

test('張り直すたびに待ち時間を倍にする', () => {
  const stub = createStubSubscribe();
  subscribeWithWatchdog(stub.subscribe, { timeoutMs: 1000, maxRetries: 3 });

  // 1 回目は 1000ms 待つ
  jest.advanceTimersByTime(999);
  expect(stub.attempts).toBe(1);
  jest.advanceTimersByTime(1);
  expect(stub.attempts).toBe(2);

  // 2 回目は 2000ms。回線が遅いだけの場合に、短い待ちで張り直し続けない
  jest.advanceTimersByTime(1999);
  expect(stub.attempts).toBe(2);
  jest.advanceTimersByTime(1);
  expect(stub.attempts).toBe(3);

  // 3 回目は 4000ms
  jest.advanceTimersByTime(3999);
  expect(stub.attempts).toBe(3);
  jest.advanceTimersByTime(1);
  expect(stub.attempts).toBe(4);
});

test('張り直しの上限に達したら onStalled を呼び、それ以上は張り直さない', () => {
  const stub = createStubSubscribe();
  const onStalled = jest.fn();
  subscribeWithWatchdog(stub.subscribe, { timeoutMs: 1000, maxRetries: 2, onStalled });

  // 待ちは倍々に伸びる（1000 → 2000 → 4000）
  jest.advanceTimersByTime(1000);
  jest.advanceTimersByTime(2000);
  jest.advanceTimersByTime(4000);

  // 最初の 1 回 + 張り直し 2 回
  expect(stub.attempts).toBe(3);
  // 諦めたあとも最後の購読は残す。捨てると、通信が戻っても二度と届かない
  expect(stub.unsubscribed).toBe(2);
  expect(onStalled).toHaveBeenCalledTimes(1);

  jest.advanceTimersByTime(10000);
  expect(stub.attempts).toBe(3);
  expect(onStalled).toHaveBeenCalledTimes(1);
});

test('諦めたあとに届いたら onRecovered を呼ぶ', () => {
  const stub = createStubSubscribe();
  const onStalled = jest.fn();
  const onRecovered = jest.fn();
  subscribeWithWatchdog(stub.subscribe, {
    timeoutMs: 1000, maxRetries: 1, onStalled, onRecovered,
  });

  jest.advanceTimersByTime(1000);
  jest.advanceTimersByTime(2000);
  expect(onStalled).toHaveBeenCalledTimes(1);
  expect(onRecovered).not.toHaveBeenCalled();

  // 残してある最後の購読へ、遅れて届く
  stub.deliver();
  expect(onRecovered).toHaveBeenCalledTimes(1);
  // 諦めたことも、そのあと届いたことも記録に残る
  expect(warn.mock.calls[warn.mock.calls.length - 1][0]).toContain('諦めたあとに初回スナップショットが届いた');

  stub.deliver();
  expect(onRecovered).toHaveBeenCalledTimes(1);
});

test('諦めたあとに解除すれば、残していた購読も解除される', () => {
  const stub = createStubSubscribe();
  const unsubscribe = subscribeWithWatchdog(stub.subscribe, { timeoutMs: 1000, maxRetries: 1 });

  jest.advanceTimersByTime(1000);
  jest.advanceTimersByTime(2000);
  expect(stub.unsubscribed).toBe(1);

  unsubscribe();
  expect(stub.unsubscribed).toBe(2);
});

test('解除したら購読も見張りも止まる', () => {
  const stub = createStubSubscribe();
  const onStalled = jest.fn();
  const unsubscribe = subscribeWithWatchdog(stub.subscribe, { timeoutMs: 1000, onStalled });

  unsubscribe();
  jest.advanceTimersByTime(10000);

  expect(stub.attempts).toBe(1);
  expect(stub.unsubscribed).toBe(1);
  expect(onStalled).not.toHaveBeenCalled();
});

test('届いたあとに解除しても、購読は一度だけ解除される', () => {
  const stub = createStubSubscribe();
  const unsubscribe = subscribeWithWatchdog(stub.subscribe, { timeoutMs: 1000 });

  stub.deliver();
  unsubscribe();
  unsubscribe();

  expect(stub.unsubscribed).toBe(1);
});

test('subscribe の中で同期的に届いた場合は見張りを張らない', () => {
  const onStalled = jest.fn();
  let unsubscribed = 0;
  const unsubscribe = subscribeWithWatchdog((notify) => {
    notify();
    return () => { unsubscribed += 1; };
  }, { timeoutMs: 1000, onStalled });

  jest.advanceTimersByTime(10000);
  expect(onStalled).not.toHaveBeenCalled();

  unsubscribe();
  expect(unsubscribed).toBe(1);
});

test('張り直したことをコンソールへ残す', () => {
  const stub = createStubSubscribe();
  subscribeWithWatchdog(stub.subscribe, { label: '走行記録', timeoutMs: 1000, maxRetries: 1 });

  jest.advanceTimersByTime(1000);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0][0]).toContain('走行記録');

  // 諦めたことも残す（2 回目の待ちは 2000ms）
  jest.advanceTimersByTime(2000);
  expect(warn).toHaveBeenCalledTimes(2);
  expect(warn.mock.calls[1][0]).toContain('走行記録');
});

test('張り直した先で届いたときは、そのことも残す', () => {
  const stub = createStubSubscribe();
  subscribeWithWatchdog(stub.subscribe, { label: '走行記録', timeoutMs: 1000, maxRetries: 2 });

  jest.advanceTimersByTime(1000);
  warn.mockClear();
  stub.deliver();

  // 前の購読が 1000ms 無反応だったのに次はすぐ届いた、という記録が残る
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0][0]).toContain('1 回目の購読で初回スナップショットが届いた');
});

test('届いたときは何も残さない', () => {
  const stub = createStubSubscribe();
  subscribeWithWatchdog(stub.subscribe, { timeoutMs: 1000 });

  stub.deliver();
  jest.advanceTimersByTime(10000);

  expect(warn).not.toHaveBeenCalled();
});
