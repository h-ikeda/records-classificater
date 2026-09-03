import type { User } from 'firebase/auth';
import { getFirestore, onSnapshot, doc, addDoc, query, writeBatch, getDoc, where, updateDoc, Timestamp } from 'firebase/firestore';
import { useEffect, useMemo, useRef, useState } from 'react';
import NewTrip from './components/NewTrip';
import { channelCollection, channelDoc, previewChannel } from '../firestore/channel';
import { tripConverter, type Trip } from '../firestore/definitions/Trip';
import { userConverter } from '../firestore/definitions/User';
import { tripsConverter } from '../firestore/definitions/Trips';
import { Vehicle, vehicleConverter } from '../firestore/definitions/Vehicle';
import Loader from '../components/Loader';

interface TripIdentified extends Trip {
  id: string,
}

interface TripCalculated extends TripIdentified {
  trip: number,
}

interface VehicleIdentified extends Vehicle {
  id: string,
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
  return (t1 as unknown as number) - (t2 as unknown as number);
}

function formatDate(timestamp: Timestamp) {
  const d = timestamp.toDate();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function formatNumber(number: number) {
  return number.toFixed(6).replace(/\.?0*$/, '');
}

export default function TripClassificater({ currentUser }: { currentUser: User }) {
  // initializeApp 後に評価されるよう、Firestore はコンポーネント内で取得する
  const db = getFirestore();
  const [currentVehicleId, setCurrentVehicleId] = useState<string | null>(null);
  const [vehicleClasses, setVehicleClasses] = useState<string[]>([]);
  const [currentYear, setCurrentYear] = useState(() => (new Date()).getFullYear());
  const [vehicles, setVehicles] = useState<VehicleIdentified[]>([]);
  const [trips, setTrips] = useState<TripIdentified[]>([]);
  const [newTripEnabled, setNewTripEnabled] = useState(false);
  // 取得前の空データを「記録なし」と誤表示しないよう、読み込み完了を明示的に管理する
  const [userLoaded, setUserLoaded] = useState(false);
  const [vehiclesLoaded, setVehiclesLoaded] = useState(false);
  const [tripsLoaded, setTripsLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  // users ドキュメントが無い＝まだ車両が 1 台も無い状態。車両名を尋ねる画面を出す
  const [needsSetup, setNeedsSetup] = useState(false);
  const [setupName, setSetupName] = useState('');
  const [setupSaving, setSetupSaving] = useState(false);
  const [setupError, setSetupError] = useState('');
  // 移行処理の実行中フラグ。移行中に届くスナップショットは自分のローカル書き込みの
  // 反映であり、参照先の車両がまだサーバーに無いため状態へ反映してはいけない
  const migrating = useRef(false);

  useEffect(() => {
    setVehicles([]);
    setUserLoaded(false);
    setVehiclesLoaded(false);
    setLoadError('');
    setNeedsSetup(false);
    migrating.current = false;
    // スナップショットのコールバックでは状態を更新するだけにする。ここで待たせたり
    // ダイアログを出したりすると、その間に購読の受信ストリームが切れることがある
    const unsubUser = onSnapshot(channelDoc(db, 'users', currentUser.uid).withConverter(userConverter), (snapshot) => {
      if (!snapshot.exists()) {
        // まだ車両が 1 台も無い。登録は createFirstVehicle（フォームの送信）で行う
        setNeedsSetup(true);
        setUserLoaded(true);
        return;
      }
      // 登録中に届くのは自分のローカル書き込みの反映で、車両はまだサーバーに無い。
      // trips のルールは親の車両ドキュメントを get して権限を見るため、ここで
      // 購読を始めると権限エラーになる。createFirstVehicle が確定後に反映する
      if (migrating.current) return;
      setNeedsSetup(false);
      setCurrentVehicleId(snapshot.data().state.vehicle);
      setUserLoaded(true);
    }, () => {
      setLoadError('データの読み込みに失敗しました');
      setUserLoaded(true);
    });
    const unsubVehicles = onSnapshot(query(channelCollection(db, 'vehicles'), where('permissions.read', 'array-contains', currentUser.uid)).withConverter(vehicleConverter), (snapshot) => {
      // 1 件の変換に失敗しても読み込み中のまま止まらないよう、完了を先に記録する
      setVehiclesLoaded(true);
      snapshot.docChanges().forEach(({ doc, type }) => {
        setVehicles((prev) => {
          if (type === 'added') {
            return [...prev, { ...doc.data(), id: doc.id }];
          }
          const i = prev.findIndex(({ id }) => doc.id === id);
          if (i < 0) return prev;
          if (type === 'modified') {
            const next = [...prev];
            next[i] = { ...doc.data(), id: doc.id };
            return next;
          }
          return prev.filter((_, idx) => idx !== i);
        });
      });
    }, () => {
      setLoadError('車両一覧の読み込みに失敗しました');
      setVehiclesLoaded(true);
    });
    return () => {
      unsubUser();
      unsubVehicles();
    };
  }, [currentUser]);

  useEffect(() => {
    // 車両切り替え時は前の車両の記録を残さず、読み込み中として扱う
    setTrips([]);
    setVehicleClasses([]);
    setTripsLoaded(false);
    if (!currentVehicleId) return;
    const unsubVehicle = onSnapshot(channelDoc(db, 'vehicles', currentVehicleId).withConverter(vehicleConverter), (snapshot) => {
      setVehicleClasses(snapshot.data()?.classes || []);
    }, () => {
      setVehicleClasses([]);
    });
    const unsubTrips = onSnapshot(channelCollection(db, 'vehicles', currentVehicleId, 'trips').withConverter(tripConverter), (snapshot) => {
      // 1 件の変換に失敗しても読み込み中のまま止まらないよう、完了を先に記録する
      setTripsLoaded(true);
      snapshot.docChanges().forEach(({ type, doc }) => {
        setTrips((prev) => {
          if (type === 'added') {
            return [...prev, { ...doc.data(), id: doc.id }];
          }
          const i = prev.findIndex(({ id }) => id === doc.id);
          if (i < 0) return prev;
          if (type === 'modified') {
            const next = [...prev];
            next[i] = { ...doc.data(), id: doc.id };
            return next;
          }
          return prev.filter((_, idx) => idx !== i);
        });
      });
    }, () => {
      setLoadError('走行記録の読み込みに失敗しました');
      setTripsLoaded(true);
    });
    return () => {
      unsubVehicle();
      unsubTrips();
    };
  }, [currentVehicleId]);

  const calculatedTrips = useMemo<TripCalculated[]>(() => {
    const [first, ...remains] = [...trips].sort(sortByTimestamp);
    if (!first) return [];
    return remains.reduce(([acc, odo]: [TripCalculated[], number], trip: TripIdentified): [TripCalculated[], number] => {
      acc.push({ ...trip, trip: trip.odo - odo });
      return [acc, trip.odo];
    }, [[{ ...first, trip: 0 }], first.odo] as [TripCalculated[], number])[0];
  }, [trips]);

  const classSummaries = useMemo(() => calculatedTrips.filter(({ timestamp }) => {
    return timestamp.toDate().getFullYear() === currentYear;
  }).reduce((acc, { class: c, trip }) => {
    if (!(c in acc)) acc[c] = 0;
    if (trip !== undefined) acc[c] += trip;
    return acc;
  }, {} as Record<string, number>), [calculatedTrips, currentYear]);

  const sum = useMemo(() => {
    const last = [...calculatedTrips].reverse().find(({ timestamp }) => timestamp.toDate().getFullYear() === currentYear);
    let first = [...calculatedTrips].reverse().find(({ timestamp }) => timestamp.toDate().getFullYear() === currentYear - 1);
    if (!first) first = calculatedTrips.find(({ timestamp }) => timestamp.toDate().getFullYear() === currentYear);
    if (!first || !last) return 0;
    return last.odo - first.odo;
  }, [calculatedTrips, currentYear]);

  // 一覧は新しい順に表示する（trip の差分計算は古い順のまま）
  const displayTrips = useMemo(() => [...calculatedTrips].reverse(), [calculatedTrips]);

  // trips はスナップショット順で時系列とは限らないため、ODO（単調増加）の最大値を最新値とする
  const lastODO = useMemo(() => trips.reduce((max, { odo }) => (odo > max ? odo : max), 0), [trips]);

  // ユーザー情報と車両一覧が揃うまでは選択肢を確定できない
  const vehiclesLoading = !userLoaded || !vehiclesLoaded;
  // 車両が決まる前や切り替え直後は、記録が空でも「記録なし」とは判断しない
  const tripsLoading = !userLoaded || (!!currentVehicleId && !tripsLoaded);

  // 症状の切り分け用。どの購読が返ってきていないかと、待っている時間を出す。
  // 「読み込み中のまま止まる」ときに、4 つの購読のどれが原因かを画面から判別
  // できるようにするためのもので、プレビューとローカル開発でだけ表示する
  const showDiagnostics = previewChannel !== null || process.env.NODE_ENV !== 'production';
  const pending = [
    !userLoaded && 'ユーザー情報',
    !vehiclesLoaded && '車両一覧',
    !!currentVehicleId && !tripsLoaded && '走行記録',
  ].filter(Boolean).join(' / ');
  const [waitingSeconds, setWaitingSeconds] = useState(0);

  useEffect(() => {
    if (!pending) {
      setWaitingSeconds(0);
      return;
    }
    const started = Date.now();
    const id = setInterval(() => setWaitingSeconds(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [pending]);

  function Diagnostics() {
    if (!showDiagnostics || !pending) return null;
    return (
      <p className="mt-2 text-center text-xs text-gray-400 tabular-nums">
        待機中: {pending}（{waitingSeconds} 秒）
      </p>
    );
  }

  function classStyle(cls: string) {
    const i = vehicleClasses.indexOf(cls);
    return classPalette[(i < 0 ? 0 : i) % classPalette.length];
  }

  function setCurrentVehicle(event: React.ChangeEvent<HTMLSelectElement>) {
    updateDoc(channelDoc(db, 'users', currentUser.uid), {
      'state.vehicle': event.target.value,
    });
  }

  // 最初の車両を作り、旧データがあれば移行する。ユーザー操作から呼ぶこと
  async function createFirstVehicle(event: React.FormEvent) {
    event.preventDefault();
    const name = setupName.trim();
    if (!name) {
      setSetupError('車両名を入力してください');
      return;
    }
    if (migrating.current) return;
    migrating.current = true;
    setSetupSaving(true);
    setSetupError('');
    try {
      const { data: oldTrips } = (await getDoc(channelDoc(db, 'trips', currentUser.uid).withConverter(tripsConverter))).data() || { data: [] };
      const classes = Array.from(oldTrips.reduce((acc, { class: cls }) => {
        return acc.add(cls);
      }, new Set<string>()));
      const batch1 = writeBatch(db);
      const newVehicle = doc(channelCollection(db, 'vehicles')).withConverter(vehicleConverter);
      await batch1
        .set(newVehicle, {
          classes,
          name,
          permissions: {
            read: [currentUser.uid],
            write: [currentUser.uid],
          },
        })
        .set(channelDoc(db, 'users', currentUser.uid).withConverter(userConverter), {
          state: { vehicle: newVehicle.id },
        })
        .commit();
      const batch2 = writeBatch(db);
      oldTrips.forEach((trip) => {
        batch2.set(doc(channelCollection(db, 'vehicles', newVehicle.id, 'trips')).withConverter(tripConverter), trip);
      });
      // 過去記録の移行に失敗しても車両自体は作成済みなので、画面は進める
      await batch2.commit().catch(() => setLoadError('過去の記録の移行に失敗しました'));
      // commit の解決はサーバー確定を待つ。確定してから購読を始める
      setCurrentVehicleId(newVehicle.id);
      setNeedsSetup(false);
    } catch {
      setSetupError('登録に失敗しました。通信状況を確認して、もう一度お試しください');
    } finally {
      migrating.current = false;
      setSetupSaving(false);
    }
  }

  // 却下時は理由を返し、フォーム側でユーザーに提示できるようにする
  function createTrip(trip: Trip): string | null {
    const prevTrip = [...calculatedTrips].reverse().find(({ timestamp }) => trip.timestamp.seconds > timestamp.seconds || trip.timestamp.seconds === timestamp.seconds && trip.timestamp.nanoseconds > timestamp.nanoseconds);
    const nextTrip = calculatedTrips.find(({ timestamp }) => trip.timestamp.seconds < timestamp.seconds || trip.timestamp.seconds === timestamp.seconds && trip.timestamp.nanoseconds < timestamp.nanoseconds);
    if (prevTrip && trip.odo <= prevTrip.odo) return `ODOは前の記録（${formatNumber(prevTrip.odo)} km）より大きい値を入力してください`;
    if (nextTrip && trip.odo >= nextTrip.odo) return `ODOは次の記録（${formatNumber(nextTrip.odo)} km）より小さい値を入力してください`;
    if (!currentVehicleId) return '車両が選択されていません';
    addDoc(channelCollection(db, 'vehicles', currentVehicleId, 'trips').withConverter(tripConverter), trip);
    setNewTripEnabled(false);
    return null;
  }

  // 車両が 1 台も無いうちは、他の操作より先に車両名を尋ねる
  if (needsSetup) {
    return (
      <section className="mt-8 mx-auto max-w-sm">
        <h3 className="text-lg font-bold text-gray-800">最初の車両を登録</h3>
        <p className="mt-2 text-sm text-gray-500">走行を記録する車両の名前を入力してください。あとから設定で変更できます。</p>
        <form className="mt-5 space-y-4" onSubmit={createFirstVehicle}>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">車両名</span>
            <input
              value={setupName}
              onChange={(e) => setSetupName(e.target.value)}
              type="text"
              placeholder="例: カローラ"
              autoFocus
              className="w-full text-lg font-medium border-b-2 border-lime-500 bg-transparent focus:outline-none py-1"
            />
          </label>
          {setupError && <p className="text-sm text-red-600" role="alert">{setupError}</p>}
          <button
            type="submit"
            disabled={setupSaving}
            className="w-full bg-lime-500 text-white rounded-xl py-3 font-bold shadow active:bg-lime-600 disabled:opacity-60"
          >
            {setupSaving ? '登録中…' : '登録する'}
          </button>
        </form>
      </section>
    );
  }

  return (
    <>
      {/* 車両切り替え（利用頻度が高いので常に上部に固定） */}
      <section className="sticky top-0 z-20 -mx-4 px-4 py-3 bg-white/95 backdrop-blur border-b border-gray-200 flex items-center gap-3">
        <label className="flex items-center gap-2 grow min-w-0">
          <span className="text-sm font-medium text-gray-500 shrink-0">車両</span>
          <select
            onChange={setCurrentVehicle}
            value={currentVehicleId ?? ''}
            disabled={vehiclesLoading}
            className="grow min-w-0 text-lg font-medium py-2 px-3 rounded-lg border border-gray-300 bg-white focus:outline-none focus:border-lime-500 disabled:text-gray-400"
          >
            {/* 選択中の車両が一覧に現れるまでは、空表示ではなく状態を示す選択肢を出す */}
            {!vehicles.some(({ id }) => id === currentVehicleId) && (
              <option value={currentVehicleId ?? ''}>{vehiclesLoading ? '読み込み中…' : '車両がありません'}</option>
            )}
            {vehicles.map(({ id, name }) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </label>
      </section>

      {loadError && <p className="mt-3 text-sm text-red-600 text-center" role="alert">{loadError}</p>}

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
          {tripsLoading ? (
            <>
              <Loader className="text-lime-500 text-2xl py-2" />
              <Diagnostics />
            </>
          ) : Object.keys(classSummaries).length ? (
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
        {tripsLoading ? (
          <li className="py-10">
            <Loader className="text-lime-500 text-3xl" />
            <Diagnostics />
          </li>
        ) : !displayTrips.length ? (
          <li className="text-center text-gray-400 py-10">
            {currentVehicleId ? (
              <>まだ記録がありません。<br />下のボタンから追加できます。</>
            ) : '車両が選択されていません。'}
          </li>
        ) : null}
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
            <NewTrip minOdo={lastODO} onSubmit={createTrip} onCancel={() => setNewTripEnabled(false)} classOptions={vehicleClasses} />
          </div>
        </div>
      )}
    </>
  );
}
