import { NextResponse } from 'next/server';
import { getReadableVehicle, shareVehicle, updateVehicle } from '@/lib/data';
import { errorResponse, requireUserId } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    return NextResponse.json(await getReadableVehicle(userId, id));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const body = await request.json();

    // Sharing is modelled as a distinct action so it can't be confused with a
    // name/classes edit.
    if (typeof body.shareUserId === 'string') {
      return NextResponse.json(await shareVehicle(userId, id, body.shareUserId));
    }

    return NextResponse.json(await updateVehicle(userId, id, {
      name: typeof body.name === 'string' ? body.name : undefined,
      classes: Array.isArray(body.classes) ? body.classes : undefined,
    }));
  } catch (err) {
    return errorResponse(err);
  }
}
