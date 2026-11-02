// Petpooja Global API: one bill per POST on "Save and Print" (migration 250).
// Public address (no sign-in); guarded by the body token in receivePush.
import { receivePush } from '@/lib/petpooja/receive';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  return receivePush(req, 'orders');
}

// An address check by Petpooja's team gets a plain answer and saves nothing.
export async function GET() {
  return new Response('Creme Castle Petpooja bill receiver. POST only.', { status: 200 });
}
