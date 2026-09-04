import type { Timestamp, Unsubscribe } from 'firebase/firestore';
import {
  compareTimestamp,
  sortNewestFirst,
  summarizeYear,
  type TripIdentified,
} from './aggregate';

// 走行記録の読み取りをまとめて受け持つ。以前は車両の trips を丸ごと購読して
// いたため、画面を開き直すたびに全件を読み直していた（記録が増えるほど 1 回の
// 読み込みが重くなり、無料枠の読み取り件数もすぐ尽きる）。
//
// ここでは次の 3 点で読み取りを抑える。
//
//   1. 購読するのは新しい順に PAGE_SIZE 件だけ。続きはスクロールで読み足す。
//      読み足した分は購読せず 1 回だけ取得して抱えておく（二重に課金されない）。
//   2. 年間集計は開いたときだけ、その年の分と前年までの最終走行距離を取得する。
//      畳んでいる間は 1 件も読まない。結果は車両と年ごとに覚えておく。
//   3. 車両を切り替えても購読を捨てない。戻ってきたら購読済みのスナップショット
//      をそのまま使うので、行き来しても読み取りは増えない。
//
// この仕組みは Firestore に直接触らず、TripGateway 越しに読む。Firestore なしで
// 試験できるようにするためで、実装は firestoreGateway.ts にある。

/** 一度に読む件数。スクロールで読み足すときもこの単位。 */
export const PAGE_SIZE = 20;

/**
 * 生かしたままにする購読の数（車両数）の上限。
 *
 * 切り替えのたびに購読を残すので、放っておくと際限なく増える。よく使う数台を
 * 残せれば足りるので、古いものから順に捨てる。
 */
export const MAX_WATCHED_VEHICLES = 5;

/** 読み込みの失敗の種類。表示する文言は画面側で決める。 */
export type LoadFailure = '' | 'failed' | 'stalled';

export interface TripsState {
  /**
   * 読み込み済みの記録（新しい順）。
   *
   * hasMore のときは末尾の 1 件が「表示する最古の記録の 1 つ前」で、走行距離の
   * 差分を出すためだけに持っている。表示するのは visibleTrips のほう。
   */
  trips: TripIdentified[],
  /** サーバーと同期できたスナップショットを一度でも受け取ったか */
  loaded: boolean,
  /** 読み込み済みの先にまだ記録があるか */
  hasMore: boolean,
  loadingMore: boolean,
  failure: LoadFailure,
}

export interface YearSummaryState {
  loading: boolean,
  loaded: boolean,
  failed: boolean,
  /** 分類ごとの走行距離 */
  byClass: Record<string, number>,
  /** その年の合計走行距離（分類ごとの合計の総和と一致する） */
  total: number,
}

export interface TripStoreState {
  trips: Record<string, TripsState>,
  years: Record<string, YearSummaryState>,
}

export const EMPTY_TRIPS_STATE: TripsState = {
  trips: [],
  loaded: false,
  hasMore: false,
  loadingMore: false,
  failure: '',
};

export const EMPTY_YEAR_STATE: YearSummaryState = {
  loading: false,
  loaded: false,
  failed: false,
  byClass: {},
  total: 0,
};

/** 購読しているウィンドウの現在の中身。 */
export interface LatestWindow {
  /** ウィンドウの現在の中身（新しい順）。差分ではなく、毎回そのときの全部 */
  trips: TripIdentified[],
  /** サーバーと同期できた内容か。キャッシュ由来なら false */
  synced: boolean,
}

export interface LatestHandlers {
  onWindow: (window: LatestWindow) => void,
  onError: () => void,
  onStalled: () => void,
  onRecovered: () => void,
}

