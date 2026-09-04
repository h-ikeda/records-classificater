import type { Timestamp } from 'firebase/firestore';
import type { TripIdentified } from '../src/trips/aggregate';
import {
  absorbTrips,
  createTripStore,
  yearKey,
  type LatestHandlers,
  type TripGateway,
} from '../src/trips/store';

function ts(seconds: number, nanoseconds = 0): Timestamp {
  return { seconds, nanoseconds, toDate: () => new Date(seconds * 1000) } as Timestamp;
}

function trip(id: string, seconds: number, odo: number, cls = '業務'): TripIdentified {
  return { id, odo, class: cls, timestamp: ts(seconds) };
}

const ids = (trips: TripIdentified[]) => trips.map(({ id }) => id);

// 呼ばれた回数を数えられる読み取り口。購読は張りっぱなしにして、
// 試験側から好きなタイミングでスナップショットを流し込む
function createFakeGateway() {
  const windows = new Map<string, LatestHandlers>();
  const unsubscribed: string[] = [];
  const calls = { subscribe: [] as string[], fetchOlder: 0, fetchYear: 0, fetchLastBefore: 0 };
  let older: TripIdentified[] = [];
  let year: { trips: TripIdentified[], base: TripIdentified | null } = { trips: [], base: null };
  let lastBefore: TripIdentified | null = null;
  let failNext = false;

  const gateway: TripGateway = {
    subscribeLatest(vehicleId, _max, handlers) {
      calls.subscribe.push(vehicleId);
      windows.set(vehicleId, handlers);
      return () => {
        unsubscribed.push(vehicleId);
        windows.delete(vehicleId);
      };
    },
    fetchOlder() {
      calls.fetchOlder += 1;
      return failNext ? Promise.reject(new Error('失敗')) : Promise.resolve(older);
    },
    fetchYear() {
      calls.fetchYear += 1;
      return failNext ? Promise.reject(new Error('失敗')) : Promise.resolve(year);
    },
    fetchLastBefore() {
      calls.fetchLastBefore += 1;
      return Promise.resolve(lastBefore);
    },
  };

  return {
    gateway,
    calls,
    unsubscribed,
    emit(vehicleId: string, trips: TripIdentified[], { synced = true } = {}) {
      windows.get(vehicleId)!.onWindow({ trips, synced });
    },
    handlers: (vehicleId: string) => windows.get(vehicleId)!,
    setOlder(trips: TripIdentified[]) { older = trips; },
    setYear(value: { trips: TripIdentified[], base: TripIdentified | null }) { year = value; },
    setLastBefore(value: TripIdentified | null) { lastBefore = value; },
    setFailNext(value: boolean) { failNext = value; },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test('取り込みの鍵はドキュメント ID。二度届いても重複しない', () => {
  const loaded = new Map<string, TripIdentified>();
  absorbTrips(loaded, [trip('b', 2, 120), trip('a', 1, 110)]);
  // 購読を張り直すと全件がもう一度届く。上書きになるだけで増えない
  const again = absorbTrips(loaded, [trip('b', 2, 120), trip('a', 1, 110)]);
  expect(ids(again)).toEqual(['b', 'a']);
});

test('ウィンドウから押し出された記録も、読み込み済みとして残る', () => {
  const loaded = new Map<string, TripIdentified>();
  absorbTrips(loaded, [trip('c', 3, 130), trip('b', 2, 120), trip('a', 1, 110)]);
  // 新しい記録が増えて a がウィンドウの外へ出た。ウィンドウには載らなくなるが、
  // 捨てると読み足した範囲との間に穴が開く（走行記録は追加しかできないので、
  // ウィンドウから消えたことは削除を意味しない）
  const next = absorbTrips(loaded, [trip('e', 5, 150), trip('d', 4, 140), trip('c', 3, 130)]);
  expect(ids(next)).toEqual(['e', 'd', 'c', 'b', 'a']);
});

test('同じ ID で届いた記録は差し替わる', () => {
  const loaded = new Map<string, TripIdentified>();
  absorbTrips(loaded, [trip('a', 1, 110, '業務')]);
  const next = absorbTrips(loaded, [trip('a', 1, 115, '私用')]);
  expect(next).toHaveLength(1);
  expect(next[0]).toMatchObject({ id: 'a', odo: 115, class: '私用' });
});

test('同じ車両を何度選んでも購読は 1 回だけ', () => {
  const fake = createFakeGateway();
  const store = createTripStore(fake.gateway, { pageSize: 2 });
  store.watch('v1');
  store.watch('v2');
  // 車両を戻しても張り直さない。ここが読み取りを増やさないための肝
  store.watch('v1');
  expect(fake.calls.subscribe).toEqual(['v1', 'v2']);
  expect(fake.unsubscribed).toEqual([]);
});

test('車両を切り替えても、戻れば取得済みの記録がそのまま残る', () => {
  const fake = createFakeGateway();
  const store = createTripStore(fake.gateway, { pageSize: 2 });
  store.watch('v1');
  fake.emit('v1', [trip('b', 2, 120), trip('a', 1, 110)]);
  store.watch('v2');
  store.watch('v1');
  const state = store.getState().trips.v1;
  expect(ids(state.trips)).toEqual(['b', 'a']);
  expect(state.loaded).toBe(true);
  expect(state.hasMore).toBe(false);
});

test('購読の数が上限を超えたら、いちばん長く使っていない車両から捨てる', () => {
  const fake = createFakeGateway();
  const store = createTripStore(fake.gateway, { pageSize: 2, maxWatched: 2 });
  store.watch('v1');
  store.watch('v2');
  // v1 を使い直したので、いちばん古いのは v2 になる
  store.watch('v1');
  store.watch('v3');
  expect(fake.unsubscribed).toEqual(['v2']);
  expect(Object.keys(store.getState().trips).sort()).toEqual(['v1', 'v3']);
});

test('読み足したあとに新しい記録が増えても、一覧に穴が開かない', async () => {
  const fake = createFakeGateway();
  const store = createTripStore(fake.gateway, { pageSize: 2 });
  store.watch('v1');
  fake.emit('v1', [trip('e', 5, 150), trip('d', 4, 140), trip('c', 3, 130)]);
  fake.setOlder([trip('c', 3, 130), trip('b', 2, 120)]);
  store.loadMore('v1');
  await flush();

  // 新しい記録が 2 件増え、d と c がウィンドウ（3 件）から押し出された。
  // c は読み足しでも持っているが、d はウィンドウにしか無い
  fake.emit('v1', [trip('g', 7, 170), trip('f', 6, 160), trip('e', 5, 150)]);
  expect(ids(store.getState().trips.v1.trips)).toEqual(['g', 'f', 'e', 'd', 'c', 'b']);
});

test('キャッシュ由来のスナップショットだけでは読み込み完了にしない', () => {
  const fake = createFakeGateway();
  const store = createTripStore(fake.gateway, { pageSize: 2 });
  store.watch('v1');
  fake.emit('v1', [], { synced: false });
  expect(store.getState().trips.v1.loaded).toBe(false);
  fake.emit('v1', [], { synced: true });
  expect(store.getState().trips.v1.loaded).toBe(true);
});

test('ウィンドウが上限まで埋まっていれば、続きがあると分かる', () => {
  const fake = createFakeGateway();
  const store = createTripStore(fake.gateway, { pageSize: 2 });
  store.watch('v1');
  // pageSize + 1 件。余分の 1 件で「その先がある」と分かる
  fake.emit('v1', [trip('c', 3, 130), trip('b', 2, 120), trip('a', 1, 110)]);
  expect(store.getState().trips.v1.hasMore).toBe(true);
});

test('キャッシュ由来のウィンドウでも続きの有無は分かる。あとから届くサーバー同期で変わるのは読み込み完了だけ', () => {
  const fake = createFakeGateway();
  const store = createTripStore(fake.gateway, { pageSize: 2 });
  store.watch('v1');
  const window = [trip('c', 3, 130), trip('b', 2, 120), trip('a', 1, 110)];
  // 年間集計を開くとその年の記録がローカルキャッシュへ載るため、そのあとに
  // 張られた購読はサーバーと同期する前にキャッシュ由来のウィンドウを届ける
  fake.emit('v1', window, { synced: false });
  expect(store.getState().trips.v1).toMatchObject({ loaded: false, hasMore: true });
  // 中身は同じなので、続きの有無も件数も変わらない。あとから変わるのは
  // 読み込み完了だけで、記録そのものは先に届いている（画面はこれを待たずに出す）
  fake.emit('v1', window, { synced: true });
  expect(store.getState().trips.v1).toMatchObject({ loaded: true, hasMore: true });
  expect(store.getState().trips.v1.trips).toHaveLength(3);
});

test('読み足した分を重複なく取り込み、終端に着いたら止まる', async () => {
  const fake = createFakeGateway();
  const store = createTripStore(fake.gateway, { pageSize: 2 });
  store.watch('v1');
  fake.emit('v1', [trip('e', 5, 150), trip('d', 4, 140), trip('c', 3, 130)]);

  // 境界を含めて取るので、既に持っている c も返ってくる
  fake.setOlder([trip('c', 3, 130), trip('b', 2, 120)]);
  store.loadMore('v1');
  expect(store.getState().trips.v1.loadingMore).toBe(true);
  await flush();
  expect(ids(store.getState().trips.v1.trips)).toEqual(['e', 'd', 'c', 'b']);
  expect(store.getState().trips.v1.loadingMore).toBe(false);
  // 返ってきたのが 2 件（＝上限）なので、まだ先がありそう
  expect(store.getState().trips.v1.hasMore).toBe(true);

  fake.setOlder([trip('b', 2, 120)]);
  store.loadMore('v1');
  await flush();
  expect(ids(store.getState().trips.v1.trips)).toEqual(['e', 'd', 'c', 'b']);
  // 1 件も増えなかったので終端。ここで止めないと同じ範囲を読み続ける
  expect(store.getState().trips.v1.hasMore).toBe(false);
  expect(fake.calls.fetchOlder).toBe(2);

  // 続きが無いと分かったあとは、呼んでも問い合わせない
  store.loadMore('v1');
  expect(fake.calls.fetchOlder).toBe(2);
});

test('読み足しに失敗したら知らせる', async () => {
  const fake = createFakeGateway();
  const store = createTripStore(fake.gateway, { pageSize: 2 });
  store.watch('v1');
  fake.emit('v1', [trip('c', 3, 130), trip('b', 2, 120), trip('a', 1, 110)]);
  fake.setFailNext(true);
  store.loadMore('v1');
  await flush();
  expect(store.getState().trips.v1.loadingMore).toBe(false);
  expect(store.getState().trips.v1.failure).toBe('failed');
});

test('年間集計は開いたときに 1 度だけ読み、覚えておく', async () => {
  const fake = createFakeGateway();
  const store = createTripStore(fake.gateway, { pageSize: 2 });
  store.watch('v1');
  fake.setYear({
    trips: [trip('b', 2, 120, '業務'), trip('c', 3, 150, '私用')],
    base: trip('a', 1, 100, '業務'),
  });
  store.loadYear('v1', 2024);
  await flush();
  const key = yearKey('v1', 2024);
  expect(store.getState().years[key]).toEqual({
    loading: false,
    loaded: true,
    failed: false,
    byClass: { 業務: 20, 私用: 30 },
    total: 50,
  });

  // 読み込み済みなら、開き直しても取りに行かない
  store.loadYear('v1', 2024);
  await flush();
  expect(fake.calls.fetchYear).toBe(1);
});

test('記録を追加したら、覚えている集計を捨てて取り直す', async () => {
  const fake = createFakeGateway();
  const store = createTripStore(fake.gateway, { pageSize: 2 });
  store.watch('v1');
  fake.setYear({ trips: [trip('a', 1, 100)], base: null });
  store.loadYear('v1', 2024);
  await flush();
  expect(fake.calls.fetchYear).toBe(1);

  store.invalidateYears('v1');
  expect(store.getState().years[yearKey('v1', 2024)]).toBeUndefined();
  store.loadYear('v1', 2024);
  await flush();
  expect(fake.calls.fetchYear).toBe(2);
});

test('年間集計の失敗は覚えておき、再試行を押したときだけ取り直す', async () => {
  const fake = createFakeGateway();
  const store = createTripStore(fake.gateway, { pageSize: 2 });
  store.watch('v1');
  fake.setFailNext(true);
  store.loadYear('v1', 2024);
  await flush();
  expect(store.getState().years[yearKey('v1', 2024)]).toMatchObject({ loading: false, loaded: false, failed: true });

  // 失敗を覚えていないと、状態の変化を見て呼び直す画面側と往復して取りに行き続ける
  fake.setFailNext(false);
  fake.setYear({ trips: [trip('a', 1, 100)], base: null });
  store.loadYear('v1', 2024);
  await flush();
  expect(fake.calls.fetchYear).toBe(1);
  expect(store.getState().years[yearKey('v1', 2024)]).toMatchObject({ failed: true });

  store.loadYear('v1', 2024, true);
  await flush();
  expect(fake.calls.fetchYear).toBe(2);
  expect(store.getState().years[yearKey('v1', 2024)]).toMatchObject({ loaded: true, failed: false });
});

test('前の記録は、読み込み済みの範囲にあれば問い合わせない', async () => {
  const fake = createFakeGateway();
  const store = createTripStore(fake.gateway, { pageSize: 2 });
  store.watch('v1');
  fake.emit('v1', [trip('c', 3, 130), trip('b', 2, 120), trip('a', 1, 110)]);

  expect(await store.findPrevious('v1', ts(4))).toMatchObject({ id: 'c' });
  expect(fake.calls.fetchLastBefore).toBe(0);

  // 読み込み済みより古い日時は、範囲の外なので 1 件だけ問い合わせる
  fake.setLastBefore(trip('z', 0, 90));
  expect(await store.findPrevious('v1', ts(1))).toMatchObject({ id: 'z' });
  expect(fake.calls.fetchLastBefore).toBe(1);
});

test('続きが無いと分かっていれば、前の記録も問い合わせない', async () => {
  const fake = createFakeGateway();
  const store = createTripStore(fake.gateway, { pageSize: 2 });
  store.watch('v1');
  fake.emit('v1', [trip('b', 2, 120), trip('a', 1, 110)]);
  expect(await store.findPrevious('v1', ts(1))).toBeNull();
  expect(fake.calls.fetchLastBefore).toBe(0);
});

test('見張りが諦めたら知らせ、遅れて届いたら取り下げる', () => {
  const fake = createFakeGateway();
  const store = createTripStore(fake.gateway, { pageSize: 2 });
  store.watch('v1');
  fake.handlers('v1').onStalled();
  expect(store.getState().trips.v1).toMatchObject({ loaded: true, failure: 'stalled' });
  fake.handlers('v1').onRecovered();
  expect(store.getState().trips.v1.failure).toBe('');
});

test('dispose ですべての購読を解除する', () => {
  const fake = createFakeGateway();
  const store = createTripStore(fake.gateway, { pageSize: 2 });
  store.watch('v1');
  store.watch('v2');
  store.dispose();
  expect(fake.unsubscribed.sort()).toEqual(['v1', 'v2']);
  expect(store.getState()).toEqual({ trips: {}, years: {} });
  // 解除後に選び直しても、購読は張らない
  store.watch('v1');
  expect(fake.calls.subscribe).toEqual(['v1', 'v2']);
});

test('状態が変わったら購読者に知らせる', () => {
  const fake = createFakeGateway();
  const store = createTripStore(fake.gateway, { pageSize: 2 });
  const listener = jest.fn();
  const unsubscribe = store.subscribe(listener);
  store.watch('v1');
  fake.emit('v1', [trip('a', 1, 110)]);
  expect(listener).toHaveBeenCalled();
  const before = listener.mock.calls.length;
  unsubscribe();
  fake.emit('v1', [trip('b', 2, 120), trip('a', 1, 110)]);
  expect(listener.mock.calls.length).toBe(before);
});
