// Reusable Firestore -> Prisma Postgres migration.
//
// This module contains the pure migration logic so it can be driven both by the
// CLI (scripts/migrate-firestore.ts) and by the integration test
// (test/migrate-firestore.spec.ts) against the Firestore emulator.
//
// Firestore source layout (see the previous Firebase implementation):
//   users/{uid}                     -> { state: { vehicle: vid } }
//   vehicles/{vid}                  -> { name, classes[], permissions:{read[],write[]} }
//   vehicles/{vid}/trips/{tid}      -> { odo, class, timestamp(Timestamp) }
//   trips/{uid} (legacy)            -> { data: [ { odo, class, timestamp } ] }
//
// Target layout: see prisma/schema.prisma.

import type { Firestore } from 'firebase-admin/firestore';
import type { PrismaClient } from '@prisma/client';

export interface MigrationOptions {
  // Firebase Auth UID -> Clerk user id. Unmapped uids are kept as-is so a test
  // (or an identity migration) works without a map.
  uidMap?: Record<string, string>;
  // Convert legacy `trips/{uid}` documents into a per-user vehicle, mirroring
  // the auto-migration the app used to perform on first login. Default: true.
  migrateLegacyTrips?: boolean;
  // Name given to vehicles synthesised from legacy trips.
  legacyVehicleName?: string;
}

export interface MigrationResult {
  users: number;
  vehicles: number;
  members: number;
  trips: number;
  legacyVehicles: number;
}

interface LegacyTrip {
  odo: number;
  class: string;
  timestamp: { toDate(): Date };
}

function toDate(value: unknown): Date {
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate(): Date }).toDate();
  }
  return new Date(value as string | number | Date);
}

export async function migrateFirestoreToPrisma(
  firestore: Firestore,
  prisma: PrismaClient,
  options: MigrationOptions = {},
): Promise<MigrationResult> {
  const uidMap = options.uidMap ?? {};
  const migrateLegacy = options.migrateLegacyTrips ?? true;
  const legacyVehicleName = options.legacyVehicleName ?? '(migrated)';
  const mapUid = (uid: string) => uidMap[uid] ?? uid;

  const result: MigrationResult = { users: 0, vehicles: 0, members: 0, trips: 0, legacyVehicles: 0 };

  // 1. Vehicles + members + trips ----------------------------------------
  const vehiclesSnap = await firestore.collection('vehicles').get();
  for (const vehicleDoc of vehiclesSnap.docs) {
    const data = vehicleDoc.data() as {
      name?: string;
      classes?: string[];
      permissions?: { read?: string[]; write?: string[] };
    };
    const classes = Array.isArray(data.classes) ? data.classes : [];

    await prisma.vehicle.upsert({
      where: { id: vehicleDoc.id },
      create: { id: vehicleDoc.id, name: data.name ?? '', classes },
      update: { name: data.name ?? '', classes },
    });
    result.vehicles += 1;

    // Merge read/write permission arrays into membership rows.
    const read = new Set((data.permissions?.read ?? []).map(mapUid));
    const write = new Set((data.permissions?.write ?? []).map(mapUid));
    for (const userId of new Set([...read, ...write])) {
      await prisma.vehicleMember.upsert({
        where: { vehicleId_userId: { vehicleId: vehicleDoc.id, userId } },
        create: { vehicleId: vehicleDoc.id, userId, canRead: read.has(userId), canWrite: write.has(userId) },
        update: { canRead: read.has(userId), canWrite: write.has(userId) },
      });
      result.members += 1;
    }

    const tripsSnap = await vehicleDoc.ref.collection('trips').get();
    for (const tripDoc of tripsSnap.docs) {
      const trip = tripDoc.data() as { odo?: number; class?: string; timestamp?: unknown };
      await prisma.trip.upsert({
        where: { id: tripDoc.id },
        create: {
          id: tripDoc.id,
          vehicleId: vehicleDoc.id,
          odo: Number(trip.odo ?? 0),
          class: trip.class ?? '',
          timestamp: toDate(trip.timestamp),
        },
        update: {
          odo: Number(trip.odo ?? 0),
          class: trip.class ?? '',
          timestamp: toDate(trip.timestamp),
        },
      });
      result.trips += 1;
    }
  }

  // 2. Users (current vehicle selection) ---------------------------------
  const usersSnap = await firestore.collection('users').get();
  const migratedUserUids = new Set<string>();
  for (const userDoc of usersSnap.docs) {
    const mappedId = mapUid(userDoc.id);
    migratedUserUids.add(userDoc.id);
    const data = userDoc.data() as { state?: { vehicle?: string } };
    const currentVehicleId = data.state?.vehicle ?? null;
    // Only keep the selection if the vehicle actually migrated.
    const vehicleExists = currentVehicleId
      ? (await prisma.vehicle.findUnique({ where: { id: currentVehicleId } })) !== null
      : false;
    await prisma.user.upsert({
      where: { id: mappedId },
      create: { id: mappedId, currentVehicleId: vehicleExists ? currentVehicleId : null },
      update: { currentVehicleId: vehicleExists ? currentVehicleId : null },
    });
    result.users += 1;
  }

  // 3. Legacy trips/{uid} -> synthesised vehicle -------------------------
  if (migrateLegacy) {
    const legacySnap = await firestore.collection('trips').get();
    for (const legacyDoc of legacySnap.docs) {
      const uid = legacyDoc.id;
      // Skip users who already have a proper user doc (already on the new model).
      if (migratedUserUids.has(uid)) continue;
      const data = legacyDoc.data() as { data?: LegacyTrip[] };
      const legacyTrips = Array.isArray(data.data) ? data.data : [];
      if (!legacyTrips.length) continue;

      const mappedId = mapUid(uid);
      const classes = Array.from(new Set(legacyTrips.map((t) => t.class)));
      const vehicle = await prisma.vehicle.create({
        data: {
          name: legacyVehicleName,
          classes,
          members: { create: [{ userId: mappedId, canRead: true, canWrite: true }] },
          trips: {
            create: legacyTrips.map((t) => ({
              odo: Number(t.odo ?? 0),
              class: t.class ?? '',
              timestamp: toDate(t.timestamp),
            })),
          },
        },
      });
      result.legacyVehicles += 1;
      result.vehicles += 1;
      result.members += 1;
      result.trips += legacyTrips.length;

      await prisma.user.upsert({
        where: { id: mappedId },
        create: { id: mappedId, currentVehicleId: vehicle.id },
        update: { currentVehicleId: vehicle.id },
      });
      result.users += 1;
    }
  }

  return result;
}
