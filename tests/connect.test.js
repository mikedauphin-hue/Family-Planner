import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const source = readFileSync(new URL('../src.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
const wait = () => new Promise(resolve => setTimeout(resolve, 20));
const jwt = role => `${btoa('{}')}.${btoa(JSON.stringify({ role }))}.signature`;
function device({ failInit = false, failStorage = false } = {}) {
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://example.com/Family-Planner/', runScripts: 'outside-only' });
  const w = dom.window;
  let calls = 0;
  if (failStorage) w.Storage.prototype.setItem = () => { throw new Error('blocked'); };
  w.createClient = () => {
    calls++;
    if (failInit) throw new Error('Internal setup error');
    return { auth: {
      onAuthStateChange: callback => callback('INITIAL_SESSION', null),
      signInWithPassword: async () => ({ error: { message: 'Invalid login credentials' } }),
    } };
  };
  w.mountNotificationControls=()=>{};
  w.disableDeviceNotifications=async()=>{};
  w.eval(source);
  const submit = (url, key) => {
    w.document.querySelector('#project-url').value = url;
    w.document.querySelector('#public-key').value = key;
    w.document.querySelector('#connect').dispatchEvent(new w.Event('submit', { cancelable: true }));
  };
  return { w, doc: w.document, submit, calls: () => calls };
}
for (const key of ['sb_publishable_test', jwt('anon')]) {
  const d = device();
  d.submit('https://example.supabase.co', key);
  assert.ok(d.doc.querySelector('#email'));
  assert.equal(d.doc.activeElement.id, 'email');
  assert.match(d.doc.querySelector('#auth-message').textContent, /sign in/i);
  await wait();
  assert.ok(d.doc.querySelector('#password'));
  assert.match(d.doc.querySelector('.connection-card').textContent, /STEP 2 OF 2/);
  d.doc.querySelector('#email').value = 'person@example.com';
  d.doc.querySelector('#password').value = 'wrong-password';
  d.doc.querySelector('#auth').dispatchEvent(new d.w.Event('submit', { cancelable: true }));
  await wait();
  assert.match(d.doc.querySelector('#auth-message').textContent, /Invalid login credentials/);
  assert.ok(d.doc.querySelector('#auth-message').classList.contains('connection-error'));
  d.w.close();
}
for (const [url, key, message] of [
  ['', '', /full Project URL/],
  ['not a URL', 'sb_publishable_test', /full Project URL/],
  ['https://example.supabase.co/rest/v1', 'sb_publishable_test', /without \/rest\/v1/],
  ['https://example.supabase.co', '', /complete publishable key/],
  ['https://example.supabase.co', 'sb_secret_never-use-this', /Secret and service_role/],
  ['https://example.supabase.co', jwt('service_role'), /Secret and service_role/],
]) {
  const d = device(); d.submit(url, key);
  assert.match(d.doc.querySelector('#auth-message').textContent, message);
  assert.equal(d.calls(), 0);
  assert.equal(d.w.localStorage.getItem('family-cloud-config'), null);
  assert.ok(d.doc.querySelector('#connect'));
  d.w.close();
}
const failed = device({ failInit: true });
failed.submit('https://example.supabase.co', 'sb_publishable_test');
assert.match(failed.doc.querySelector('#auth-message').textContent, /could not initialize/);
assert.ok(failed.doc.querySelector('#connect'));
failed.w.close();
const blocked = device({ failStorage: true });
blocked.submit('https://example.supabase.co', 'sb_publishable_test');
assert.match(blocked.doc.querySelector('#auth-message').textContent, /Allow site storage/);
assert.ok(blocked.doc.querySelector('#connect'));
blocked.w.close();
console.log('PASS: fresh connection shows sign-in for publishable/anon keys; bad input, secret keys, storage failures and initialization errors are visible and recoverable.');
