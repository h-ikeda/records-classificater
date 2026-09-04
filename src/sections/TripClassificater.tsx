import type { User } from 'firebase/auth';
import { getFirestore, onSnapshot, doc, addDoc, query, writeBatch, getDoc, where, updateDoc, Timestamp } from 'firebase/firestore';
import { useEffect, useMemo, useRef, useState } from 'react';
import NewTrip from './components/NewTrip';
import { channelCollection, channelDoc } from '../firestore/channel';
import { subscribeWithWatchdog } from '../firestore/watchdog';
import { tripConverter, type Trip } from '../firestore/definitions/Trip';
import { userConverter } from '../firestore/definitions/User';
import { tripsConverter } from '../firestore/definitions/Trips';
import { Vehicle, vehicleConverter } from '../firestore/definitions/Vehicle';
import { calculateTrips, compareTimestamp, type TripIdentified } from '../trips/aggregate';
import { EMPTY_TRIPS_STATE, EMPTY_YEAR_STATE, yearKey } from '../trips/store';
import { useTripStore } from '../trips/useTripStore';
import Loader from '../components/Loader';

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

// 見張りが諦めたときの表示。遅れて届いたら取り下げるので、どの購読が出した
// メッセージかを見分けられるよう定数にしておく
const STALLED_MESSAGE = {
  user: 'データを読み込めませんでした。通信状況を確認して再試行してください',
  vehicles: '車両一覧を読み込めませんでした。通信状況を確認して再試行してください',
};