/** 走行記録の読み取り口。Firestore 実装は firestoreGateway.ts。 */
export interface TripGateway {
  /** 新しい順に max 件を購読する。 */
  subscribeLatest(vehicleId: string, max: number, handlers: LatestHandlers): Unsubscribe,
  /**
   * boundary と同じか、それより古い記録を新しい順に max 件取得する。
   *
   * 「より古い」ではなく「同じか古い」にしてあるのは、同じ時刻の記録が
   * 取りこぼされないようにするため。境界の記録自体も返るが、呼び出し側で
   * ID の重複を落とす。
   */
  fetchOlder(vehicleId: string, boundary: Timestamp, max: number): Promise<TripIdentified[]>,
  /** その年の記録（古い順）と、前年までの最後の記録を取得する。 */
  fetchYear(vehicleId: string, year: number): Promise<{ trips: TripIdentified[], base: TripIdentified | null }>,
  /** boundary より古い記録のうち、いちばん新しいものを 1 件取得する。 */
  fetchLastBefore(vehicleId: string, boundary: Timestamp): Promise<TripIdentified | null>,
}

/**
 * 読み込み済みの記録へ取り込み、新しい順の一覧を作り直す。
 *
 * 鍵はドキュメント ID そのもの。同じ記録が二度届いても（購読の張り直し、
 * ウィンドウの出入り、読み足しの境界の重なり）上書きになるだけなので、
 * 重複も取りこぼしも起きない。
 *
 * 一度読み込んだ記録は捨てない。走行記録は追加しかできない（ルールが
 * `vehicles/{vid}/trips/{tid}` に許すのは get / list / create だけ）ので、
 * 購読しているウィンドウから記録が消えるのは「新しい記録に押し出された」
 * ときだけであり、削除ではないため。押し出されただけの記録を捨てると、
 * 読み足した範囲との間に穴が開く。
 *
 * ウィンドウの出入りと削除は listener からは同じ removed として届き、
 * 見分けられない。だから見分けようとせず、ID で持ち続けることにしている。
 * 前提はルールの試験（`nobody can delete a trip` ほか）で固定してあるので、
 * 削除を許すようになればそちらが落ちてここへ戻ってくる。
 *
 * loaded は書き換える（呼び出し側が持っている読み込み済みの索引そのもの）。
 */
export function absorbTrips(loaded: Map<string, TripIdentified>, incoming: TripIdentified[]): TripIdentified[] {
  incoming.forEach((trip) => loaded.set(trip.id, trip));
  return sortNewestFirst(Array.from(loaded.values()));
}

/** 年ごとの集計を覚えておくときの鍵。車両 ID に改行は入らないので区切りに使う。 */
export function yearKey(vehicleId: string, year: number): string {
  return `${vehicleId}\n${year}`;
}

interface Entry {
  unsubscribe: Unsubscribe | null,
  /** 直近に使われた時刻。上限を超えたときはこれが古いものから捨てる */
  usedAt: number,
  /** ウィンドウが上限まで埋まっているか（＝その先にまだ記録がありそうか） */
  windowFull: boolean,
  /** 読み足した先にまだ記録があるか。null なら、まだ一度も読み足していない */
  moreBeyondPaged: boolean | null,
  /**
   * 読み込み済みの記録を、ドキュメント ID で引ける形で持つ。
   *
   * 画面へ渡すのは新しい順の配列だが、届いた記録の取り込みはこちらで行う。
   * 配列から毎回索引を作り直さずに済み、同じ記録かどうかを ID だけで決められる。
   */
  byId: Map<string, TripIdentified>,
}

