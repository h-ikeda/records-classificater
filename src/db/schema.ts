import { sql, type SQLWrapper } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole, authUid, crudPolicy } from 'drizzle-orm/neon';

// Neon RLS (Neon Authorize) は Clerk JWT の `sub` クレームを `auth.user_id()` で公開する。
// 以下のポリシーはすべてこの値を基準に判定し、旧 Firestore ルールの request.auth.uid を置き換える。
const currentUserId = sql`(select auth.user_id())`;

// 権限判定は SECURITY DEFINER 関数（drizzle/0000_helpers.sql で定義）に委譲する。
// vehicle_members を直接参照すると、vehicle_members 自身のポリシー評価が再帰してしまうため、
// 所有者権限で RLS をバイパスして判定する関数を経由する。
const canRead = (vehicleIdColumn: SQLWrapper) =>
  sql`public.can_read_vehicle(${vehicleIdColumn})`;
const canWrite = (vehicleIdColumn: SQLWrapper) =>
  sql`public.can_write_vehicle(${vehicleIdColumn})`;

/**
 * 各ユーザーの状態。旧 Firestore の `users/{uid}`（state.vehicle）に対応。自分の行のみ読み書き可。
 */
export const userStates = pgTable(
  'user_states',
  {
    userId: text('user_id').primaryKey(),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    crudPolicy({
      role: authenticatedRole,
      read: authUid(t.userId),
      modify: authUid(t.userId),
    }),
  ],
);

/**
 * 車両。旧 Firestore の `vehicles/{vid}` に対応。権限は vehicle_members で表現する。
 */
export const vehicles = pgTable(
  'vehicles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    classes: text('classes').array().notNull().default(sql`'{}'::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 読み取り: read 権限を持つ車両のみ（旧 list/get）
    pgPolicy('vehicles_select', { for: 'select', to: authenticatedRole, using: canRead(t.id) }),
    // 作成: 認証済みなら誰でも（旧 create）。作成者は別途 vehicle_members へ自身を登録する。
    pgPolicy('vehicles_insert', { for: 'insert', to: authenticatedRole, withCheck: sql`true` }),
    // 更新・削除: write 権限を持つユーザーのみ（旧 update）
    pgPolicy('vehicles_update', {
      for: 'update',
      to: authenticatedRole,
      using: canWrite(t.id),
      withCheck: canWrite(t.id),
    }),
    pgPolicy('vehicles_delete', { for: 'delete', to: authenticatedRole, using: canWrite(t.id) }),
  ],
);

/**
 * 車両ごとの権限。旧 permissions.read / permissions.write 配列に対応。
 */
export const vehicleMembers = pgTable(
  'vehicle_members',
  {
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    canRead: boolean('can_read').notNull().default(true),
    canWrite: boolean('can_write').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.vehicleId, t.userId] }),
    // 読み取り: 自分の権限行のみ（他人の権限一覧は公開しない）
    pgPolicy('vehicle_members_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.userId} = ${currentUserId}`,
    }),
    // 追加: 自分自身の登録（車両作成直後）、またはその車両の write 権限者による共有（旧 share）
    pgPolicy('vehicle_members_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${t.userId} = ${currentUserId} or ${canWrite(t.vehicleId)}`,
    }),
    // 更新: その車両の write 権限者のみ
    pgPolicy('vehicle_members_update', {
      for: 'update',
      to: authenticatedRole,
      using: canWrite(t.vehicleId),
    }),
    // 削除: write 権限者、または自身の権限を外す場合
    pgPolicy('vehicle_members_delete', {
      for: 'delete',
      to: authenticatedRole,
      using: sql`${t.userId} = ${currentUserId} or ${canWrite(t.vehicleId)}`,
    }),
  ],
);

/**
 * 走行記録。旧 Firestore の `vehicles/{vid}/trips/{tid}` に対応。
 */
export const trips = pgTable(
  'trips',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    odo: doublePrecision('odo').notNull(),
    class: text('class').notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 読み取り: 車両の read 権限者のみ
    pgPolicy('trips_select', { for: 'select', to: authenticatedRole, using: canRead(t.vehicleId) }),
    // 作成: 車両の write 権限者で、class が車両の classes に含まれる場合のみ（旧 create）
    pgPolicy('trips_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${canWrite(t.vehicleId)} and exists (
        select 1 from vehicles v
        where v.id = ${t.vehicleId}
          and ${t.class} = any(v.classes)
      )`,
    }),
    // 更新・削除: 車両の write 権限者のみ
    pgPolicy('trips_update', { for: 'update', to: authenticatedRole, using: canWrite(t.vehicleId) }),
    pgPolicy('trips_delete', { for: 'delete', to: authenticatedRole, using: canWrite(t.vehicleId) }),
  ],
);

export type Vehicle = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;
export type VehicleMember = typeof vehicleMembers.$inferSelect;
export type Trip = typeof trips.$inferSelect;
export type NewTrip = typeof trips.$inferInsert;
export type UserState = typeof userStates.$inferSelect;
