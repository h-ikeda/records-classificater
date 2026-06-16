import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { migrate } from '../src/migration/firestore';
import * as schema from '../src/db/schema';

/**
 * Firestore 本番データを Neon (Postgres) へ移行する実行スクリプト。
 *
 * 必要な環境変数:
 *   DATABASE_URL                 - Neon の所有者接続文字列（RLS バイパス）
 *   GOOGLE_APPLICATION_CREDENTIALS か FIREBASE_SERVICE_ACCOUNT(JSON文字列)
 *   FIRESTORE_EMULATOR_HOST      - エミュレータに対して実行する場合のみ
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  if (process.env.FIRESTORE_EMULATOR_HOST) {
    // エミュレータでは認証情報なしで projectId だけ指定すれば接続できる。
    initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'demo-records-classificater' });
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  } else {
    // GOOGLE_APPLICATION_CREDENTIALS を利用
    initializeApp();
  }

  const firestore = getFirestore();
  const db = drizzle(neon(url), { schema });

  console.log('Migrating Firestore data into Neon...');
  const rows = await migrate(firestore, db);
  console.log(
    `Done. vehicles=${rows.vehicles.length} members=${rows.members.length} ` +
      `trips=${rows.trips.length} userStates=${rows.userStates.length}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
