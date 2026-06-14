import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { NotFoundError, PermissionError, ValidationError } from './data';

// Resolve the authenticated Clerk user id or throw a 401.
export async function requireUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Unauthorized();
  return userId;
}

export class Unauthorized extends Error {}

// Map domain errors to HTTP responses so route handlers stay thin.
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof Unauthorized) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (err instanceof PermissionError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof NotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof ValidationError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error('Unhandled API error:', err);
  return NextResponse.json({ error: 'internal error' }, { status: 500 });
}
