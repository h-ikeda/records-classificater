import { getFirestore } from 'firebase/firestore';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createFirestoreTripGateway } from './firestoreGateway';
import { createTripStore, type TripStore, type TripStoreState } from './store';

/**
 * 走行記録のストアを 1 つ用意し、その状態を購読する。
 *
 * ストアは resetKey が変わったときだけ作り直す。車両を切り替えても作り直さない
 * ので、購読は張られたまま残り、戻ってきたときに取得済みの記録をそのまま使える。
 * 読み込みに失敗して張り直したいときは resetKey を変えること。
 */
export function useTripStore(resetKey: unknown): { store: TripStore, state: TripStoreState } {
  // initializeApp 後に評価されるよう、Firestore はコンポーネント内で取得する
  const db = getFirestore();
  const store = useMemo(() => createTripStore(createFirestoreTripGateway(db)), [db, resetKey]);
  // 作り直したときは、前のストアの購読をすべて解除する
  useEffect(() => () => store.dispose(), [store]);
  const state = useSyncExternalStore(store.subscribe, store.getState);
  return { store, state };
}
