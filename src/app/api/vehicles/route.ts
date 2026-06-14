import { NextResponse } from 'next/server';
import { createVehicle, ensureUser, listVehicles } from '@/lib/data';
import { errorResponse, requireUserId } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const userId = await requireUserId();
    await ensureUser(userId);
    return NextResponse.json(await listVehicles(userId));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    await ensureUser(userId);
    const body = await request.json();
    const vehicle = await createVehicle(userId, {
      name: String(body.name ?? ''),
      classes: Array.isArray(body.classes) ? body.classes : [],
    });
    return NextResponse.json(vehicle, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
