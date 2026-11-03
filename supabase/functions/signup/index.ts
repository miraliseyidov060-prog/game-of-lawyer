import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const EMAIL_DOMAIN = 'players.gameforlawyer.app';
const RESERVED = new Set(['admin', 'root', 'system', 'system_seed', 'support', 'moderator', 'editor']);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body: { username?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }

  const username = String(body.username ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (!/^[a-z0-9_]{3,20}$/.test(username) || RESERVED.has(username)) {
    return json({ error: 'bad_username' }, 400);
  }
  if (password.length < 6 || password.length > 72) {
    return json({ error: 'bad_password' }, 400);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data, error } = await admin.auth.admin.createUser({
    email: `${username}@${EMAIL_DOMAIN}`,
    password,
    email_confirm: true,
    user_metadata: { username },
  });
  if (error || !data?.user) {
    const taken = /already|registered|exists|duplicate/i.test(error?.message ?? '');
    return json({ error: taken ? 'username_taken' : 'create_failed' }, taken ? 409 : 500);
  }

  const { error: profileError } = await admin
    .from('profiles')
    .update({ username })
    .eq('id', data.user.id);
  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id);
    return json({ error: 'username_taken' }, 409);
  }

  return json({ ok: true });
});
