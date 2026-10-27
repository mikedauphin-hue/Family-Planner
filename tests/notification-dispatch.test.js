import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../supabase/functions/planner-notifications/index.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
let now='2026-07-07T01:00:00Z';
class Clock extends Date { constructor(...args){super(...(args.length?args:[now]));} }
let handler;const sent=[];const failures=new Map();
const tables={
  planner_members:[{user_id:'a'},{user_id:'b'}],
  planner_entries:[{id:'name/0',value:'Mike'},{id:'2026-07-06/1/dinner',value:'Tacos'}],
  planner_push_subscriptions:[
    {id:'a-phone',user_id:'a',endpoint:'https://web.push.apple.com/a',subscription:{endpoint:'https://web.push.apple.com/a'}},
    {id:'b-phone',user_id:'b',endpoint:'https://web.push.apple.com/b',subscription:{endpoint:'https://web.push.apple.com/b'}},
    {id:'outsider',user_id:'removed',endpoint:'https://web.push.apple.com/removed',subscription:{endpoint:'https://web.push.apple.com/removed'}},
  ], planner_notification_deliveries:[],
};
function query(table){
  let filters=[],operation='select',values,limit=Infinity;
  const q={
    select(){return q;},eq(k,v){filters.push(row=>row[k]===v);return q;},
    in(k,vs){filters.push(row=>vs.includes(row[k]));return q;},
    like(k,v){filters.push(row=>row[k].startsWith(v.slice(0,-1)));return q;},
    limit(n){limit=n;return q;},update(v){operation='update';values=v;return q;},delete(){operation='delete';return q;},
    or(value){const threshold=value.split('last_test_at.lt.')[1];filters.push(row=>!row.last_test_at||row.last_test_at<threshold);return q;},
    maybeSingle(){return q.then(result=>({...result,data:result.data[0]||null}));},
    then(resolve,reject){try{
      const selected=tables[table].filter(row=>filters.every(fn=>fn(row))).slice(0,limit);
      if(operation==='update')for(const row of selected)Object.assign(row,values);
      if(operation==='delete')tables[table]=tables[table].filter(row=>!selected.includes(row));
      return Promise.resolve({data:selected.map(row=>({...row})),error:null}).then(resolve,reject);
    }catch(error){return Promise.reject(error).then(resolve,reject);}},
  };return q;
}
const db={from:query,auth:{getUser:async token=>({data:{user:['a','b'].includes(token)?{id:token}:null}})},rpc:async(name,{subscription_id,plan_date})=>{
  const rows=tables.planner_notification_deliveries;
  let row=rows.find(row=>row.subscription_id===subscription_id&&row.plan_date===plan_date);
  if(row&&(row.sent_at||new Date(row.claimed_at).getTime()>new Date(now).getTime()-120000))return {data:false};
  if(!row){row={subscription_id,plan_date};rows.push(row);}row.claimed_at=now;return {data:true};
}};
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-only',VAPID_PUBLIC_KEY:'public-test',VAPID_PRIVATE_KEY:'private-test',PLANNER_CRON_SECRET:'test-cron-secret'};
new Function('createClient','webpush','Deno','Date',source)(()=>db,{
  setVapidDetails(){},sendNotification:async(subscription,payload)=>{
    const status=failures.get(subscription.endpoint);
    if(status){failures.delete(subscription.endpoint);throw Object.assign(new Error('test failure'),{statusCode:status});}
    sent.push({endpoint:subscription.endpoint,message:JSON.parse(payload)});
  },
},{env:{get:name=>env[name]},serve:fn=>{handler=fn;}},Clock);
const request=async(action,extra={},user)=>handler(new Request('https://example.supabase.co/functions/v1/planner-notifications',{
  method:'POST',headers:{'Content-Type':'application/json',...(user?{Authorization:`Bearer ${user}`}:{'X-Planner-Cron-Secret':env.PLANNER_CRON_SECRET})},body:JSON.stringify({action,...extra}),
}));
let response=await request('send-nightly');assert.equal(response.status,200);assert.deepEqual(await response.json(),{sent:2,failed:0});
assert.equal(sent.length,2);assert.match(sent[0].message.body,/Dinner: Tacos/);assert.equal(sent[0].message.date,'2026-07-07');
assert.ok(sent.every(item=>!item.endpoint.endsWith('removed')));
response=await request('send-nightly');assert.deepEqual(await response.json(),{sent:0,failed:0});assert.equal(sent.length,2);
// A later evening sees current membership, not stale subscriptions.
now='2026-07-08T01:00:00Z';tables.planner_members=[{user_id:'a'}];
failures.set('https://web.push.apple.com/a',503);
response=await request('send-nightly');assert.deepEqual(await response.json(),{sent:0,failed:1});
response=await request('send-nightly');assert.deepEqual(await response.json(),{sent:1,failed:0});assert.equal(sent.length,3);
now='2026-07-09T01:00:00Z';failures.set('https://web.push.apple.com/a',410);
response=await request('send-nightly');assert.deepEqual(await response.json(),{sent:0,failed:1});
assert.equal(tables.planner_push_subscriptions.some(row=>row.id==='a-phone'),false);
// Test delivery is scoped to the requesting member and rate limited.
tables.planner_members.push({user_id:'b'});
response=await request('test',{endpoint:'https://web.push.apple.com/b'},'b');assert.equal(response.status,200);
response=await request('test',{endpoint:'https://web.push.apple.com/b'},'b');assert.equal(response.status,429);
response=await request('test',{endpoint:'https://web.push.apple.com/removed'},'b');assert.equal(response.status,400);
assert.equal(sent.length,4);
console.log('PASS: full sender path targets approved devices only; repeated jobs skip accepted sends; transient failures retry; expired subscriptions removed; tests are device-scoped and rate-limited.');
