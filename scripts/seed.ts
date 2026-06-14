import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { trips, userStates, vehicleMembers, vehicles } from '../src/db/schema';
import { sampleData } from '../src/db/seed-data';

// プレビュー DB（PR ごとに分岐した Neon ブランチ）やローカル開発用のシード投入。
// 所有者権限の接続文字列（RLS をバイパスできる）を使う。
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  // シードする所有者の Clerk ユーザー ID。プレビューのテストユーザーに合わせる。
  const userId = process.env.SEED_USER_ID ?? 'user_seed_demo';

  const db = drizzle(neon(url));
  const { vehicle, member, trips: tripRows } = sampleData(userId);

  console.log(`Seeding sample data for user "${userId}"...`);
  await db.insert(vehicles).values(vehicle).onConflictDoNothing();
  await db.insert(vehicleMembers).values(member).onConflictDoNothing();
  await db.insert(trips).values(tripRows.map((t) => ({ ...t, vehicleId: vehicle.id })));
  await db
    .insert(userStates)
    .values({ userId, vehicleId: vehicle.id })
    .onConflictDoUpdate({ target: userStates.userId, set: { vehicleId: vehicle.id } });

  console.log('Seed complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
