import type { Prisma, Trip, Vehicle, VehicleMember } from '@prisma/client';
import { prisma } from './prisma';
import type { MeDTO, SnapshotDTO, TripDTO, TripInput, VehicleDTO } from './types';

type VehicleWithMembers = Vehicle & { members: VehicleMember[] };

export class PermissionError extends Error {}
export class ValidationError extends Error {}
export class NotFoundError extends Error {}

// --- serialization -------------------------------------------------------

export function toVehicleDTO(vehicle: VehicleWithMembers): VehicleDTO {
  return {
    id: vehicle.id,
    name: vehicle.name,
    classes: vehicle.classes,
    permissions: {
      read: vehicle.members.filter((m) => m.canRead).map((m) => m.userId),
      write: vehicle.members.filter((m) => m.canWrite).map((m) => m.userId),
    },
  };
}

export function toTripDTO(trip: Trip): TripDTO {
  return {
    id: trip.id,
    odo: trip.odo,
    class: trip.class,
    timestamp: trip.timestamp.toISOString(),
  };
}

// --- users ---------------------------------------------------------------

// Make sure a User row exists for the signed-in Clerk user.
export async function ensureUser(userId: string): Promise<MeDTO> {
  const user = await prisma.user.upsert({
    where: { id: userId },
    create: { id: userId },
    update: {},
  });
  return { id: user.id, currentVehicleId: user.currentVehicleId };
}

export async function setCurrentVehicle(userId: string, vehicleId: string): Promise<void> {
  // Only allow selecting a vehicle the user can read.
  await assertReadable(userId, vehicleId);
  await prisma.user.update({
    where: { id: userId },
    data: { currentVehicleId: vehicleId },
  });
}

// --- vehicles ------------------------------------------------------------

export async function listVehicles(userId: string): Promise<VehicleDTO[]> {
  const vehicles = await prisma.vehicle.findMany({
    where: { members: { some: { userId, canRead: true } } },
    include: { members: true },
    orderBy: { createdAt: 'asc' },
  });
  return vehicles.map(toVehicleDTO);
}

export async function createVehicle(
  userId: string,
  input: { name: string; classes: string[] },
): Promise<VehicleDTO> {
  const name = input.name?.trim() ?? '';
  const classes = normalizeClasses(input.classes ?? []);
  const vehicle = await prisma.vehicle.create({
    data: {
      name,
      classes,
      members: { create: [{ userId, canRead: true, canWrite: true }] },
    },
    include: { members: true },
  });
  // If the user has no current vehicle yet, select this one.
  await prisma.user.update({
    where: { id: userId },
    data: { currentVehicleId: vehicle.id },
  }).catch(() => undefined);
  return toVehicleDTO(vehicle);
}

export async function getReadableVehicle(userId: string, vehicleId: string): Promise<VehicleDTO> {
  const vehicle = await loadVehicle(vehicleId);
  if (!member(vehicle, userId)?.canRead) throw new PermissionError('not readable');
  return toVehicleDTO(vehicle);
}

export async function updateVehicle(
  userId: string,
  vehicleId: string,
  input: { name?: string; classes?: string[] },
): Promise<VehicleDTO> {
  await assertWritable(userId, vehicleId);
  const data: Prisma.VehicleUpdateInput = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new ValidationError('name is required');
    data.name = name;
  }
  if (input.classes !== undefined) {
    data.classes = normalizeClasses(input.classes);
  }
  const vehicle = await prisma.vehicle.update({
    where: { id: vehicleId },
    data,
    include: { members: true },
  });
  return toVehicleDTO(vehicle);
}

// Share a vehicle with another user (grants read + write), mirroring the old
// arrayUnion behaviour.
export async function shareVehicle(
  userId: string,
  vehicleId: string,
  targetUserId: string,
): Promise<VehicleDTO> {
  await assertWritable(userId, vehicleId);
  const trimmed = targetUserId.trim();
  if (!trimmed) throw new ValidationError('target user id is required');
  await prisma.vehicleMember.upsert({
    where: { vehicleId_userId: { vehicleId, userId: trimmed } },
    create: { vehicleId, userId: trimmed, canRead: true, canWrite: true },
    update: { canRead: true, canWrite: true },
  });
  return toVehicleDTO(await loadVehicle(vehicleId));
}

// --- trips ---------------------------------------------------------------

export async function listTrips(userId: string, vehicleId: string): Promise<TripDTO[]> {
  await assertReadable(userId, vehicleId);
  const trips = await prisma.trip.findMany({
    where: { vehicleId },
    orderBy: { timestamp: 'asc' },
  });
  return trips.map(toTripDTO);
}

