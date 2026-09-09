import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let clientPromise: Promise<SupabaseClient> | null = null;

export function getSupabase(): Promise<SupabaseClient> {
  if (!clientPromise) {
    clientPromise = fetch('/api/supabase-config', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Room Current is not configured yet.');
        return response.json() as Promise<{ url: string; publishableKey: string }>;
      })
      .then(({ url, publishableKey }) =>
        createClient(url, publishableKey, {
          auth: {
            storage: window.sessionStorage,
            storageKey: 'room-current-auth-v3',
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false,
          },
        }),
      ).catch((error: unknown) => {
        clientPromise = null;
        throw error;
      });
  }
  return clientPromise;
}

export async function ensureAnonymousSession(client: SupabaseClient) {
  const { data, error } = await client.auth.getSession();
  if (error) throw new Error('Could not start a secure session.');
  if (data.session) return data.session;

  const result = await client.auth.signInAnonymously();
  if (result.error || !result.data.session) {
    throw new Error('Could not start a secure session. Please try again.');
  }
  return result.data.session;
}

export function resetSupabaseClient() {
  clientPromise = null;
}
