'use client';

import { useEffect, useMemo, useState } from 'react';
import NewTrip from './components/NewTrip';
import { api, useSnapshot } from '@/lib/client';
import type { TripDTO, TripInput } from '@/lib/types';

interface TripCalculated extends TripDTO {
  date: Date;
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

function formatDate(date: Date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

function formatNumber(number: number) {
  return number.toFixed(6).replace(/\.?0*$/, '');
}

export default function TripClassificater() {
  // null で購読開始 → サーバーが現在/先頭の車両を解決して snapshot.vehicleId で返す
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [currentYear, setCurrentYear] = useState(() => new Date().getFullYear());
  const [newTripEnabled, setNewTripEnabled] = useState(false);

  const snapshot = useSnapshot(selectedVehicleId);
  const vehicles = useMemo(() => snapshot?.vehicles ?? [], [snapshot]);
  const effectiveVehicleId = snapshot?.vehicleId ?? null;
  const trips = useMemo(() => snapshot?.trips ?? [], [snapshot]);
  const vehicleClasses = useMemo(
    () => vehicles.find((v) => v.id === effectiveVehicleId)?.classes ?? [],
    [vehicles, effectiveVehicleId],
  );

  // サーバーが解決した車両を購読対象に同期し、以降の SSE をその車両に絞る
  useEffect(() => {
    if (!selectedVehicleId && effectiveVehicleId) {
      setSelectedVehicleId(effectiveVehicleId);
    }
  }, [selectedVehicleId, effectiveVehicleId]);

  const calculatedTrips = useMemo<TripCalculated[]>(() => {
    const withDate = trips
      .map((t) => ({ ...t, date: new Date(t.timestamp) }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    const [first, ...remains] = withDate;
    if (!first) return [];
    return remains.reduce(
      ([acc, odo]: [TripCalculated[], number], trip): [TripCalculated[], number] => {
        acc.push({ ...trip, trip: trip.odo - odo });
        return [acc, trip.odo];
      },
      [[{ ...first, trip: 0 }], first.odo] as [TripCalculated[], number],
    )[0];
  }, [trips]);

  const classSummaries = useMemo(
    () =>
      calculatedTrips
        .filter(({ date }) => date.getFullYear() === currentYear)
        .reduce((acc, { class: c, trip }) => {
          if (!(c in acc)) acc[c] = 0;
          if (trip !== undefined) acc[c] += trip;
          return acc;
        }, {} as Record<string, number>),
    [calculatedTrips, currentYear],
  );

  const sum = useMemo(() => {
    const last = [...calculatedTrips].reverse().find(({ date }) => date.getFullYear() === currentYear);
    let first = [...calculatedTrips].reverse().find(({ date }) => date.getFullYear() === currentYear - 1);
    if (!first) first = calculatedTrips.find(({ date }) => date.getFullYear() === currentYear);
    if (!first || !last) return 0;
    return last.odo - first.odo;
  }, [calculatedTrips, currentYear]);

  // 一覧は新しい順に表示する（trip の差分計算は古い順のまま）
  const displayTrips = useMemo(() => [...calculatedTrips].reverse(), [calculatedTrips]);

  // trips はスナップショット順で時系列とは限らないため、ODO（単調増加）の最大値を最新値とする
  const lastODO = useMemo(() => trips.reduce((max, { odo }) => (odo > max ? odo : max), 0), [trips]);

  function classStyle(cls: string) {
    const i = vehicleClasses.indexOf(cls);
    return classPalette[(i < 0 ? 0 : i) % classPalette.length];
  }

  async function setCurrentVehicle(event: React.ChangeEvent<HTMLSelectElement>) {
    const id = event.target.value;
    setSelectedVehicleId(id);
    try {
      await api.setCurrentVehicle(id);
    } catch {
      /* 選択は SSE 再購読で反映されるため、失敗時もUIは破綻しない */
    }
  }

  async function addVehicle() {
    const name = window.prompt('車の名称を入力してください');
    if (name === null) return;
    try {
      const vehicle = await api.createVehicle(name, []);
      setSelectedVehicleId(vehicle.id);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '車両の追加に失敗しました');
    }
  }

  // 却下時は理由を返し、フォーム側でユーザーに提示できるようにする
  async function createTrip(trip: TripInput): Promise<string | null> {
    if (!effectiveVehicleId) return '車両が選択されていません';
    try {
      await api.createTrip(effectiveVehicleId, trip);
      setNewTripEnabled(false);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : '記録の追加に失敗しました';
    }
  }

  return (
    <>
      {/* 車両切り替え（利用頻度が高いので常に上部に固定） */}
      <section className="sticky top-0 z-20 -mx-4 px-4 py-3 bg-white/95 backdrop-blur border-b border-gray-200 flex items-center gap-3">
        {vehicles.length ? (
          <label className="flex items-center gap-2 grow min-w-0">
            <span className="text-sm font-medium text-gray-500 shrink-0">車両</span>
            <select
              onChange={setCurrentVehicle}
              value={effectiveVehicleId ?? ''}
              className="grow min-w-0 text-lg font-medium py-2 px-3 rounded-lg border border-gray-300 bg-white focus:outline-none focus:border-lime-500"
            >
              {vehicles.map(({ id, name }) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          </label>
        ) : (
          <p className="grow text-sm text-gray-500">車両がまだありません</p>
        )}
        <button
          type="button"
          onClick={addVehicle}
          className="shrink-0 text-sm text-lime-700 font-medium active:text-lime-800"
        >
          ＋ 車両を追加
        </button>
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
        {displayTrips.map(({ id, date, odo, trip, class: cls }) => (
          <li
            key={id}
            className="rounded-xl border border-gray-200 bg-white shadow-sm p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-gray-500 tabular-nums">{formatDate(date)}</span>
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
      {effectiveVehicleId && !newTripEnabled && (
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
            <NewTrip minOdo={lastODO} onSubmit={createTrip} onCancel={() => setNewTripEnabled(false)} classOptions={vehicleClasses} />
          </div>
        </div>
      )}
    </>
  );
}
