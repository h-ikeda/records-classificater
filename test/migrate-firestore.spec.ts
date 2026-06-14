// Integration test for the Firestore -> Prisma Postgres migration.
//
// Requirements (provided by `npm test`, see package.json + CI):
//   - Firestore emulator running (FIRESTORE_EMULATOR_HOST set by emulators:exec).
//   - A reachable Postgres in DATABASE_URL. The test provisions an isolated
//     `migration_test` schema, runs `prisma db push`, then verifies the result.

import { execSync } from 'node:child_process';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { App } from 'firebase-admin/app';
import type { Firestore } from 'firebase-admin/firestore';
import { migrateFirestoreToPrisma } from '../scripts/firestore-migration';

const SCHEMA = 'migration_test';
const PROJECT_ID = 'demo-records-classificater';

function withSchema(url: string, schema: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('schema', schema);
  return parsed.toString();
}

const baseUrl = process.env.DATABASE_URL;
const url = baseUrl ? withSchema(baseUrl, SCHEMA) : '';

// Fixed ids so we can assert precisely.
const U1 = 'firebase_owner';
const U2 = 'firebase_reader';
const U3 = 'firebase_legacy';
const V1 = 'vehicleOne';

describe('Firestore -> Prisma migration', () => {
  let prisma: PrismaClient;
  let app: App;
  let firestore: Firestore;

  beforeAll(async () => {
    if (!baseUrl) throw new Error('DATABASE_URL must be set to run the migration test');
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error('FIRESTORE_EMULATOR_HOST must be set (run via `npm test`)');
    }

    // Provision an isolated schema and sync the Prisma models into it.
    const client = new Client({ connectionString: baseUrl });
    await client.connect();
    await client.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await client.query(`CREATE SCHEMA "${SCHEMA}"`);
    await client.end();
    execSync('npx prisma db push --skip-generate --accept-data-loss', {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: url },
    });

    prisma = new PrismaClient({ datasources: { db: { url } } });
    app = initializeApp({ projectId: PROJECT_ID }, 'migration-test');
    firestore = getFirestore(app);

    // --- seed Firestore in the OLD layout -------------------------------
    await firestore.collection('vehicles').doc(V1).set({
      name: 'カローラ',
      classes: ['Business', 'Private'],
      permissions: { read: [U1, U2], write: [U1] },
    });
    await firestore.collection('vehicles').doc(V1).collection('trips').doc('t1').set({
      odo: 100,
      class: 'Business',
      timestamp: Timestamp.fromDate(new Date('2026-01-01T10:00:00Z')),
    });
    await firestore.collection('vehicles').doc(V1).collection('trips').doc('t2').set({
      odo: 250,
      class: 'Private',
      timestamp: Timestamp.fromDate(new Date('2026-02-01T10:00:00Z')),
    });
    await firestore.collection('users').doc(U1).set({ state: { vehicle: V1 } });

    // Legacy pre-vehicle trips for a user without a user doc.
    await firestore.collection('trips').doc(U3).set({
      data: [
        { odo: 10, class: 'Old', timestamp: Timestamp.fromDate(new Date('2025-01-01T00:00:00Z')) },
        { odo: 20, class: 'New', timestamp: Timestamp.fromDate(new Date('2025-02-01T00:00:00Z')) },
      ],
    });
  }, 180000);

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
    if (app) await deleteApp(app);
  });

  test('migrates vehicles, members, trips, users and legacy trips', async () => {
    const result = await migrateFirestoreToPrisma(firestore, prisma);

    // Vehicle + classes preserved.
    const vehicle = await prisma.vehicle.findUnique({ where: { id: V1 } });
    expect(vehicle).not.toBeNull();
    expect(vehicle!.classes).toEqual(['Business', 'Private']);

    // Permissions arrays -> membership rows.
    const owner = await prisma.vehicleMember.findUnique({
      where: { vehicleId_userId: { vehicleId: V1, userId: U1 } },
    });
    expect(owner).toMatchObject({ canRead: true, canWrite: true });
    const reader = await prisma.vehicleMember.findUnique({
      where: { vehicleId_userId: { vehicleId: V1, userId: U2 } },
    });
    expect(reader).toMatchObject({ canRead: true, canWrite: false });

    // Trips migrated with timestamps intact.
    const trips = await prisma.trip.findMany({ where: { vehicleId: V1 }, orderBy: { timestamp: 'asc' } });
    expect(trips.map((t) => t.odo)).toEqual([100, 250]);
    expect(trips[0].timestamp.toISOString()).toBe('2026-01-01T10:00:00.000Z');

    // User selection preserved.
    const user = await prisma.user.findUnique({ where: { id: U1 } });
    expect(user!.currentVehicleId).toBe(V1);

    // Legacy trips converted into a synthesised vehicle owned by U3.
    const legacyUser = await prisma.user.findUnique({ where: { id: U3 } });
    expect(legacyUser).not.toBeNull();
    expect(legacyUser!.currentVehicleId).not.toBeNull();
    const legacyVehicle = await prisma.vehicle.findUnique({
      where: { id: legacyUser!.currentVehicleId! },
      include: { trips: true, members: true },
    });
    expect(legacyVehicle!.classes.sort()).toEqual(['New', 'Old']);
    expect(legacyVehicle!.trips).toHaveLength(2);
    expect(legacyVehicle!.members[0]).toMatchObject({ userId: U3, canRead: true, canWrite: true });

    expect(result.legacyVehicles).toBe(1);
  }, 180000);

  test('is idempotent when run twice', async () => {
    await migrateFirestoreToPrisma(firestore, prisma, { migrateLegacyTrips: false });
    // Re-running the non-legacy migration must not duplicate trips.
    const trips = await prisma.trip.findMany({ where: { vehicleId: V1 } });
    expect(trips).toHaveLength(2);
  }, 180000);
});
