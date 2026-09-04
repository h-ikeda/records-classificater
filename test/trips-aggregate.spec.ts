import type { Timestamp } from 'firebase/firestore';
import {
  calculateTrips,
  compareTimestamp,
  sortNewestFirst,
  sortOldestFirst,
  summarizeYear,
  yearBounds,
  type TripIdentified,
} from '../src/trips/aggregate';

// 試験では Timestamp の中身（秒とナノ秒）しか見ないので、その形だけ用意する
function ts(seconds: number, nanoseconds = 0): Timestamp {
  return { seconds, nanoseconds, toDate: () => new Date(seconds * 1000) } as Timestamp;
}

function trip(id: string, seconds: number, odo: number, cls = '業務'): TripIdentified {
  return { id, odo, class: cls, timestamp: ts(seconds) };
}

test('Timestamp は秒とナノ秒の順で比べる', () => {
  expect(compareTimestamp(ts(1), ts(2))).toBeLessThan(0);
  expect(compareTimestamp(ts(2), ts(1))).toBeGreaterThan(0);
  expect(compareTimestamp(ts(1, 1), ts(1, 2))).toBeLessThan(0);
  expect(compareTimestamp(ts(1, 5), ts(1, 5))).toBe(0);
});

test('並べ替えは元の配列を変えない', () => {
  const trips = [trip('b', 2, 20), trip('a', 1, 10)];
  expect(sortOldestFirst(trips).map(({ id }) => id)).toEqual(['a', 'b']);
  expect(sortNewestFirst(trips).map(({ id }) => id)).toEqual(['b', 'a']);
  expect(trips.map(({ id }) => id)).toEqual(['b', 'a']);
});

test('走行距離は直前の記録との ODO 差で、古い順に返る', () => {
  const trips = [trip('c', 3, 130), trip('a', 1, 100), trip('b', 2, 110)];
  expect(calculateTrips(trips).map(({ id, trip: distance }) => [id, distance])).toEqual([
    // 土台が無いので最初の記録の差分は出せない。0 として画面には出さない
    ['a', 0],
    ['b', 10],
    ['c', 20],
  ]);
});

test('土台を渡せば、先頭の記録にも走行距離が出る', () => {
  const trips = [trip('b', 2, 110), trip('c', 3, 130)];
  const base = trip('a', 1, 100);
  expect(calculateTrips(trips, base).map(({ id, trip: distance }) => [id, distance])).toEqual([
    ['b', 10],
    ['c', 20],
  ]);
});

test('年間集計は分類ごとに合計し、合計の総和が年間の合計になる', () => {
  const trips = [
    trip('b', 2, 110, '業務'),
    trip('c', 3, 130, '私用'),
    trip('d', 4, 150, '業務'),
  ];
  const base = trip('a', 1, 100, '業務');
  expect(summarizeYear(trips, base)).toEqual({
    byClass: { 業務: 30, 私用: 20 },
    // 150 - 100。分類ごとの合計（30 + 20）と一致する
    total: 50,
  });
});

test('前年までの記録が無ければ、その年の最初の記録が起点になる', () => {
  const trips = [trip('a', 1, 100, '業務'), trip('b', 2, 110, '私用')];
  expect(summarizeYear(trips, null)).toEqual({
    byClass: { 業務: 0, 私用: 10 },
    total: 10,
  });
});

test('記録が 1 件も無い年は空の集計になる', () => {
  expect(summarizeYear([], null)).toEqual({ byClass: {}, total: 0 });
});

test('年の境目は現地時間の 1/1 00:00', () => {
  const { start, end } = yearBounds(2024);
  expect(start).toEqual(new Date(2024, 0, 1));
  expect(end).toEqual(new Date(2025, 0, 1));
});
