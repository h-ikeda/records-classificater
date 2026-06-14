import { NextResponse } from 'next/server';
import { ensureUser, setCurrentVehicle } from '@/lib/data';
import { errorResponse, requireUserId } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json(await ensureUser(userId));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await request.json();
    if (typeof body.currentVehicleId !== 'string') {
      return NextResponse.json({ error: 'currentVehicleId is required' }, { status: 400 });
    }
    await setCurrentVehicle(userId, body.currentVehicleId);
    return NextResponse.json(await ensureUser(userId));
  } catch (err) {
    return errorResponse(err);
  }
}
