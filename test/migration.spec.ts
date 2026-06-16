import { eq } from 'drizzle-orm';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { buildRows, migrate, type FirestoreSnapshot } from '../src/migration/firestore';
import { trips, userStates, vehicleMembers, vehicles } from '../src/db/schema';
import { createTestDb, type TestDb } from './helpers/db';

describe('buildRows (pure transform)', () => {
  test('maps vehicles, permissions, trips and user states', () => {
    const snapshot: FirestoreSnapshot = {
      vehicles: [
        {
          id: 'veh1',
          name: 'カローラ',
          classes: ['Business', 'Private'],
          permissions: { read: ['alice', 'bob'], write: ['alice'] },
          trips: [{ odo: 2.3, class: 'Business', timestamp: new Date('2024-01-01T00:00:00Z') }],
        },
      ],
      users: [{ id: 'alice', vehicle: 'veh1' }],
      legacyTrips: [],
    };
    const rows = buildRows(snapshot);
    expect(rows.vehicles).toHaveLength(1);
    expect(rows.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: 'alice', canRead: true, canWrite: true }),
        expect.objectContaining({ userId: 'bob', canRead: true, canWrite: false }),
      ]),
    );
    expect(rows.trips).toHaveLength(1);
    // user_states は新しく採番した uuid を指す
    expect(rows.userStates[0]).toMatchObject({ userId: 'alice' });
    expect(rows.userStates[0].vehicleId).toBe(rows.vehicles[0].id);
  });

  test('converts legacy trips/{uid} into a vehicle only for un-migrated users', () => {
    const snapshot: FirestoreSnapshot = {
      vehicles: [],
      users: [{ id: 'migrated', vehicle: null }],
      legacyTrips: [
        { uid: 'migrated', data: [{ odo: 1, class: 'A', timestamp: new Date() }] },
        {
          uid: 'legacy',
          data: [
            { odo: 10, class: 'A', timestamp: new Date('2023-01-01') },
            { odo: 20, class: 'B', timestamp: new Date('2023-02-01') },
          ],
        },
      ],
    };
    const rows = buildRows(snapshot);
    // 'migrated' は users ドキュメントがあるのでスキップ、'legacy' のみ変換
    expect(rows.vehicles).toHaveLength(1);
    expect(rows.vehicles[0].classes).toEqual(['A', 'B']);
    expect(rows.trips).toHaveLength(2);
    expect(rows.members[0]).toMatchObject({ userId: 'legacy', canRead: true, canWrite: true });
  });
});

describe('Firestore emulator -> Neon migration', () => {
  let app: App;
  let firestore: Firestore;
  let client: Awaited<ReturnType<typeof createTestDb>>['client'];
  let db: TestDb;

  const uidOwner = 'user_owner';
  const uidReader = 'user_reader';
  const uidLegacy = 'user_legacy';

  beforeAll(async () => {
    app = initializeApp({ projectId: 'demo-records-classificater' });
    firestore = getFirestore();

    // 新形式の車両 + 走行記録 + ユーザー状態を投入
    const vehicleRef = firestore.collection('vehicles').doc();
    await vehicleRef.set({
      name: 'カローラ',
      classes: ['Business', 'Private'],
      permissions: { read: [uidOwner, uidReader], write: [uidOwner] },
    });
    await vehicleRef.collection('trips').add({
      odo: 2.3,
      class: 'Business',
      timestamp: Timestamp.fromDate(new Date('2024-01-01T00:00:00Z')),
    });
    await firestore.collection('users').doc(uidOwner).set({ state: { vehicle: vehicleRef.id } });

    // 旧形式（trips/{uid}）の未移行ユーザー
    await firestore.collection('trips').doc(uidLegacy).set({
      data: [
        { odo: 100, class: '私用', timestamp: Timestamp.fromDate(new Date('2023-01-01T00:00:00Z')) },
        { odo: 150, class: '業務', timestamp: Timestamp.fromDate(new Date('2023-03-01T00:00:00Z')) },
      ],
    });

    ({ client, db } = await createTestDb());
  });

  afterAll(async () => {
    await client.close();
    await deleteApp(app);
  });

  test('migrates all collections into Postgres', async () => {
    const result = await migrate(firestore, db);
    expect(result.vehicles).toHaveLength(2); // カローラ + 移行された車両

    const allVehicles = await db.select().from(vehicles);
    const corolla = allVehicles.find((v) => v.name === 'カローラ')!;
    const migrated = allVehicles.find((v) => v.name === '(移行された車両)')!;
    expect(corolla).toBeDefined();
    expect(corolla.classes).toEqual(['Business', 'Private']);
    expect(migrated).toBeDefined();
    expect(new Set(migrated.classes)).toEqual(new Set(['私用', '業務']));

    const corollaMembers = await db
      .select()
      .from(vehicleMembers)
      .where(eq(vehicleMembers.vehicleId, corolla.id));
    expect(corollaMembers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: uidOwner, canRead: true, canWrite: true }),
        expect.objectContaining({ userId: uidReader, canRead: true, canWrite: false }),
      ]),
    );

    const corollaTrips = await db.select().from(trips).where(eq(trips.vehicleId, corolla.id));
    expect(corollaTrips).toHaveLength(1);
    expect(corollaTrips[0].odo).toBeCloseTo(2.3);

    const migratedTrips = await db.select().from(trips).where(eq(trips.vehicleId, migrated.id));
    expect(migratedTrips).toHaveLength(2);

    const states = await db.select().from(userStates);
    const ownerState = states.find((s) => s.userId === uidOwner)!;
    const legacyState = states.find((s) => s.userId === uidLegacy)!;
    expect(ownerState.vehicleId).toBe(corolla.id);
    expect(legacyState.vehicleId).toBe(migrated.id);
  });
});
