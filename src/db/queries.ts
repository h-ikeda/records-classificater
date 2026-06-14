import { and, asc, eq } from 'drizzle-orm';
import { authed } from './client';
import { trips, userStates, vehicleMembers, vehicles } from './schema';
import type { NewTrip, Trip, UserState, Vehicle } from './schema';

// すべてのクエリは Clerk の JWT（token）を付与して実行し、Neon RLS で保護する。
// 旧 Firestore の onSnapshot（リアルタイム購読）は、取得 + 変更後の再取得に置き換えた。

export async function getUserState(token: string, userId: string): Promise<UserState | undefined> {
  const rows = await authed(token)
    .select()
    .from(userStates)
    .where(eq(userStates.userId, userId));
  return rows[0];
}

export async function setCurrentVehicle(
  token: string,
  userId: string,
  vehicleId: string | null,
): Promise<void> {
  await authed(token)
    .insert(userStates)
    .values({ userId, vehicleId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userStates.userId,
      set: { vehicleId, updatedAt: new Date() },
    });
}

export async function listVehicles(token: string): Promise<Vehicle[]> {
  // RLS により、read 権限を持つ車両のみが返る。
  return authed(token).select().from(vehicles).orderBy(asc(vehicles.name));
}

export async function getVehicle(token: string, vehicleId: string): Promise<Vehicle | undefined> {
  const rows = await authed(token).select().from(vehicles).where(eq(vehicles.id, vehicleId));
  return rows[0];
}

/**
 * 車両を新規作成し、作成者を read/write 権限で登録、現在の車両として選択する。
 * vehicle → member → user_state の順に投入する（RLS の前提順序を満たす）。
 */
export async function createVehicle(
  token: string,
  userId: string,
  name: string,
  classes: string[],
): Promise<string> {
  const id = crypto.randomUUID();
  const client = authed(token);
  await client.insert(vehicles).values({ id, name, classes });
  await client.insert(vehicleMembers).values({ vehicleId: id, userId, canRead: true, canWrite: true });
  await client
    .insert(userStates)
    .values({ userId, vehicleId: id, updatedAt: new Date() })
    .onConflictDoUpdate({ target: userStates.userId, set: { vehicleId: id, updatedAt: new Date() } });
  return id;
}

export async function updateVehicle(
  token: string,
  vehicleId: string,
  values: { name: string; classes: string[] },
): Promise<void> {
  await authed(token).update(vehicles).set(values).where(eq(vehicles.id, vehicleId));
}

/**
 * 車両を別ユーザーへ共有する（read/write 権限を付与）。旧 share に対応。
 */
export async function shareVehicle(
  token: string,
  vehicleId: string,
  otherUserId: string,
): Promise<void> {
  await authed(token)
    .insert(vehicleMembers)
    .values({ vehicleId, userId: otherUserId, canRead: true, canWrite: true })
    .onConflictDoUpdate({
      target: [vehicleMembers.vehicleId, vehicleMembers.userId],
      set: { canRead: true, canWrite: true },
    });
}

export async function listTrips(token: string, vehicleId: string): Promise<Trip[]> {
  return authed(token)
    .select()
    .from(trips)
    .where(eq(trips.vehicleId, vehicleId))
    .orderBy(asc(trips.timestamp));
}

export async function createTrip(
  token: string,
  trip: NewTrip,
): Promise<void> {
  await authed(token).insert(trips).values(trip);
}

export async function deleteTrip(token: string, vehicleId: string, tripId: string): Promise<void> {
  await authed(token).delete(trips).where(and(eq(trips.id, tripId), eq(trips.vehicleId, vehicleId)));
}
