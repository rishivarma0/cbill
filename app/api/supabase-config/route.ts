import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

export async function GET() {
  const runtime = env as Cloudflare.Env;
  const url = runtime.SUPABASE_URL || process.env.SUPABASE_URL;
  const publishableKey =
    runtime.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    return Response.json({ error: 'Configuration unavailable' }, { status: 503 });
  }

  return Response.json(
    { url, publishableKey },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
