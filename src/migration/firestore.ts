import { randomUUID } from 'node:crypto';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { Firestore } from 'firebase-admin/firestore';
import { trips, userStates, vehicleMembers, vehicles } from '../db/schema';

// drizzle のどのドライバ（neon-http / pglite など）でも受け取れるよう、共通の基底型で受ける。
export type MigrationDb = PgDatabase<PgQueryResultHKT, typeof import('../db/schema')>;

/**
 * Firestore から読み出した、移行に必要な最小限のプレーンデータ。
 * （admin SDK 非依存にして純粋関数としてテストできるようにする）
 */
export interface FirestoreSnapshot {
  vehicles: {
    id: string;
    name: string;
    classes: string[];
    permissions: { read: string[]; write: string[] };
    trips: { odo: number; class: string; timestamp: Date }[];
  }[];
  users: { id: string; vehicle: string | null }[];
  // 旧 `trips/{uid}` ドキュメント（車両導入前の形式）。data 配列を持つ。
  legacyTrips: { uid: string; data: { odo: number; class: string; timestamp: Date }[] }[];
}

export interface MigrationRows {
  vehicles: (typeof vehicles.$inferInsert)[];
  members: (typeof vehicleMembers.$inferInsert)[];
  trips: (typeof trips.$inferInsert)[];
  userStates: (typeof userStates.$inferInsert)[];
}

/**
 * 権限配列 read/write を vehicle_members の行へ畳み込む。
 */
function buildMembers(vehicleId: string, permissions: { read: string[]; write: string[] }) {
  const readers = new Set(permissions.read ?? []);
  const writers = new Set(permissions.write ?? []);
  const everyone = new Set([...readers, ...writers]);
  return Array.from(everyone).map((userId) => ({
    vehicleId,
    userId,
    canRead: readers.has(userId),
    canWrite: writers.has(userId),
  }));
}

/**
 * Firestore スナップショットを Postgres へ投入する行へ変換する純粋関数。
 * Firestore の文字列 ID は uuid と互換でないため新規 uuid を採番し、
 * 旧 ID → 新 uuid の対応で user_states の参照を解決する。
 */
export function buildRows(snapshot: FirestoreSnapshot): MigrationRows {
  const rows: MigrationRows = { vehicles: [], members: [], trips: [], userStates: [] };
  const idMap = new Map<string, string>();

  for (const v of snapshot.vehicles) {
    const id = randomUUID();
    idMap.set(v.id, id);
    rows.vehicles.push({ id, name: v.name, classes: v.classes ?? [] });
    rows.members.push(...buildMembers(id, v.permissions ?? { read: [], write: [] }));
    for (const t of v.trips) {
      rows.trips.push({ vehicleId: id, odo: t.odo, class: t.class, timestamp: t.timestamp });
    }
  }

  // ユーザーが既に車両を持っている（= アプリ内移行済み or 新形式）uid を記録する。
  const migratedUsers = new Set<string>();
  for (const u of snapshot.users) {
    migratedUsers.add(u.id);
    const vehicleId = u.vehicle ? idMap.get(u.vehicle) ?? null : null;
    rows.userStates.push({ userId: u.id, vehicleId });
  }

  // 旧 `trips/{uid}` は、まだアプリ内移行されていないユーザーのみ車両へ変換する。
  // （users ドキュメントが存在するユーザーは移行済みとみなし、重複投入を避ける）
  for (const legacy of snapshot.legacyTrips) {
    if (migratedUsers.has(legacy.uid)) continue;
    if (!legacy.data.length) continue;
    const id = randomUUID();
    const classes = Array.from(new Set(legacy.data.map((t) => t.class)));
    rows.vehicles.push({ id, name: '(移行された車両)', classes });
    rows.members.push({ vehicleId: id, userId: legacy.uid, canRead: true, canWrite: true });
    for (const t of legacy.data) {
      rows.trips.push({ vehicleId: id, odo: t.odo, class: t.class, timestamp: t.timestamp });
    }
    rows.userStates.push({ userId: legacy.uid, vehicleId: id });
  }

  return rows;
}

/**
 * admin SDK の Firestore から移行対象データを読み出す。
 */
export async function readFirestore(firestore: Firestore): Promise<FirestoreSnapshot> {
  const snapshot: FirestoreSnapshot = { vehicles: [], users: [], legacyTrips: [] };

  const vehicleDocs = await firestore.collection('vehicles').get();
  for (const doc of vehicleDocs.docs) {
    const data = doc.data();
    const tripDocs = await doc.ref.collection('trips').get();
    snapshot.vehicles.push({
      id: doc.id,
      name: data.name ?? '',
      classes: data.classes ?? [],
      permissions: {
        read: data.permissions?.read ?? [],
        write: data.permissions?.write ?? [],
      },
      trips: tripDocs.docs.map((t) => {
        const td = t.data();
        return { odo: td.odo, class: td.class, timestamp: td.timestamp.toDate() };
      }),
    });
  }

  const userDocs = await firestore.collection('users').get();
  for (const doc of userDocs.docs) {
    snapshot.users.push({ id: doc.id, vehicle: doc.data().state?.vehicle ?? null });
  }

  const legacyDocs = await firestore.collection('trips').get();
  for (const doc of legacyDocs.docs) {
    const data = doc.data();
    snapshot.legacyTrips.push({
      uid: doc.id,
      data: (data.data ?? []).map((t: { odo: number; class: string; timestamp: { toDate(): Date } }) => ({
        odo: t.odo,
        class: t.class,
        timestamp: t.timestamp.toDate(),
      })),
    });
  }

  return snapshot;
}

/**
 * 変換済みの行を Postgres へ投入する。FK 制約を満たすため vehicles を先に入れる。
 * 移行はテーブル所有者ロールで実行する想定（RLS はバイパスされる）。
 */
export async function writeRows(db: MigrationDb, rows: MigrationRows): Promise<void> {
  if (rows.vehicles.length) await db.insert(vehicles).values(rows.vehicles);
  if (rows.members.length) await db.insert(vehicleMembers).values(rows.members);
  if (rows.trips.length) await db.insert(trips).values(rows.trips);
  if (rows.userStates.length) await db.insert(userStates).values(rows.userStates);
}

/**
 * Firestore → Neon (Postgres) の移行を実行する。
 */
export async function migrate(firestore: Firestore, db: MigrationDb): Promise<MigrationRows> {
  const snapshot = await readFirestore(firestore);
  const rows = buildRows(snapshot);
  await writeRows(db, rows);
  return rows;
}
