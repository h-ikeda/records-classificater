import { useAuth } from '@clerk/clerk-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import NewTrip from './components/NewTrip';
import {
  createTrip,
  getUserState,
  listTrips,
  listVehicles,
  setCurrentVehicle as setCurrentVehicleQuery,
} from '../db/queries';
import type { Trip, Vehicle } from '../db/schema';
import Loader from '../components/Loader';

interface TripCalculated extends Trip {
  trip: number;
}

// 分類ごとに色を割り当て、業務用と私用を一目で見分けられるようにする
const classPalette = [
  'bg-blue-100 text-blue-800',
  'bg-amber-100 text-amber-800',
  'bg-emerald-100 text-emerald-800',
  'bg-rose-100 text-rose-800',
  'bg-violet-100 text-violet-800',
  'bg-cyan-100 text-cyan-800',
];

function sortByTimestamp({ timestamp: t1 }: Trip, { timestamp: t2 }: Trip) {
  return t1.getTime() - t2.getTime();
}

function formatDate(d: Date) {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function formatNumber(number: number) {
  return number.toFixed(6).replace(/\.?0*$/, '');
}

export default function TripClassificater({
  userId,
  refreshKey,
  onNoVehicles,
}: {
  userId: string;
  // 車両設定での変更を反映させるための再取得トリガー
  refreshKey: number;
  // 車両が1台も無いときに呼ぶ（App 側で車両設定を自動的に開く）
  onNoVehicles: () => void;
}) {
  const { getToken } = useAuth();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [currentVehicleId, setCurrentVehicleId] = useState<string | null>(null);
  const [currentYear, setCurrentYear] = useState(() => new Date().getFullYear());
  const [trips, setTrips] = useState<Trip[]>([]);
  const [newTripEnabled, setNewTripEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const token = useCallback(async () => (await getToken()) ?? '', [getToken]);

  const refreshVehicles = useCallback(async () => {
    const t = await token();
    const [state, vs] = await Promise.all([getUserState(t, userId), listVehicles(t)]);
    setVehicles(vs);
    const selected = state?.vehicleId && vs.some((v) => v.id === state.vehicleId)
      ? state.vehicleId
      : vs[0]?.id ?? null;
    setCurrentVehicleId(selected);
    return vs;
  }, [token, userId]);

  const refreshTrips = useCallback(async (vehicleId: string) => {
    const t = await token();
    return listTrips(t, vehicleId);
  }, [token]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const vs = await refreshVehicles();
        // 車両が無ければ App に通知（車両設定を自動で開く）
        if (active && vs.length === 0) onNoVehicles();
      } catch (e) {
        // 詳細はコンソールへ、画面は固定文言（内部情報を露出しない）
        console.error('Failed to load vehicles:', e);
        if (active) setLoadError(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshVehicles, refreshKey, onNoVehicles]);

  useEffect(() => {
    if (!currentVehicleId) {
      setTrips([]);
      return;
    }
    let active = true;
    (async () => {
      try {
        const newTrips = await refreshTrips(currentVehicleId);
        if (active) setTrips(newTrips);
      } catch (e) {
        console.error('Failed to load trips:', e);
        if (active) setLoadError(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [currentVehicleId, refreshTrips]);

  const vehicleClasses = useMemo(
    () => vehicles.find((v) => v.id === currentVehicleId)?.classes ?? [],
    [vehicles, currentVehicleId],
  );

  const calculatedTrips = useMemo<TripCalculated[]>(() => {
    const [first, ...remains] = [...trips].sort(sortByTimestamp);
    if (!first) return [];
    return remains.reduce(([acc, odo]: [TripCalculated[], number], trip: Trip): [TripCalculated[], number] => {
      acc.push({ ...trip, trip: trip.odo - odo });
      return [acc, trip.odo];
    }, [[{ ...first, trip: 0 }], first.odo] as [TripCalculated[], number])[0];
  }, [trips]);

  const classSummaries = useMemo(() => calculatedTrips.filter(({ timestamp }) => {
    return timestamp.getFullYear() === currentYear;
  }).reduce((acc, { class: c, trip }) => {
    if (!(c in acc)) acc[c] = 0;
    if (trip !== undefined) acc[c] += trip;
    return acc;
  }, {} as Record<string, number>), [calculatedTrips, currentYear]);

  const sum = useMemo(() => {
    const last = [...calculatedTrips].reverse().find(({ timestamp }) => timestamp.getFullYear() === currentYear);
    let first = [...calculatedTrips].reverse().find(({ timestamp }) => timestamp.getFullYear() === currentYear - 1);
    if (!first) first = calculatedTrips.find(({ timestamp }) => timestamp.getFullYear() === currentYear);
    if (!first || !last) return 0;
    return last.odo - first.odo;
  }, [calculatedTrips, currentYear]);

  // 一覧は新しい順に表示する（trip の差分計算は古い順のまま）
  const displayTrips = useMemo(() => [...calculatedTrips].reverse(), [calculatedTrips]);

  // trips は時系列とは限らないため、ODO（単調増加）の最大値を最新値とする
  const lastODO = useMemo(() => trips.reduce((max, { odo }) => (odo > max ? odo : max), 0), [trips]);

  function classStyle(cls: string) {
    const i = vehicleClasses.indexOf(cls);
    return classPalette[(i < 0 ? 0 : i) % classPalette.length];
  }

  async function handleSelectVehicle(event: React.ChangeEvent<HTMLSelectElement>) {
    const id = event.target.value;
    try {
      await setCurrentVehicleQuery(await token(), userId, id);
      setCurrentVehicleId(id);
    } catch (e) {
      console.error('Failed to switch vehicle:', e);
      alert('車両の切り替えに失敗しました');
    }
  }

  async function retryLoad() {
    setLoading(true);
    setLoadError(false);
    try {
      await refreshVehicles();
    } catch (e) {
      console.error('Failed to load vehicles:', e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  // 却下時は理由を返し、フォーム側でユーザーに提示できるようにする
  async function handleCreateTrip(trip: { odo: number; class: string; timestamp: Date }): Promise<string | null> {
    const prevTrip = [...calculatedTrips].reverse().find(({ timestamp }) => trip.timestamp.getTime() > timestamp.getTime());
    const nextTrip = calculatedTrips.find(({ timestamp }) => trip.timestamp.getTime() < timestamp.getTime());
    if (prevTrip && trip.odo <= prevTrip.odo) return `ODOは前の記録（${formatNumber(prevTrip.odo)} km）より大きい値を入力してください`;
    if (nextTrip && trip.odo >= nextTrip.odo) return `ODOは次の記録（${formatNumber(nextTrip.odo)} km）より小さい値を入力してください`;
    if (!currentVehicleId) return '車両が選択されていません';
    try {
      await createTrip(await token(), { ...trip, vehicleId: currentVehicleId });
      setTrips(await refreshTrips(currentVehicleId));
    } catch (e) {
      console.error('Failed to add trip:', e);
      return '記録の追加に失敗しました。時間をおいて再試行してください。';
    }
    setNewTripEnabled(false);
    return null;
  }

  if (loading) {
    return <Loader className="text-lime-500 text-4xl py-16" />;
  }

  if (loadError) {
    return (
      <div className="p-6 text-sm text-gray-800 space-y-3 text-center">
        <p className="text-red-700 font-bold">読み込みエラー</p>
        <p>データの取得に失敗しました。時間をおいて再試行してください。</p>
        <button
          onClick={retryLoad}
          className="bg-lime-500 text-white rounded-xl py-2 px-5 font-bold shadow active:bg-lime-600"
        >
          再試行
        </button>
      </div>
    );
  }

  if (!vehicles.length) {
    return (
      <div className="text-center py-16 space-y-2 text-gray-500">
        <p>まだ車両がありません。</p>
        <p className="text-sm">設定（⚙）→ 車両設定 から追加してください。</p>
      </div>
    );
  }

  return (
    <>
      {/* 車両切り替え（利用頻度が高いので常に上部に固定） */}
      <section className="sticky top-0 z-20 -mx-4 px-4 py-3 bg-white/95 backdrop-blur border-b border-gray-200 flex items-center gap-3">
        <label className="flex items-center gap-2 grow min-w-0">
          <span className="text-sm font-medium text-gray-500 shrink-0">車両</span>
          <select
            onChange={handleSelectVehicle}
            value={currentVehicleId ?? ''}
            className="grow min-w-0 text-lg font-medium py-2 px-3 rounded-lg border border-gray-300 bg-white focus:outline-none focus:border-lime-500"
          >
            {vehicles.map(({ id, name }) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </label>
      </section>

      {/* 年間集計（確認頻度は低いので折りたたみ） */}
      <details className="my-3 rounded-xl border border-gray-200 bg-gray-50 overflow-hidden">
        <summary className="cursor-pointer select-none px-4 py-3 font-bold text-gray-700 flex items-center gap-2">
          <span className="text-lime-600">📊</span>
          {currentYear}年の集計
        </summary>
        <div className="px-4 pb-4 space-y-3">
          <div className="flex items-center justify-center gap-4">
            <button className="w-9 h-9 rounded-full border border-gray-300 text-gray-600 active:bg-gray-200" onClick={() => setCurrentYear((y) => y - 1)}>‹</button>
            <span className="font-black text-lg tabular-nums">{currentYear}</span>
            <button className="w-9 h-9 rounded-full border border-gray-300 text-gray-600 active:bg-gray-200" onClick={() => setCurrentYear((y) => y + 1)}>›</button>
          </div>
          {Object.keys(classSummaries).length ? (
            <dl className="space-y-2">
              {Object.entries(classSummaries).map(([key, value]) => (
                <div key={key} className="flex items-center gap-3">
                  <dt className={`${classStyle(key)} shrink-0 text-xs font-medium px-2 py-1 rounded-full`}>{key}</dt>
                  <dd className="grow text-right tabular-nums font-medium">{formatNumber(value)} km</dd>
                  {sum ? <dd className="w-16 text-right text-sm text-gray-500 tabular-nums">{Math.round(value / sum * 1000) / 10} %</dd> : null}
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-center text-sm text-gray-400 py-2">記録がありません</p>
          )}
        </div>
      </details>

      {/* 走行記録一覧（新しい順） */}
      <ul className="space-y-3 pb-28">
        {displayTrips.map(({ id, timestamp, odo, trip, class: cls }) => (
          <li
            key={id}
            className="rounded-xl border border-gray-200 bg-white shadow-sm p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-gray-500 tabular-nums">{formatDate(timestamp)}</span>
              <span className={`${classStyle(cls)} text-xs font-medium px-2.5 py-1 rounded-full`}>{cls}</span>
            </div>
            <div className="mt-3 flex items-end justify-between gap-4">
              {trip ? (
                <div className="flex flex-col">
                  <span className="text-xs text-gray-400">走行 (TRIP)</span>
                  <span className="text-2xl font-bold tabular-nums text-gray-800">{formatNumber(trip)}<span className="text-sm font-normal text-gray-500 ml-1">km</span></span>
                </div>
              ) : null}
              <div className="flex flex-col items-end ml-auto">
                <span className="text-xs text-gray-400">総距離 (ODO)</span>
                <span className="text-lg font-medium tabular-nums text-gray-600">{formatNumber(odo)}<span className="text-sm font-normal text-gray-400 ml-1">km</span></span>
              </div>
            </div>
          </li>
        ))}
        {!displayTrips.length && (
          <li className="text-center text-gray-400 py-10">
            まだ記録がありません。<br />下のボタンから追加できます。
          </li>
        )}
      </ul>

      {/* 記録追加（主要操作なので画面下端に固定バーで常時表示） */}
      {currentVehicleId && !newTripEnabled && (
        <div
          className="fixed inset-x-0 bottom-0 z-30 bg-white/80 backdrop-blur border-t border-gray-200 px-4 pt-4"
          style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}
        >
          <button
            onClick={() => setNewTripEnabled(true)}
            className="w-full bg-lime-500 text-white rounded-xl py-3 font-bold text-lg shadow active:bg-lime-600 flex items-center justify-center gap-2"
          >
            <span className="text-2xl font-light leading-none">＋</span> 走行を記録
          </button>
        </div>
      )}

      {/* 入力フォーム（画面上端に固定し、キーボードに隠れないようにする） */}
      {newTripEnabled && (
        <div
          className="fixed inset-0 z-40 flex items-start bg-black/40"
          onClick={(e) => { if (e.target === e.currentTarget) setNewTripEnabled(false); }}
        >
          <div className="w-full bg-white rounded-b-2xl px-5 pb-4 max-h-full overflow-y-auto shadow-2xl" style={{ paddingTop: 'calc(0.5rem + env(safe-area-inset-top))' }}>
            <NewTrip minOdo={lastODO} onSubmit={handleCreateTrip} onCancel={() => setNewTripEnabled(false)} classOptions={vehicleClasses} />
          </div>
        </div>
      )}
    </>
  );
}