export async function createTrip(
  userId: string,
  vehicleId: string,
  input: TripInput,
): Promise<TripDTO> {
  const vehicle = await loadVehicle(vehicleId);
  if (!member(vehicle, userId)?.canWrite) throw new PermissionError('not writable');

  const odo = Number(input.odo);
  if (!Number.isFinite(odo)) throw new ValidationError('odo must be a number');
  if (!input.class || !vehicle.classes.includes(input.class)) {
    throw new ValidationError('class must be one of the vehicle classes');
  }
  const timestamp = new Date(input.timestamp);
  if (Number.isNaN(timestamp.getTime())) throw new ValidationError('invalid timestamp');

  // ODO is monotonically increasing in time: enforce against neighbours so the
  // history stays consistent regardless of which client wrote it.
  const [prev, next] = await Promise.all([
    prisma.trip.findFirst({
      where: { vehicleId, timestamp: { lt: timestamp } },
      orderBy: { timestamp: 'desc' },
    }),
    prisma.trip.findFirst({
      where: { vehicleId, timestamp: { gt: timestamp } },
      orderBy: { timestamp: 'asc' },
    }),
  ]);
  if (prev && odo <= prev.odo) {
    throw new ValidationError(`ODO must be greater than the previous record (${prev.odo} km)`);
  }
  if (next && odo >= next.odo) {
    throw new ValidationError(`ODO must be less than the next record (${next.odo} km)`);
  }

  const trip = await prisma.trip.create({
    data: { vehicleId, odo, class: input.class, timestamp },
  });
  return toTripDTO(trip);
}

// --- snapshot (for SSE / bootstrap) -------------------------------------

export async function getSnapshot(userId: string, vehicleId: string | null): Promise<SnapshotDTO> {
  const me = await ensureUser(userId);
  const vehicles = await listVehicles(userId);
  // Resolve the effective vehicle: requested -> user's current -> first readable.
  const readableIds = new Set(vehicles.map((v) => v.id));
  let effective = vehicleId && readableIds.has(vehicleId) ? vehicleId : null;
  if (!effective && me.currentVehicleId && readableIds.has(me.currentVehicleId)) {
    effective = me.currentVehicleId;
  }
  if (!effective && vehicles.length) effective = vehicles[0].id;

  const trips = effective
    ? (await prisma.trip.findMany({ where: { vehicleId: effective }, orderBy: { timestamp: 'asc' } })).map(toTripDTO)
    : [];

  return { me, vehicles, vehicleId: effective, trips };
}

// A cheap fingerprint of everything the snapshot depends on, used by the SSE
// loop to avoid re-pushing unchanged data.
export async function getSnapshotVersion(userId: string, vehicleId: string | null): Promise<string> {
  const [user, vehicleAgg, tripAgg] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { currentVehicleId: true, updatedAt: true } }),
    prisma.vehicle.aggregate({
      where: { members: { some: { userId, canRead: true } } },
      _max: { updatedAt: true },
      _count: true,
    }),
    vehicleId
      ? prisma.trip.aggregate({ where: { vehicleId }, _max: { updatedAt: true }, _count: true })
      : Promise.resolve({ _max: { updatedAt: null }, _count: 0 } as const),
  ]);
  return JSON.stringify({
    cur: user?.currentVehicleId ?? null,
    uupd: user?.updatedAt ?? null,
    vmax: vehicleAgg._max.updatedAt ?? null,
    vcount: vehicleAgg._count,
    vehicleId,
    tmax: tripAgg._max.updatedAt ?? null,
    tcount: tripAgg._count,
  });
}

// --- internals -----------------------------------------------------------

function normalizeClasses(classes: string[]): string[] {
  const trimmed = classes.map((c) => String(c).trim()).filter((c) => c !== '');
  const seen = new Set<string>();
  for (const c of trimmed) {
    if (seen.has(c)) throw new ValidationError('duplicate class');
    seen.add(c);
  }
  return trimmed;
}

async function loadVehicle(vehicleId: string): Promise<VehicleWithMembers> {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    include: { members: true },
  });
  if (!vehicle) throw new NotFoundError('vehicle not found');
  return vehicle;
}

function member(vehicle: VehicleWithMembers, userId: string): VehicleMember | undefined {
  return vehicle.members.find((m) => m.userId === userId);
}

async function assertReadable(userId: string, vehicleId: string): Promise<void> {
  if (!member(await loadVehicle(vehicleId), userId)?.canRead) {
    throw new PermissionError('not readable');
  }
}

async function assertWritable(userId: string, vehicleId: string): Promise<void> {
  if (!member(await loadVehicle(vehicleId), userId)?.canWrite) {
    throw new PermissionError('not writable');
  }
}
