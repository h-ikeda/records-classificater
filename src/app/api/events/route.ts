import { getSnapshot, getSnapshotVersion } from '@/lib/data';
import { requireUserId } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Allow a long-lived stream; EventSource transparently reconnects when the
// platform terminates the function, so correctness does not depend on this.
export const maxDuration = 300;

const POLL_INTERVAL_MS = 2000;
const HEARTBEAT_MS = 25000;

// Server-Sent Events stream of the user's snapshot. We poll the database for a
// cheap version fingerprint and only re-send the full snapshot when it changes,
// which gives near-real-time updates (including changes made by other users on
// a shared vehicle) without any external pub/sub infrastructure.
export async function GET(request: Request) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return new Response('unauthorized', { status: 401 });
  }

  const url = new URL(request.url);
  const requestedVehicleId = url.searchParams.get('vehicleId');

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const comment = (text: string) => controller.enqueue(encoder.encode(`: ${text}\n\n`));

      const stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(poller);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      request.signal.addEventListener('abort', stop);

      let lastVersion = '';
      const tick = async () => {
        if (closed) return;
        try {
          const version = await getSnapshotVersion(userId, requestedVehicleId);
          if (version !== lastVersion) {
            lastVersion = version;
            send('snapshot', await getSnapshot(userId, requestedVehicleId));
          }
        } catch (err) {
          console.error('SSE tick failed:', err);
        }
      };

      const poller = setInterval(tick, POLL_INTERVAL_MS);
      const heartbeat = setInterval(() => {
        if (!closed) comment('keep-alive');
      }, HEARTBEAT_MS);

      // Initial snapshot immediately on connect.
      await tick();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
