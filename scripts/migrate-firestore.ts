// CLI entry point for migrating Firestore data into Prisma Postgres.
//
// Connection:
//   - Firestore: set GOOGLE_APPLICATION_CREDENTIALS (service account) for a real
//     project, or FIRESTORE_EMULATOR_HOST + FIREBASE_PROJECT_ID for the emulator.
//   - Postgres:  DATABASE_URL (the schema is taken from DATABASE_SCHEMA / env,
//     see src/lib/schema-name.mjs).
//
// User id mapping (Firebase UID -> Clerk user id) is read from the JSON file at
// UID_MAP_FILE if provided; otherwise uids are migrated unchanged.
//
// Usage: npm run migrate:firestore

import { readFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { PrismaClient } from '@prisma/client';
import { resolveDatabaseUrl } from '../src/lib/schema-name.mjs';
import { migrateFirestoreToPrisma } from './firestore-migration';

function loadUidMap(): Record<string, string> {
  const file = process.env.UID_MAP_FILE;
  if (!file) return {};
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
}

async function main() {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'records-classificater';

  // With FIRESTORE_EMULATOR_HOST set, the Admin SDK talks to the emulator and
  // credentials are not required.
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIRESTORE_EMULATOR_HOST) {
    const credentials = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
    initializeApp({ credential: cert(credentials), projectId });
  } else {
    initializeApp({ projectId });
  }

  const firestore = getFirestore();
  const prisma = new PrismaClient({ datasources: { db: { url: resolveDatabaseUrl() } } });

  try {
    const result = await migrateFirestoreToPrisma(firestore, prisma, { uidMap: loadUidMap() });
    console.log('Migration complete:', result);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
