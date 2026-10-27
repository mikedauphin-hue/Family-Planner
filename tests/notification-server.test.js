import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../supabase/functions/planner-notifications/index.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
let handler, sent = 0, user = null, member = false, databaseCalls = 0;
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-only', VAPID_PUBLIC_KEY: 'test-public', VAPID_PRIVATE_KEY: 'test-private', PLANNER_CRON_SECRET: 'private-test-secret' };
const db = {
  auth: { getUser: async token => ({ data: { user: token === 'valid-user' ? user : null }, error: null }) },
  from: table => {
    databaseCalls++;
    if (table === 'planner_members') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: member ? { user_id: 'one' } : null, error: null }) }) }) };
    if (table === 'planner_push_subscriptions') return { select: () => ({ limit: async () => ({ data: [], error: null }) }) };
    throw new Error('Unexpected database access: ' + table);
  },
};
const functions = new Function('createClient', 'webpush', 'Deno', source + '\nreturn { tomorrow, due, summary, validSubscription, equalSecret };')(
  () => db,
  { setVapidDetails: () => {}, sendNotification: async () => { sent++; } },
  { env: { get: name => env[name] }, serve: fn => { handler = fn; } },
);
const { tomorrow, due, summary, validSubscription, equalSecret } = functions;
for (const [now, date, week, day] of [
  ['2026-07-07T01:00:00Z','2026-07-07','2026-07-06',1], // Summer: 9 p.m. EDT.
  ['2026-01-07T02:00:00Z','2026-01-07','2026-01-05',2], // Winter: 9 p.m. EST.
  ['2026-03-08T02:00:00Z','2026-03-08','2026-03-02',6], // Night before spring DST.
  ['2026-03-09T01:00:00Z','2026-03-09','2026-03-09',0], // First night after spring DST.
  ['2026-11-01T01:00:00Z','2026-11-01','2026-10-26',6], // Night before fall DST.
  ['2026-11-02T02:00:00Z','2026-11-02','2026-11-02',0], // First night after fall DST.
  ['2027-01-01T02:00:00Z','2027-01-01','2026-12-28',4],
]) {
  assert.equal(due(new Date(now)),true);
  assert.deepEqual(Object.fromEntries(Object.entries(tomorrow(new Date(now))).filter(([key])=>key!=='label')),{date,week,day});
}
assert.equal(due(new Date('2026-07-07T02:00:00Z')),false);
assert.equal(due(new Date('2026-01-07T01:00:00Z')),false);
assert.equal(due(new Date('2026-07-07T01:15:00Z')),false);
assert.equal(due(new Date('2026-07-07T01:10:00Z')),true);
const target = tomorrow(new Date('2026-07-07T01:00:00Z'));
const values = [ ['name/0','Mike'], ['name/1','Jamie'],['custom/brand','Our family'],
 ['2026-07-06/1/schedule/0','Office 9–5'],['2026-07-06/1/schedule/1','Doctor at 3'],
 ['2026-07-06/1/dropoff','Mike'],['2026-07-06/1/pickup','Jamie'],['2026-07-06/1/dinner','Tacos'],
 ['2026-07-06/0/dinner','Wrong day'] ].map(([id,value])=>({id,value}));
const message=summary(values,target,'https://example.com/Family-Planner/');
assert.match(message.body,/Mike: Office 9–5/);assert.match(message.body,/Jamie: Doctor at 3/);
assert.match(message.body,/Drop-off: Mike/);assert.match(message.body,/Pickup: Jamie/);assert.match(message.body,/Dinner: Tacos/);
assert.doesNotMatch(message.body,/Wrong day/);assert.match(message.url,/week=2026-07-06/);
const large=summary(values.map(row=>({...row,value:'👨‍👩‍👧‍👦'.repeat(1000)})),target,'https://example.com/Family-Planner/');
assert.ok(new TextEncoder().encode(JSON.stringify(large)).length<3500);
const valid={endpoint:'https://web.push.apple.com/test',keys:{p256dh:btoa('x'.repeat(65)),auth:btoa('x'.repeat(16))}};
assert.equal(validSubscription(valid),true);
for(const endpoint of ['http://web.push.apple.com/test','https://127.0.0.1/','https://web.push.apple.com.evil.example/','https://web.push.apple.com:9999/','https://user:pass@web.push.apple.com/']) assert.equal(validSubscription({...valid,endpoint}),false);
assert.equal(validSubscription({...valid,keys:{auth:'bad',p256dh:'bad'}}),false);
assert.equal(await equalSecret('secret','secret'),true);assert.equal(await equalSecret('wrong','secret'),false);
const request=(body,headers={})=>new Request('https://example.supabase.co/functions/v1/planner-notifications',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
assert.equal((await handler(request({action:'send-nightly'}))).status,401);
assert.equal((await handler(request({action:'test'}))).status,401);
assert.equal((await handler(request({action:'test'},{Authorization:'Bearer invalid'}))).status,401);
user={id:'one'};
assert.equal((await handler(request({action:'test'},{Authorization:'Bearer valid-user'}))).status,403);
member=true;
const settings=await handler(request({action:'settings'},{Authorization:'Bearer valid-user'}));
assert.equal(settings.status,200);assert.deepEqual(await settings.json(),{publicKey:'test-public',timeZone:'America/New_York',hour:21});
assert.equal((await handler(request({action:'settings'},{Authorization:'Bearer valid-user',Origin:'https://evil.example'}))).status,403);
assert.equal(sent,0);
assert.ok(databaseCalls>0);
console.log('PASS: 9 p.m. Eastern across both DST transitions/year boundaries; next-day/week summary; payload limits; push-provider allowlist; cron authentication; member authentication; no test sends to real services.');
