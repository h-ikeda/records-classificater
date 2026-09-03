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

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
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

test('張り直しの上限に達したら onStalled を呼び、それ以上は張り直さない', () => {
  const stub = createStubSubscribe();
  const onStalled = jest.fn();
  subscribeWithWatchdog(stub.subscribe, { timeoutMs: 1000, maxRetries: 2, onStalled });

  jest.advanceTimersByTime(1000);
  jest.advanceTimersByTime(1000);
  jest.advanceTimersByTime(1000);

  // 最初の 1 回 + 張り直し 2 回
  expect(stub.attempts).toBe(3);
  expect(stub.unsubscribed).toBe(3);
  expect(onStalled).toHaveBeenCalledTimes(1);

  jest.advanceTimersByTime(10000);
  expect(stub.attempts).toBe(3);
  expect(onStalled).toHaveBeenCalledTimes(1);
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
