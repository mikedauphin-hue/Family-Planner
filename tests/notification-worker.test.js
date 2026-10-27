import vm from 'node:vm';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const listeners = new Map();let shown,opened;
const scope='https://example.com/Family-Planner/';
const self={
  registration:{scope,showNotification:async(title,options)=>{shown={title,...options};}},
  addEventListener:(name,fn)=>listeners.set(name,fn),
  clients:{claim:async()=>{},matchAll:async()=>[],openWindow:async url=>{opened=url;}},
  skipWaiting:()=>{},
};
vm.runInNewContext(readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),{self,URL});
async function push(message){let work;listeners.get('push')({data:{json:()=>message},waitUntil:promise=>{work=promise;}});await work;}
await push({title:'Tomorrow’s plan',body:'Dinner: Tacos',date:'2026-10-28',url:scope+'?week=2026-10-26'});
assert.equal(shown.title,'Tomorrow’s plan');assert.equal(shown.body,'Dinner: Tacos');assert.equal(shown.tag,'family-plan-2026-10-28');
assert.equal(shown.icon,scope+'icon-192.png');
let clicked;listeners.get('notificationclick')({notification:{data:shown.data,close:()=>{}},waitUntil:promise=>{clicked=promise;}});await clicked;
assert.equal(opened,scope+'?week=2026-10-26');
await push({url:'https://evil.example/'});assert.equal(shown.data.url,scope);
await push({url:'https://example.com/OtherApp/'});assert.equal(shown.data.url,scope);
console.log('PASS: worker shows summaries, groups repeats by date, opens the correct week, and refuses notification links outside the planner.');
