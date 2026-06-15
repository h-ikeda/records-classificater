import { dataApi } from './client';
import type { NewTrip, Trip, UserState, Vehicle } from './schema';

// すべてのクエリは Clerk の JWT（token）を Bearer で付与して Neon Data API を呼び、RLS で保護する。
// 旧 Firestore の onSnapshot（リアルタイム購読）は、取得 + 変更後の再取得に置き換えた。

// PostgREST はカラム名（snake_case）で返すため、アプリの型（camelCase）へ変換する。
interface VehicleRow {
  id: string;
  name: string;
  classes: string[];
  created_at: string;
}
interface TripRow {
  id: string;
  vehicle_id: string;
  odo: number;
  class: string;
  timestamp: string;
  created_at: string;
}
interface UserStateRow {
  user_id: string;
  vehicle_id: string | null;
  updated_at: string;
}

function toVehicle(r: VehicleRow): Vehicle {
  return { id: r.id, name: r.name, classes: r.classes, createdAt: new Date(r.created_at) };
}
function toTrip(r: TripRow): Trip {
  return {
    id: r.id,
    vehicleId: r.vehicle_id,
    odo: r.odo,
    class: r.class,
    timestamp: new Date(r.timestamp),
    createdAt: new Date(r.created_at),
  };
}
function toUserState(r: UserStateRow): UserState {
  return { userId: r.user_id, vehicleId: r.vehicle_id, updatedAt: new Date(r.updated_at) };
}

export async function getUserState(token: string, userId: string): Promise<UserState | undefined> {
  const rows = await dataApi<UserStateRow[]>(
    token,
    `/user_states?user_id=eq.${encodeURIComponent(userId)}`,
  );
  return rows[0] ? toUserState(rows[0]) : undefined;
}

export async function setCurrentVehicle(
  token: string,
  userId: string,
  vehicleId: string | null,
): Promise<void> {
  // PK(user_id) で upsert
  await dataApi(token, '/user_states?on_conflict=user_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: { user_id: userId, vehicle_id: vehicleId, updated_at: new Date().toISOString() },
  });
}

export async function listVehicles(token: string): Promise<Vehicle[]> {
  // RLS により、read 権限を持つ車両のみが返る。
  const rows = await dataApi<VehicleRow[]>(token, '/vehicles?order=name.asc');
  return rows.map(toVehicle);
}

export async function getVehicle(token: string, vehicleId: string): Promise<Vehicle | undefined> {
  const rows = await dataApi<VehicleRow[]>(token, `/vehicles?id=eq.${vehicleId}`);
  return rows[0] ? toVehicle(rows[0]) : undefined;
}

/**
 * 車両を新規作成し、作成者を read/write 権限で登録、現在の車両として選択する。
 * Data API はトランザクション不可のため vehicle → member → user_state の順に投入する。
 */
export async function createVehicle(
  token: string,
  userId: string,
  name: string,
  classes: string[],
): Promise<string> {
  const id = crypto.randomUUID();
  await dataApi(token, '/vehicles', {
    method: 'POST',
    prefer: 'return=minimal',
    body: { id, name, classes },
  });
  await dataApi(token, '/vehicle_members', {
    method: 'POST',
    prefer: 'return=minimal',
    body: { vehicle_id: id, user_id: userId, can_read: true, can_write: true },
  });
  await dataApi(token, '/user_states?on_conflict=user_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: { user_id: userId, vehicle_id: id, updated_at: new Date().toISOString() },
  });
  return id;
}

export async function updateVehicle(
  token: string,
  vehicleId: string,
  values: { name: string; classes: string[] },
): Promise<void> {
  await dataApi(token, `/vehicles?id=eq.${vehicleId}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: { name: values.name, classes: values.classes },
  });
}

/**
 * 車両を別ユーザーへ共有する（read/write 権限を付与）。旧 share に対応。
 */
export async function shareVehicle(
  token: string,
  vehicleId: string,
  otherUserId: string,
): Promise<void> {
  await dataApi(token, '/vehicle_members?on_conflict=vehicle_id,user_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: { vehicle_id: vehicleId, user_id: otherUserId, can_read: true, can_write: true },
  });
}

export async function listTrips(token: string, vehicleId: string): Promise<Trip[]> {
  const rows = await dataApi<TripRow[]>(
    token,
    `/trips?vehicle_id=eq.${vehicleId}&order=timestamp.asc`,
  );
  return rows.map(toTrip);
}

export async function createTrip(token: string, trip: NewTrip): Promise<void> {
  await dataApi(token, '/trips', {
    method: 'POST',
    prefer: 'return=minimal',
    body: {
      vehicle_id: trip.vehicleId,
      odo: trip.odo,
      class: trip.class,
      timestamp: trip.timestamp.toISOString(),
    },
  });
}

export async function deleteTrip(token: string, vehicleId: string, tripId: string): Promise<void> {
  await dataApi(token, `/trips?id=eq.${tripId}&vehicle_id=eq.${vehicleId}`, {
    method: 'DELETE',
    prefer: 'return=minimal',
  });
}
