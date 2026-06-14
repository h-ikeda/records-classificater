import { NextResponse } from 'next/server';
import { createTrip, listTrips } from '@/lib/data';
import { errorResponse, requireUserId } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    return NextResponse.json(await listTrips(userId, id));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const body = await request.json();
    const trip = await createTrip(userId, id, {
      odo: Number(body.odo),
      class: String(body.class ?? ''),
      timestamp: String(body.timestamp ?? ''),
    });
    return NextResponse.json(trip, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
