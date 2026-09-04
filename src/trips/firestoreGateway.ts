import {
  Timestamp,
  getDocs,
  limit as limitTo,
  onSnapshot,
  orderBy,
  query,
  where,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { channelCollection } from '../firestore/channel';
import { subscribeWithWatchdog } from '../firestore/watchdog';
import { tripConverter, type Trip } from '../firestore/definitions/Trip';
import { yearBounds, type TripIdentified } from './aggregate';
import type { LatestHandlers, TripGateway } from './store';

// store.ts が使う読み取り口の Firestore 実装。
//
// 並べ替えと範囲の絞り込みはどれも timestamp 1 つだけなので、Firestore が自動で
// 作る単一フィールドの索引で足りる（複合索引の追加は要らない）。

function tripsCollection(db: Firestore, vehicleId: string) {
  return channelCollection(db, 'vehicles', vehicleId, 'trips').withConverter(tripConverter);
}

function toTrip(doc: QueryDocumentSnapshot<Trip>): TripIdentified {
  return { ...doc.data(), id: doc.id };
}

export function createFirestoreTripGateway(db: Firestore): TripGateway {
  return {
    subscribeLatest(vehicleId: string, max: number, handlers: LatestHandlers) {
      const { onWindow, onError, onStalled, onRecovered } = handlers;
      return subscribeWithWatchdog((notify) => onSnapshot(
        query(tripsCollection(db, vehicleId), orderBy('timestamp', 'desc'), limitTo(max)),
        // includeMetadataChanges を付けないと、キャッシュ由来のスナップショットが
        // サーバー同期済みへ変わっただけのイベントが届かない（公式「Listen to
        // offline data」）。fromCache を判断に使う以上、必ず付ける
        { includeMetadataChanges: true },
        (snapshot) => {
          // キャッシュ由来の内容は「古いか、欠けているかもしれない」（公式）。
          // 読み込み完了と見なしてよいのは、サーバーと同期できたときだけ
          const synced = !snapshot.metadata.fromCache;
          if (synced) notify();
          // 差分（docChanges）ではなく、そのときのウィンドウの全部を渡す。
          // 取り込む側はドキュメント ID を鍵にして上書きするので、張り直しで
          // 全件が届いても重複しない
          onWindow({ trips: snapshot.docs.map(toTrip), synced });
        },
        () => {
          notify();
          onError();
        },
      ), { label: '走行記録', onStalled, onRecovered });
    },

    async fetchOlder(vehicleId: string, boundary: Timestamp, max: number) {
      const snapshot = await getDocs(query(
        tripsCollection(db, vehicleId),
        where('timestamp', '<=', boundary),
        orderBy('timestamp', 'desc'),
        limitTo(max),
      ));
      return snapshot.docs.map(toTrip);
    },

    async fetchYear(vehicleId: string, year: number) {
      const { start, end } = yearBounds(year);
      const collectionRef = tripsCollection(db, vehicleId);
      // その年の記録と、前年までの最終走行距離。年間の合計は
      // 「その年の最後の ODO − 前年までの最後の ODO」なので、後者は 1 件で足りる
      const [inYear, before] = await Promise.all([
        getDocs(query(
          collectionRef,
          where('timestamp', '>=', Timestamp.fromDate(start)),
          where('timestamp', '<', Timestamp.fromDate(end)),
          orderBy('timestamp', 'asc'),
        )),
        getDocs(query(
          collectionRef,
          where('timestamp', '<', Timestamp.fromDate(start)),
          orderBy('timestamp', 'desc'),
          limitTo(1),
        )),
      ]);
      return {
        trips: inYear.docs.map(toTrip),
        base: before.docs.length ? toTrip(before.docs[0]) : null,
      };
    },

    async fetchLastBefore(vehicleId: string, boundary: Timestamp) {
      const snapshot = await getDocs(query(
        tripsCollection(db, vehicleId),
        where('timestamp', '<', boundary),
        orderBy('timestamp', 'desc'),
        limitTo(1),
      ));
      return snapshot.docs.length ? toTrip(snapshot.docs[0]) : null;
    },
  };
}