// 走行記録の読み込みで出す文言。ストアは失敗の種類だけを持ち、文言は画面で決める
const TRIPS_MESSAGE = {
  failed: '走行記録の読み込みに失敗しました',
  stalled: '走行記録を読み込めませんでした。通信状況を確認して再試行してください',
};

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
  const [currentYear, setCurrentYear] = useState(() => (new Date()).getFullYear());
  // 年間集計は畳んである間は 1 件も読まない。開かれたときだけ取りに行く
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [vehicles, setVehicles] = useState<VehicleIdentified[]>([]);
  const [newTripEnabled, setNewTripEnabled] = useState(false);
  // 取得前の空データを「記録なし」と誤表示しないよう、読み込み完了を明示的に管理する
  const [userLoaded, setUserLoaded] = useState(false);
  const [vehiclesLoaded, setVehiclesLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  // 再試行のたびに増やす。購読を張り直すためだけの値
  const [reloadKey, setReloadKey] = useState(0);
  // users ドキュメントが無い＝まだ車両が 1 台も無い状態。車両名を尋ねる画面を出す
  const [needsSetup, setNeedsSetup] = useState(false);
  const [setupName, setSetupName] = useState('');
  const [setupSaving, setSetupSaving] = useState(false);
  const [setupError, setSetupError] = useState('');
  // 移行処理の実行中フラグ。移行中に届くスナップショットは自分のローカル書き込みの
  // 反映であり、参照先の車両がまだサーバーに無いため状態へ反映してはいけない
  const migrating = useRef(false);
  // 一覧の末尾。ここが見えたら続きを読み足す。
  //
  // ref ではなく state で持つ。ref だと、目印が現れたこと自体は再描画にも
  // effect の依存にも表れないため、見張りを張る effect が「目印がまだ無い」
  // まま走って空振りしたあと、二度と走らないことがある（下の effect の注記）。
  const [loadMoreAnchor, setLoadMoreAnchor] = useState<HTMLLIElement | null>(null);

  const { store, state } = useTripStore(`${currentUser.uid}:${reloadKey}`);
  const tripsState = (currentVehicleId && state.trips[currentVehicleId]) || EMPTY_TRIPS_STATE;
  const yearState = (currentVehicleId && state.years[yearKey(currentVehicleId, currentYear)]) || EMPTY_YEAR_STATE;

  useEffect(() => {
    setVehicles([]);
    setUserLoaded(false);
    setVehiclesLoaded(false);
    setLoadError('');
    setNeedsSetup(false);
    // 前の利用者の選択を引きずらない。車両は users ドキュメントから来る
    setCurrentVehicleId(null);
    migrating.current = false;
    // スナップショットのコールバックでは状態を更新するだけにし、書き込みや
    // 入力待ちは持ち込まない（登録は createFirstVehicle が受け持つ）
    // includeMetadataChanges を付けないと、キャッシュ由来のスナップショットが
    // サーバー同期済みへ変わっただけのイベントが届かない（公式「Listen to offline
    // data」）。fromCache を判断に使う以上、必ず付ける
    const unsubUser = subscribeWithWatchdog((notify) => onSnapshot(channelDoc(db, 'users', currentUser.uid).withConverter(userConverter), { includeMetadataChanges: true }, (snapshot) => {
      // キャッシュ由来の内容は「古いか、欠けているかもしれない」（公式）。空の
      // キャッシュでも同じ形で届くため、読み込み完了と見なしてよいのは
      // サーバーと同期できたときだけ
      const fromServer = !snapshot.metadata.fromCache;
      if (fromServer) {
        notify();
        // 変換の失敗や下の早期 return で読み込み中のまま止まらないよう、
        // 完了はスナップショットを見る前に記録する
        setUserLoaded(true);
      }
      if (!snapshot.exists()) {
        // キャッシュに無いだけかもしれないので、「まだ車両が 1 台も無い」と
        // 判断するのはサーバーと同期できたときだけ。さもないと、読み込めて
        // いないだけの利用者に車両の登録画面を出してしまう。
        // 登録は createFirstVehicle（フォームの送信）で行う
        if (fromServer) setNeedsSetup(true);
        return;
      }
      // 登録中に届くのは自分のローカル書き込みの反映で、車両はまだサーバーに無い。
      // trips のルールは親の車両ドキュメントを get して権限を見るため、ここで
      // 購読を始めると権限エラーになる。createFirstVehicle が確定後に反映する
      if (migrating.current) return;
      setNeedsSetup(false);
      setCurrentVehicleId(snapshot.data().state.vehicle);
    }, () => {
      notify();
      setLoadError('データの読み込みに失敗しました');
      setUserLoaded(true);
    }), {
      label: 'ユーザー情報',
      onStalled: () => {
        setLoadError(STALLED_MESSAGE.user);
        setUserLoaded(true);
      },
      // 諦めたあとに遅れて届いたら、出したままの表示を取り下げる
      onRecovered: () => setLoadError((prev) => (prev === STALLED_MESSAGE.user ? '' : prev)),
    });
    // この購読は選択中の車両も含む（読める車両しか選べないため）。分類の一覧は
    // ここから取り出す。車両ドキュメントを別に購読すると、同じものをもう一度
    // 読むことになるので張らない
    const unsubVehicles = subscribeWithWatchdog((notify) => {
      // 張り直すと全件が added として届く。前回分は捨ててから購読する
      setVehicles([]);
      return onSnapshot(query(channelCollection(db, 'vehicles'), where('permissions.read', 'array-contains', currentUser.uid)).withConverter(vehicleConverter), { includeMetadataChanges: true }, (snapshot) => {
        // 空のキャッシュから届く空のスナップショットを完了と見なすと、読めて
        // いないのに「車両がありません」と表示してしまう。完了はサーバーと
        // 同期できたときだけ。反映自体は毎回行い、自分の書き込みは即座に映す
        if (!snapshot.metadata.fromCache) {
          notify();
          // 1 件の変換に失敗しても読み込み中のまま止まらないよう、完了を先に記録する
          setVehiclesLoaded(true);
        }
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
        notify();
        setLoadError('車両一覧の読み込みに失敗しました');
        setVehiclesLoaded(true);
      });
    }, {
      label: '車両一覧',
      onStalled: () => {
        setLoadError(STALLED_MESSAGE.vehicles);
        setVehiclesLoaded(true);
      },
      onRecovered: () => setLoadError((prev) => (prev === STALLED_MESSAGE.vehicles ? '' : prev)),
    });
    return () => {
      unsubUser();
      unsubVehicles();
    };
  }, [currentUser, reloadKey]);

  // 車両が決まったら購読を確保する。切り替えても解除しないので、戻ってきたときは
  // 取得済みのスナップショットがそのまま使われ、読み取りは増えない
  useEffect(() => {
    if (!currentVehicleId) return;
    store.watch(currentVehicleId);
  }, [store, currentVehicleId]);

  // 年間集計は開いているときだけ読む。読み込み済みなら loadYear は何もしない
  useEffect(() => {
    if (!summaryOpen || !currentVehicleId) return;
    store.loadYear(currentVehicleId, currentYear);
  }, [store, summaryOpen, currentVehicleId, currentYear, yearState]);

  // 一覧の末尾が見えたら続きを読み足す。
  //
  // 目印そのものを依存に入れる。読み込み中は目印を描かないので、続きがあると
  // 分かった時点（hasMore）と、目印が現れる時点（読み込み完了）は必ずしも
  // 同じではない。ずれるのは、キャッシュ由来のスナップショットが先に届いた
  // ときで、年間集計を開くと実際に起きる。集計の取得でその年の記録が
  // ローカルキャッシュへ載るため、そのあとに張られた（あるいは張り直された）
  // 購読は、サーバーと同期する前にキャッシュ由来のウィンドウを届ける。
  //
  //   1. キャッシュ由来のウィンドウ → hasMore は立つが loaded はまだ false
  //      （＝一覧はローダーのままで、目印は描かれない）
  //   2. サーバー同期のウィンドウ → loaded が true になり目印が現れる。ただし
  //      中身は同じなので hasMore も件数も変わらない
  //
  // hasMore と件数だけを依存にしていると 2 で effect が走らず、見張りが誰にも
  // 張られないまま「スクロールしても古い記録が増えない」状態になる。
  //
  // 件数も依存に残す。読み足したあとも目印が見えたままなら、張り直して初回の
  // 判定をやり直さないと、続きを読む合図が二度と来ない。
  useEffect(() => {
    if (!loadMoreAnchor || !currentVehicleId) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(({ isIntersecting }) => isIntersecting)) store.loadMore(currentVehicleId);
    });
    observer.observe(loadMoreAnchor);
    return () => observer.disconnect();
  }, [store, currentVehicleId, loadMoreAnchor, tripsState.trips.length]);

  // 分類は車両一覧の購読から取り出す（車両ドキュメントを別に読まない）
  const vehicleClasses = useMemo(() => {
    return vehicles.find(({ id }) => id === currentVehicleId)?.classes || [];
  }, [vehicles, currentVehicleId]);

  // 続きがあるときは、いちばん古い 1 件は「その次の記録の走行距離を出すための
  // 土台」として読んでいるだけなので表示しない
  const [visibleTrips, baseTrip] = useMemo<[TripIdentified[], TripIdentified | null]>(() => {
    if (!tripsState.hasMore) return [tripsState.trips, null];
    return [tripsState.trips.slice(0, -1), tripsState.trips[tripsState.trips.length - 1] || null];
  }, [tripsState.trips, tripsState.hasMore]);

  // 一覧は新しい順に表示する（trip の差分計算は古い順のまま）
  const displayTrips = useMemo(() => calculateTrips(visibleTrips, baseTrip).reverse(), [visibleTrips, baseTrip]);

  // ODO は単調増加なので、読み込み済みの最大値が最新値
  const lastODO = useMemo(() => tripsState.trips.reduce((max, { odo }) => (odo > max ? odo : max), 0), [tripsState.trips]);

  const tripsError = tripsState.failure ? TRIPS_MESSAGE[tripsState.failure] : '';
  const errorMessage = loadError || tripsError;

  // ユーザー情報と車両一覧が揃うまでは選択肢を確定できない
  const vehiclesLoading = !userLoaded || !vehiclesLoaded;
  // 車両が決まる前や切り替え直後は、記録が空でも「記録なし」とは判断しない
  const tripsLoading = !userLoaded || (!!currentVehicleId && !tripsState.loaded);

  function classStyle(cls: string) {
    const i = vehicleClasses.indexOf(cls);
    return classPalette[(i < 0 ? 0 : i) % classPalette.length];
  }

  // 読み込みに失敗した／固まったときに、リロードせず購読だけ張り直す
  function retryLoad() {
    setLoadError('');
    setReloadKey((k) => k + 1);
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
  async function createTrip(trip: Trip): Promise<string | null> {
    if (!currentVehicleId) return '車両が選択されていません';
    // 読み込み済みは「新しいほうから連続した範囲」なので、次（より新しい）の記録は
    // 必ずこの中にある。前（より古い）の記録は、範囲の外なら 1 件だけ問い合わせる
    const nextTrip = [...displayTrips].reverse().find(({ timestamp }) => compareTimestamp(trip.timestamp, timestamp) < 0);
    const prevTrip = await store.findPrevious(currentVehicleId, trip.timestamp);
    if (prevTrip && trip.odo <= prevTrip.odo) return `ODOは前の記録（${formatNumber(prevTrip.odo)} km）より大きい値を入力してください`;
    if (nextTrip && trip.odo >= nextTrip.odo) return `ODOは次の記録（${formatNumber(nextTrip.odo)} km）より小さい値を入力してください`;
    addDoc(channelCollection(db, 'vehicles', currentVehicleId, 'trips').withConverter(tripConverter), trip);
    // 覚えている年間集計は、記録が増えれば合わなくなる。次に開いたときに取り直す
    store.invalidateYears(currentVehicleId);
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

      {errorMessage && (
        <p className="mt-3 text-sm text-red-600 text-center" role="alert">
          {errorMessage}
          <button type="button" onClick={retryLoad} className="ml-2 underline font-medium">再試行</button>
        </p>
      )}

      {/* 年間集計（確認頻度は低いので折りたたみ。開いたときだけ読み込む） */}
      <details
        className="my-3 rounded-xl border border-gray-200 bg-gray-50 overflow-hidden"
        onToggle={(e) => setSummaryOpen(e.currentTarget.open)}
      >
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
          {!currentVehicleId ? (
            <p className="text-center text-sm text-gray-400 py-2">車両が選択されていません</p>
          ) : yearState.failed ? (
            <p className="text-center text-sm text-red-600" role="alert">
              集計を読み込めませんでした
              <button type="button" onClick={() => currentVehicleId && store.loadYear(currentVehicleId, currentYear, true)} className="ml-2 underline font-medium">再試行</button>
            </p>
          ) : !yearState.loaded ? (
            <Loader className="text-lime-500 text-2xl py-2" />
          ) : Object.keys(yearState.byClass).length ? (
            <dl className="space-y-2">
              {Object.entries(yearState.byClass).map(([key, value]) => (
                <div key={key} className="flex items-center gap-3">
                  <dt className={`${classStyle(key)} shrink-0 text-xs font-medium px-2 py-1 rounded-full`}>{key}</dt>
                  <dd className="grow text-right tabular-nums font-medium">{formatNumber(value)} km</dd>
                  {yearState.total ? <dd className="w-16 text-right text-sm text-gray-500 tabular-nums">{Math.round(value / yearState.total * 1000) / 10} %</dd> : null}
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
          </li>
        ) : tripsState.hasMore ? (
          // 見えたら読み足す。自動で読めない環境のために押せるようにもしておく
          <li ref={setLoadMoreAnchor} className="py-6 text-center">
            {tripsState.loadingMore ? (
              <Loader className="text-lime-500 text-2xl" />
            ) : (
              <button
                type="button"
                onClick={() => currentVehicleId && store.loadMore(currentVehicleId)}
                className="text-sm text-gray-500 underline"
              >
                古い記録をもっと見る
              </button>
            )}
          </li>
        ) : !displayTrips.length && !errorMessage ? (
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
