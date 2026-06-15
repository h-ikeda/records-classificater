import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { trips, userStates, vehicleMembers, vehicles } from '../src/db/schema';
import { asUser, createTestDb, type TestDb } from './helpers/db';

// 旧 Firestore セキュリティルールと同等の保護が Neon RLS で効くことを pglite 上で検証する。
describe('Neon RLS policies', () => {
  let client: Awaited<ReturnType<typeof createTestDb>>['client'];
  let db: TestDb;
  const v1 = randomUUID();

  beforeAll(async () => {
    ({ client, db } = await createTestDb());
    // 所有者ロールで初期データ投入（RLS バイパス）。alice を所有者とする。
    await db
      .insert(vehicles)
      .values({ id: v1, ownerId: 'alice', name: 'V1', classes: ['Business', 'Private'] });
    await db.insert(vehicleMembers).values([
      { vehicleId: v1, userId: 'alice', canRead: true, canWrite: true },
      { vehicleId: v1, userId: 'bob', canRead: true, canWrite: false },
    ]);
    await db
      .insert(trips)
      .values({ vehicleId: v1, odo: 10, class: 'Business', timestamp: new Date('2024-01-01') });
  });

  afterAll(async () => {
    await client.close();
  });

  describe('vehicles', () => {
    test('a reader can see the vehicle', async () => {
      const rows = await asUser(client, 'alice', () => db.select().from(vehicles));
      expect(rows.map((r) => r.id)).toContain(v1);
    });
    test('a non-member cannot see the vehicle', async () => {
      const rows = await asUser(client, 'carol', () => db.select().from(vehicles));
      expect(rows).toHaveLength(0);
    });
    test('a writer can update, a reader cannot', async () => {
      await asUser(client, 'alice', () =>
        db.update(vehicles).set({ name: 'V1-renamed' }).where(eq(vehicles.id, v1)),
      );
      const updated = await db.select().from(vehicles).where(eq(vehicles.id, v1));
      expect(updated[0].name).toBe('V1-renamed');
      // read-only の bob が更新しても RLS で対象行に当たらず、変更されない
      await asUser(client, 'bob', () =>
        db.update(vehicles).set({ name: 'hacked' }).where(eq(vehicles.id, v1)),
      );
      const after = await db.select().from(vehicles).where(eq(vehicles.id, v1));
      expect(after[0].name).toBe('V1-renamed');
    });
  });

  describe('trips', () => {
    test('a reader can list trips, a non-member cannot', async () => {
      const aliceTrips = await asUser(client, 'alice', () =>
        db.select().from(trips).where(eq(trips.vehicleId, v1)),
      );
      expect(aliceTrips.length).toBeGreaterThan(0);
      const carolTrips = await asUser(client, 'carol', () =>
        db.select().from(trips).where(eq(trips.vehicleId, v1)),
      );
      expect(carolTrips).toHaveLength(0);
    });
    test('a writer can insert a trip with a valid class', async () => {
      await expect(
        asUser(client, 'alice', () =>
          db.insert(trips).values({ vehicleId: v1, odo: 20, class: 'Private', timestamp: new Date() }),
        ),
      ).resolves.toBeDefined();
    });
    test('inserting a trip with a class not in the vehicle is denied', async () => {
      await expect(
        asUser(client, 'alice', () =>
          db.insert(trips).values({ vehicleId: v1, odo: 30, class: 'Unknown', timestamp: new Date() }),
        ),
      ).rejects.toThrow();
    });
    test('a read-only user cannot insert a trip', async () => {
      await expect(
        asUser(client, 'bob', () =>
          db.insert(trips).values({ vehicleId: v1, odo: 40, class: 'Business', timestamp: new Date() }),
        ),
      ).rejects.toThrow();
    });
    test('a non-member cannot insert a trip', async () => {
      await expect(
        asUser(client, 'carol', () =>
          db.insert(trips).values({ vehicleId: v1, odo: 50, class: 'Business', timestamp: new Date() }),
        ),
      ).rejects.toThrow();
    });
  });

  describe('vehicle_members (sharing)', () => {
    test('the owner can share to another user', async () => {
      await expect(
        asUser(client, 'alice', () =>
          db
            .insert(vehicleMembers)
            .values({ vehicleId: v1, userId: 'dave', canRead: true, canWrite: true }),
        ),
      ).resolves.toBeDefined();
    });
    test('a read-only user cannot share', async () => {
      await expect(
        asUser(client, 'bob', () =>
          db
            .insert(vehicleMembers)
            .values({ vehicleId: v1, userId: 'mallory', canRead: true, canWrite: true }),
        ),
      ).rejects.toThrow();
    });
    test('a non-owner cannot grant themselves access (no self-insert escalation)', async () => {
      // 旧ポリシーでは user_id = self の自己登録を許していたため、車両 id を知る攻撃者が
      // 自分に read を付与できた。所有者限定にしたことで拒否されることを確認する。
      await expect(
        asUser(client, 'mallory', () =>
          db
            .insert(vehicleMembers)
            .values({ vehicleId: v1, userId: 'mallory', canRead: true, canWrite: false }),
        ),
      ).rejects.toThrow();
      const seen = await asUser(client, 'mallory', () => db.select().from(vehicles));
      expect(seen).toHaveLength(0);
    });
    test('a user only sees their own membership row', async () => {
      const bobRows = await asUser(client, 'bob', () => db.select().from(vehicleMembers));
      expect(bobRows.every((r) => r.userId === 'bob')).toBe(true);
    });
  });

  describe('trips update validation', () => {
    test('updating a trip to a class not in the vehicle is denied', async () => {
      const [trip] = await asUser(client, 'alice', () =>
        db.select().from(trips).where(eq(trips.vehicleId, v1)).limit(1),
      );
      await expect(
        asUser(client, 'alice', () =>
          db.update(trips).set({ class: 'Unknown' }).where(eq(trips.id, trip.id)),
        ),
      ).rejects.toThrow();
    });
    test('updating a trip to a valid class is allowed', async () => {
      const [trip] = await asUser(client, 'alice', () =>
        db.select().from(trips).where(eq(trips.vehicleId, v1)).limit(1),
      );
      await expect(
        asUser(client, 'alice', () =>
          db.update(trips).set({ class: 'Private' }).where(eq(trips.id, trip.id)),
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('create_vehicle RPC', () => {
    test('atomically creates the vehicle, owner membership and current state', async () => {
      const rows = await asUser(client, 'erin', () =>
        client.query<{ create_vehicle: string }>(
          "SELECT create_vehicle('My Car', ARRAY['Business','Private']) AS create_vehicle",
        ),
      );
      const newId = rows.rows[0].create_vehicle;
      expect(newId).toBeTruthy();
      // erin は所有者として車両・メンバー・現在車両が揃っている
      const [veh] = await db.select().from(vehicles).where(eq(vehicles.id, newId));
      expect(veh.ownerId).toBe('erin');
      const members = await db.select().from(vehicleMembers).where(eq(vehicleMembers.vehicleId, newId));
      expect(members).toEqual([
        expect.objectContaining({ userId: 'erin', canRead: true, canWrite: true }),
      ]);
      const [state] = await db.select().from(userStates).where(eq(userStates.userId, 'erin'));
      expect(state.vehicleId).toBe(newId);
    });
  });

  describe('delete_my_account_data RPC', () => {
    test('removes the user owned vehicles, memberships and state', async () => {
      // frank が車両を作成 → 自身のデータが揃う
      const created = await asUser(client, 'frank', () =>
        client.query<{ create_vehicle: string }>(
          "SELECT create_vehicle('Frank Car', ARRAY['Business']) AS create_vehicle",
        ),
      );
      const frankVehicle = created.rows[0].create_vehicle;
      await asUser(client, 'frank', () => client.query('SELECT delete_my_account_data()'));
      const veh = await db.select().from(vehicles).where(eq(vehicles.id, frankVehicle));
      expect(veh).toHaveLength(0);
      const members = await db
        .select()
        .from(vehicleMembers)
        .where(eq(vehicleMembers.userId, 'frank'));
      expect(members).toHaveLength(0);
      const state = await db.select().from(userStates).where(eq(userStates.userId, 'frank'));
      expect(state).toHaveLength(0);
    });
  });

  describe('user_states', () => {
    test('a user can write their own state', async () => {
      await expect(
        asUser(client, 'alice', () =>
          db.insert(userStates).values({ userId: 'alice', vehicleId: v1 }),
        ),
      ).resolves.toBeDefined();
      const rows = await asUser(client, 'alice', () => db.select().from(userStates));
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe('alice');
    });
    test('a user cannot write another user\'s state', async () => {
      await expect(
        asUser(client, 'alice', () =>
          db.insert(userStates).values({ userId: 'bob', vehicleId: v1 }),
        ),
      ).rejects.toThrow();
    });
  });
});