export interface TripStore {
  getState(): TripStoreState,
  subscribe(listener: () => void): () => void,
  /** その車両の購読を確保する。既にあれば何もしない（＝読み取りが増えない）。 */
  watch(vehicleId: string): void,
  /** 続きを読み足す。 */
  loadMore(vehicleId: string): void,
  /**
   * その年の集計を読み込む。
   *
   * 一度読み込んだ年や、失敗した年は何もしない。失敗を覚えておかないと、
   * 状態の変化を見て呼び直す画面側と往復して、際限なく取りに行ってしまう。
   * 利用者が再試行を押したときだけ force を立てること。
   */
  loadYear(vehicleId: string, year: number, force?: boolean): void,
  /** 記録を追加したあとなど、覚えている集計を捨てる。 */
  invalidateYears(vehicleId: string): void,
  /** timestamp より古い記録のうち、いちばん新しいものを返す。 */
  findPrevious(vehicleId: string, timestamp: Timestamp): Promise<TripIdentified | null>,
  /** すべての購読を解除する。 */
  dispose(): void,
}

export function createTripStore(gateway: TripGateway, {
  pageSize = PAGE_SIZE,
  maxWatched = MAX_WATCHED_VEHICLES,
}: { pageSize?: number, maxWatched?: number } = {}): TripStore {
  const listeners = new Set<() => void>();
  const entries = new Map<string, Entry>();
  let state: TripStoreState = { trips: {}, years: {} };
  let disposed = false;
  let clock = 0;

  function emit() {
    listeners.forEach((listener) => listener());
  }

  function patchTrips(vehicleId: string, patch: Partial<TripsState>) {
    const current = state.trips[vehicleId] || EMPTY_TRIPS_STATE;
    state = { ...state, trips: { ...state.trips, [vehicleId]: { ...current, ...patch } } };
    emit();
  }

  function patchYear(key: string, patch: Partial<YearSummaryState>) {
    const current = state.years[key] || EMPTY_YEAR_STATE;
    state = { ...state, years: { ...state.years, [key]: { ...current, ...patch } } };
    emit();
  }

  function hasMore(entry: Entry) {
    return entry.moreBeyondPaged === null ? entry.windowFull : entry.moreBeyondPaged;
  }

  // 上限を超えたぶんは、いちばん長く使っていない車両から購読ごと捨てる
  function evict() {
    while (entries.size > maxWatched) {
      let oldestId: string | null = null;
      let oldestAt = Infinity;
      entries.forEach((entry, id) => {
        if (entry.usedAt >= oldestAt) return;
        oldestAt = entry.usedAt;
        oldestId = id;
      });
      if (oldestId === null) return;
      entries.get(oldestId)?.unsubscribe?.();
      entries.delete(oldestId);
      const { [oldestId]: _dropped, ...trips } = state.trips;
      state = { ...state, trips };
    }
  }

  function watch(vehicleId: string) {
    if (disposed) return;
    clock += 1;
    const existing = entries.get(vehicleId);
    if (existing) {
      // 購読済みなら張り直さない。ここが「車両を行き来しても読み取りが増えない」
      // ことの要。取得済みのスナップショットをそのまま使う
      existing.usedAt = clock;
      return;
    }
    const entry: Entry = {
      unsubscribe: null,
      usedAt: clock,
      windowFull: false,
      moreBeyondPaged: null,
      byId: new Map(),
    };
    entries.set(vehicleId, entry);
    state = { ...state, trips: { ...state.trips, [vehicleId]: EMPTY_TRIPS_STATE } };
    // 表示するのは pageSize 件だが、いちばん古い 1 件は走行距離の差分を出すための
    // 土台として余分に読む。これが無いと、先頭の記録だけ距離が出せない
    entry.unsubscribe = gateway.subscribeLatest(vehicleId, pageSize + 1, {
      onWindow: (window) => {
        if (!entries.has(vehicleId)) return;
        const current = state.trips[vehicleId] || EMPTY_TRIPS_STATE;
        // ウィンドウが上限まで埋まっていれば、その先にまだ記録がありそうだと分かる。
        // ただし読み足したあとは、下端の判断は読み足しの結果のほうが正しい
        entry.windowFull = window.trips.length > pageSize;
        patchTrips(vehicleId, {
          trips: absorbTrips(entry.byId, window.trips),
          // 空のキャッシュから届く空のスナップショットを完了と見なすと、1 件も
          // 読めていないのに「記録がありません」と表示してしまう
          loaded: current.loaded || window.synced,
          hasMore: hasMore(entry),
          failure: window.synced ? '' : current.failure,
        });
      },
      onError: () => {
        if (!entries.has(vehicleId)) return;
        patchTrips(vehicleId, { loaded: true, failure: 'failed' });
      },
      onStalled: () => {
        if (!entries.has(vehicleId)) return;
        patchTrips(vehicleId, { loaded: true, failure: 'stalled' });
      },
      onRecovered: () => {
        if (!entries.has(vehicleId)) return;
        const current = state.trips[vehicleId] || EMPTY_TRIPS_STATE;
        if (current.failure !== 'stalled') return;
        patchTrips(vehicleId, { failure: '' });
      },
    });
    // 追加したあとに溢れたぶんを捨ててから、まとめて知らせる
    evict();
    emit();
  }

  function loadMore(vehicleId: string) {
    const entry = entries.get(vehicleId);
    if (!entry) return;
    const current = state.trips[vehicleId] || EMPTY_TRIPS_STATE;
    if (current.loadingMore || !current.hasMore) return;
    const oldest = current.trips[current.trips.length - 1];
    if (!oldest) return;
    patchTrips(vehicleId, { loadingMore: true });
    gateway.fetchOlder(vehicleId, oldest.timestamp, pageSize).then((older) => {
      if (!entries.has(vehicleId)) return;
      const added = older.filter(({ id }) => !entry.byId.has(id));
      // 同じ時刻の記録を取りこぼさないよう境界を含めて取っているので、
      // 1 件も増えなければ本当に終端。ここで止めないと同じ範囲を読み続ける
      entry.moreBeyondPaged = added.length > 0 && older.length >= pageSize;
      patchTrips(vehicleId, {
        trips: absorbTrips(entry.byId, added),
        loadingMore: false,
        hasMore: hasMore(entry),
      });
    }, () => {
      if (!entries.has(vehicleId)) return;
      patchTrips(vehicleId, { loadingMore: false, failure: 'failed' });
    });
  }

  function loadYear(vehicleId: string, year: number, force = false) {
    const key = yearKey(vehicleId, year);
    const current = state.years[key];
    if (!force && current && (current.loading || current.loaded || current.failed)) return;
    patchYear(key, { loading: true, failed: false });
    gateway.fetchYear(vehicleId, year).then(({ trips, base }) => {
      if (disposed) return;
      const { byClass, total } = summarizeYear(trips, base);
      patchYear(key, { loading: false, loaded: true, failed: false, byClass, total });
    }, () => {
      if (disposed) return;
      patchYear(key, { loading: false, loaded: false, failed: true });
    });
  }

  function invalidateYears(vehicleId: string) {
    const prefix = `${vehicleId}\n`;
    const years = Object.fromEntries(
      Object.entries(state.years).filter(([key]) => !key.startsWith(prefix)),
    );
    if (Object.keys(years).length === Object.keys(state.years).length) return;
    state = { ...state, years };
    emit();
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    watch,
    loadMore,
    loadYear,
    invalidateYears,
    findPrevious(vehicleId, timestamp) {
      const current = state.trips[vehicleId] || EMPTY_TRIPS_STATE;
      // 読み込み済みの範囲に収まっているなら、問い合わせずに済ませる
      const loaded = current.trips.find((trip) => compareTimestamp(trip.timestamp, timestamp) < 0);
      if (loaded) return Promise.resolve(loaded);
      if (!current.hasMore) return Promise.resolve(null);
      return gateway.fetchLastBefore(vehicleId, timestamp);
    },
    dispose() {
      disposed = true;
      entries.forEach((entry) => entry.unsubscribe?.());
      entries.clear();
      listeners.clear();
      state = { trips: {}, years: {} };
    },
  };
}
