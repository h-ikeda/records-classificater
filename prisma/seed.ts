// Seed data for local development and testing.
//
// Run with: npm run db:seed
// The Clerk user ids below are placeholders; replace TEST_USER_ID via env to
// match a real Clerk dev user so the seeded data shows up when you sign in.

import { PrismaClient } from '@prisma/client';
import { resolveDatabaseUrl } from '../src/lib/schema-name.mjs';

const prisma = new PrismaClient({ datasources: { db: { url: resolveDatabaseUrl() } } });

const USER = process.env.TEST_USER_ID ?? 'user_test_owner';
const FRIEND = process.env.TEST_FRIEND_ID ?? 'user_test_friend';

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 3600 * 1000);
}

async function main() {
  // Clean slate so the seed is idempotent.
  await prisma.trip.deleteMany();
  await prisma.vehicleMember.deleteMany();
  await prisma.user.updateMany({ data: { currentVehicleId: null } });
  await prisma.vehicle.deleteMany();
  await prisma.user.deleteMany();

  // A vehicle owned by USER and shared (read+write) with FRIEND.
  const corolla = await prisma.vehicle.create({
    data: {
      name: 'カローラ',
      classes: ['Business', 'Private'],
      members: {
        create: [
          { userId: USER, canRead: true, canWrite: true },
          { userId: FRIEND, canRead: true, canWrite: true },
        ],
      },
      trips: {
        create: [
          { odo: 140, class: 'Private', timestamp: daysAgo(60) },
          { odo: 199, class: 'Business', timestamp: daysAgo(50) },
          { odo: 323, class: 'Business', timestamp: daysAgo(20) },
          { odo: 342, class: 'Private', timestamp: daysAgo(14) },
          { odo: 369, class: 'Private', timestamp: daysAgo(6) },
          { odo: 369.9, class: 'Business', timestamp: daysAgo(2) },
          { odo: 370, class: 'Private', timestamp: daysAgo(0) },
        ],
      },
    },
  });

  // A second vehicle owned only by USER.
  await prisma.vehicle.create({
    data: {
      name: 'ランサー',
      classes: ['Commute', 'Leisure'],
      members: { create: [{ userId: USER, canRead: true, canWrite: true }] },
      trips: {
        create: [
          { odo: 1000, class: 'Commute', timestamp: daysAgo(30) },
          { odo: 1120, class: 'Leisure', timestamp: daysAgo(10) },
        ],
      },
    },
  });

  await prisma.user.create({ data: { id: USER, currentVehicleId: corolla.id } });
  await prisma.user.create({ data: { id: FRIEND, currentVehicleId: corolla.id } });

  console.log(`Seeded vehicles for ${USER} (and shared with ${FRIEND}).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
