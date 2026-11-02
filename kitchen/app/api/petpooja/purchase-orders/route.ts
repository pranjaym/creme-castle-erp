// Petpooja Inventory API 8: one purchase order per POST when it is saved
// (migration 250). Public address (no sign-in); guarded by the echoed keys in
// receivePush.
import { receivePush } from '@/lib/petpooja/receive';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  return receivePush(req, 'purchase_orders');
}

// An address check by Petpooja's team gets a plain answer and saves nothing.
export async function GET() {
  return new Response('Creme Castle Petpooja purchase order receiver. POST only.', { status: 200 });
}
