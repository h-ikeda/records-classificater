import type { Timestamp } from 'firebase/firestore';
import type { Trip } from '../firestore/definitions/Trip';

export interface TripIdentified extends Trip {
  id: string,
}

export interface TripCalculated extends TripIdentified {
  /** 直前の記録との ODO 差（＝この記録で走った距離） */
  trip: number,
}

/**
 * Timestamp を古い順に並べるための比較関数。
 *
 * Timestamp どうしを引き算すると（valueOf が文字列を返すため）NaN になり、
 * 比較関数として機能しない。秒とナノ秒を順に見て比べること。
 */
export function compareTimestamp(a: Timestamp, b: Timestamp): number {
  if (a.seconds !== b.seconds) return a.seconds - b.seconds;
  return a.nanoseconds - b.nanoseconds;
}

/** 新しい順に並べ替えた配列を返す（元の配列は変更しない）。 */
export function sortNewestFirst<T extends Trip>(trips: T[]): T[] {
  return [...trips].sort((a, b) => compareTimestamp(b.timestamp, a.timestamp));
}

/** 古い順に並べ替えた配列を返す（元の配列は変更しない）。 */
export function sortOldestFirst<T extends Trip>(trips: T[]): T[] {
  return [...trips].sort((a, b) => compareTimestamp(a.timestamp, b.timestamp));
}

/**
 * 走行距離（直前の記録との ODO 差）を付けて、古い順に返す。
 *
 * base には trips の先頭より 1 つ古い記録を渡す。全件を読まなくなったので、
 * 先頭の記録の差分は「その直前の記録」を別に渡してもらわないと出せない。
 * base が無い（＝本当に最初の記録）ときの差分は 0 とし、画面では出さない。
 */
export function calculateTrips(trips: TripIdentified[], base: TripIdentified | null = null): TripCalculated[] {
  let odo = base ? base.odo : null;
  return sortOldestFirst(trips).map((trip) => {
    const calculated = { ...trip, trip: odo === null ? 0 : trip.odo - odo };
    odo = trip.odo;
    return calculated;
  });
}

/** 分類ごとに走行距離を合計する。 */
export function summarizeByClass(trips: TripCalculated[]): Record<string, number> {
  return trips.reduce((acc, { class: cls, trip }) => {
    if (!(cls in acc)) acc[cls] = 0;
    acc[cls] += trip;
    return acc;
  }, {} as Record<string, number>);
}

/**
 * 1 年分の記録を集計する。
 *
 * base はその年の最初の記録の 1 つ前（＝前年までの最終走行距離）。年間の合計は
 * 分類ごとの合計の総和と必ず一致する（どちらも同じ差分の足し合わせなので）。
 */
export function summarizeYear(trips: TripIdentified[], base: TripIdentified | null): {
  byClass: Record<string, number>,
  total: number,
} {
  const byClass = summarizeByClass(calculateTrips(trips, base));
  return {
    byClass,
    total: Object.values(byClass).reduce((sum, value) => sum + value, 0),
  };
}

/** その年の始まり（1/1 00:00）と、翌年の始まりを返す。境界は現地時間で判定する。 */
export function yearBounds(year: number): { start: Date, end: Date } {
  return { start: new Date(year, 0, 1), end: new Date(year + 1, 0, 1) };
}
