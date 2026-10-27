import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import webpush from 'npm:web-push@3.6.7';

const TIME_ZONE = 'America/New_York';
function easternParts(now) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}
function tomorrow(now) {
  const parts = easternParts(now);
  const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + 1));
  const dateKey = date.toISOString().slice(0, 10);
  const day = (date.getUTCDay() + 6) % 7;
  const monday = new Date(date); monday.setUTCDate(date.getUTCDate() - day);
  return { date: dateKey, day, week: monday.toISOString().slice(0, 10), label: date.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' }) };
}
function due(now) {
  const parts = easternParts(now);
  return parts.hour === '21' && Number(parts.minute) < 15;
}
function clip(value, bytes = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  let result = '';
  for (const character of text) {
    if (new TextEncoder().encode(result + character).length > bytes - 3) return result + '…';
    result += character;
  }
  return result;
}
function summary(rows, target, appUrl, test = false) {
  const values = new Map(rows.map(row => [row.id, row.value]));
  const read = (field, fallback) => clip(values.get(field)) || fallback;
  const prefix = `${target.week}/${target.day}/`;
  const names = [0, 1].map(i => clip(values.get(`name/${i}`), 70) || `Person ${i + 1}`);
  const url = new URL(appUrl); url.searchParams.set('week', target.week);
  return {
    title: `${test ? 'Test · ' : ''}Tomorrow, ${target.label} · ${clip(values.get('custom/brand'), 70) || 'Family Planner'}`,
    body: [
      `${names[0]}: ${read(prefix + 'schedule/0', 'No plans added')}`,
      `${names[1]}: ${read(prefix + 'schedule/1', 'No plans added')}`,
      `Drop-off: ${read(prefix + 'dropoff', 'Not assigned')}`,
      `Pickup: ${read(prefix + 'pickup', 'Not assigned')}`,
      `Dinner: ${read(prefix + 'dinner', 'Not planned yet')}`,
    ].join('\n'),
    date: target.date + (test ? '-test' : ''), url: url.href,
  };
}
function validSubscription(subscription) {
  try {
    const url = new URL(subscription.endpoint);
    const apple = url.hostname === 'push.apple.com' || url.hostname.endsWith('.push.apple.com');
    const other = ['fcm.googleapis.com', 'updates.push.services.mozilla.com'].includes(url.hostname);
    const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && (apple || other)
      && decode(subscription.keys.p256dh).length === 65 && decode(subscription.keys.auth).length === 16;
  } catch { return false; }
}
async function equalSecret(left, right) {
  if (!left || !right || left.length > 256) return false;
  const hashes = await Promise.all([left, right].map(s => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
  const a = new Uint8Array(hashes[0]), b = new Uint8Array(hashes[1]);
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
async function dayRows(db, target) {
  const daily = await db.from('planner_entries').select('id,value').like('id', `${target.week}/${target.day}/%`);
  if (daily.error) throw daily.error;
  const names = await db.from('planner_entries').select('id,value').in('id', ['name/0', 'name/1', 'custom/brand']);
  if (names.error) throw names.error;
  return [...daily.data, ...names.data];
}

Deno.serve(async request => {
  const appUrl = Deno.env.get('APP_URL') || 'https://mikedauphin-hue.github.io/Family-Planner/';
  const origin = new URL(appUrl).origin;
  const cors = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-planner-cron-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin',
  };
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method !== 'POST') return reply({ error: 'Use POST.' }, 405);
  if (request.headers.get('Origin') && request.headers.get('Origin') !== origin) return reply({ error: 'Origin not allowed.' }, 403);
  try {
    const raw = await request.text();
    if (raw.length > 8000) return reply({ error: 'Request too large.' }, 413);
    let body; try { body = JSON.parse(raw); } catch { return reply({ error: 'Invalid request.' }, 400); }
    if (!body || typeof body.action !== 'string') return reply({ error: 'Choose an action.' }, 400);
    const cron = body.action === 'send-nightly';
    // Gateway JWT verification is OFF so pg_cron can invoke this function.
    // All non-cron actions explicitly validate a user token AND planner membership below.
    if (cron && !await equalSecret(request.headers.get('X-Planner-Cron-Secret'), Deno.env.get('PLANNER_CRON_SECRET'))) return reply({ error: 'Unauthorized.' }, 401);
    const db = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
    let user;
    if (!cron) {
      const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
      if (!token) return reply({ error: 'Sign in first.' }, 401);
      const auth = await db.auth.getUser(token);
      if (auth.error || !auth.data.user) return reply({ error: 'Sign in again.' }, 401);
      user = auth.data.user;
      const member = await db.from('planner_members').select('user_id').eq('user_id', user.id).maybeSingle();
      if (member.error || !member.data) return reply({ error: 'Only approved planner members can use notifications.' }, 403);
    }
    if (!['settings', 'status', 'subscribe', 'unsubscribe', 'test', 'send-nightly'].includes(body.action)) return reply({ error: 'Unknown action.' }, 400);
    if (body.action === 'unsubscribe') {
      const result = await db.from('planner_push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', body.endpoint);
      if (result.error) throw result.error;
      return reply({ enabled: false });
    }
    if (body.action === 'status') {
      const result = await db.from('planner_push_subscriptions').select('id').eq('user_id', user.id).eq('endpoint', body.endpoint).maybeSingle();
      if (result.error) throw result.error;
      return reply({ enabled: Boolean(result.data) });
    }
    const publicKey = Deno.env.get('VAPID_PUBLIC_KEY'), privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
    if (!publicKey || !privateKey || !Deno.env.get('PLANNER_CRON_SECRET')) return reply({ error: 'Owner setup is incomplete. Add the notification secrets using NOTIFICATIONS.md.' }, 503);
    webpush.setVapidDetails(appUrl, publicKey, privateKey);
    if (body.action === 'settings') {
      const probe = await db.from('planner_push_subscriptions').select('id').limit(1);
      if (probe.error) throw probe.error;
      return reply({ publicKey, timeZone: TIME_ZONE, hour: 21 });
    }
    if (body.action === 'subscribe') {
      if (!validSubscription(body.subscription)) return reply({ error: 'Invalid browser push subscription.' }, 400);
      const result = await db.from('planner_push_subscriptions').upsert({ user_id: user.id, endpoint: body.subscription.endpoint, subscription: body.subscription, updated_at: new Date().toISOString() }, { onConflict: 'endpoint' });
      if (result.error) throw result.error;
      return reply({ enabled: true });
    }
    const now = new Date();
    if (cron && !due(now)) return reply({ skipped: 'Outside the 9 p.m. Eastern delivery window.' });
    const target = tomorrow(now);
    const rows = await dayRows(db, target);
    const payload = JSON.stringify(summary(rows, target, appUrl, !cron));
    if (new TextEncoder().encode(payload).length > 3500) throw new Error('Payload too large');
    if (body.action === 'test') {
      const subscription = await db.from('planner_push_subscriptions').select('id,subscription,last_test_at').eq('user_id', user.id).eq('endpoint', body.endpoint).maybeSingle();
      if (subscription.error || !subscription.data) return reply({ error: 'Enable notifications on this device first.' }, 400);
      const claimed = await db.from('planner_push_subscriptions').update({ last_test_at: now.toISOString() }).eq('id', subscription.data.id).or(`last_test_at.is.null,last_test_at.lt.${new Date(now.getTime() - 60000).toISOString()}`).select('id');
      if (claimed.error) throw claimed.error;
      if (!claimed.data.length) return reply({ error: 'Wait one minute between test notifications.' }, 429);
      try { await webpush.sendNotification(subscription.data.subscription, payload, { TTL: 3600, urgency: 'normal' }); }
      catch (error) {
        if ([404, 410].includes(error.statusCode)) {
          await db.from('planner_push_subscriptions').delete().eq('id', subscription.data.id);
          return reply({ error: 'This device subscription expired. Enable notifications again.' }, 410);
        }
        return reply({ error: 'The push service did not accept the test. Check the VAPID keys and try again.' }, 502);
      }
      return reply({ accepted: true });
    }
    const members = await db.from('planner_members').select('user_id');
    if (members.error) throw members.error;
    const subscriptions = await db.from('planner_push_subscriptions').select('id,subscription').in('user_id', members.data.map(m => m.user_id));
    if (subscriptions.error) throw subscriptions.error;
    let sent = 0, failed = 0;
    for (const item of subscriptions.data) {
      const claim = await db.rpc('claim_planner_notification', { subscription_id: item.id, plan_date: target.date });
      if (claim.error) throw claim.error;
      if (!claim.data) continue;
      try {
        await webpush.sendNotification(item.subscription, payload, { TTL: 3600, urgency: 'normal', topic: `plan-${target.date}` });
        const mark = await db.from('planner_notification_deliveries').update({ sent_at: new Date().toISOString(), last_error: null }).eq('subscription_id', item.id).eq('plan_date', target.date);
        if (mark.error) throw mark.error;
        sent++;
      } catch (error) {
        failed++;
        if ([404, 410].includes(error.statusCode)) await db.from('planner_push_subscriptions').delete().eq('id', item.id);
        else await db.from('planner_notification_deliveries').update({ claimed_at: '1970-01-01T00:00:00Z', last_error: String(error.statusCode || 'send_failed') }).eq('subscription_id', item.id).eq('plan_date', target.date);
      }
    }
    return reply({ sent, failed });
  } catch {
    return reply({ error: 'Notification setup or delivery failed. Ask the planner owner to check NOTIFICATIONS.md and the function logs. No planner data was changed.' }, 500);
  }
});
