import './style.css';
import { createClient } from '@supabase/supabase-js';
import { SyncEngine } from './sync-engine.js';

const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
let monday = new Date();
monday.setHours(0, 0, 0, 0);
monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
let config;
try { config = JSON.parse(localStorage.getItem('family-cloud-config')); } catch {}
let client, session, engine, poll, saveTimer;
let sessionVersion = 0;
let rows = new Map();
let status = 'Connect your shared planner to get started.';
const app = document.querySelector('#app');
const rowId = (day, field, person) => `${iso(monday)}/${day}/${field}${person === undefined ? '' : `/${person}`}`;
const get = id => rows.get(id) ?? '';
const names = () => [get('name/0') || 'Person 1', get('name/1') || 'Person 2'];
function setStatus(message) {
  status = message;
  const el = document.querySelector('#status');
  if (el) el.textContent = message;
}
function set(id, value) {
  rows.set(id, value);
  engine.set(id, value);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => engine.tick(), 500);
}
function applyRows(values) {
  rows = new Map(values.map(row => [row.id, row.value]));
  // Never replace the active input while someone is typing.
  document.querySelectorAll('[data-id]').forEach(input => {
    if (document.activeElement !== input) input.value = get(input.dataset.id);
  });
  document.querySelectorAll('[data-name]').forEach(el => { el.textContent = names()[Number(el.dataset.name)]; });
}
function header() {
  return '<header><a class="brand" href="./"><span class="brand-icon">▦</span> hearth<span class="brand-dot">.</span></a><span class="header-note">A little planning. More time together.</span></header>';
}
function gate(message = '') {
  app.innerHTML = `<div class="shell">${header()}<main class="welcome"><div class="eyebrow">ONE WEEK. TWO PEOPLE.</div><h1>Our week, together<span>.</span></h1><p>Your schedules, rides, and dinners, shared across devices.</p><section class="connection-card"><h2>${config ? 'Sign in to your planner' : 'Connect your shared planner'}</h2><p>${config ? 'Use the email and password your planner owner created for you. Both people connect to the same Supabase project.' : 'First-time setup? Follow SETUP.md in the GitHub repository. Enter the same project details on each device.'}</p>${config ? `<form id="auth"><label>Email<input id="email" type="email" autocomplete="username" required></label><label>Password<input id="password" type="password" autocomplete="current-password" minlength="8" required></label><div class="dialog-actions"><button class="primary" type="submit">Sign in</button></div></form><button id="change-project" class="text-button">Change project connection</button>` : `<form id="connect"><label>Supabase project URL<input id="project-url" type="url" placeholder="https://your-project.supabase.co" required></label><label>Publishable key<input id="public-key" type="text" autocomplete="off" placeholder="sb_publishable_…" required></label><p>Use the public publishable key. Never enter a secret or service_role key.</p><button class="primary" type="submit">Connect planner</button></form>`}<p id="auth-message" role="status">${esc(message)}</p></section><p class="privacy-note">Only the two approved accounts can access your planner. Your old local planner is kept separately on this device.</p></main></div>`;
  if (!config) {
    document.querySelector('#connect').onsubmit = e => {
      e.preventDefault();
      try {
        const url = new URL(document.querySelector('#project-url').value.trim());
        const key = document.querySelector('#public-key').value.trim();
        if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.pathname !== '/' || url.search || url.hash || url.port || url.username || url.password) throw new Error('Use your Supabase project URL: https://your-project.supabase.co');
        if (!key.startsWith('sb_publishable_')) throw new Error('Use the publishable key from Supabase → Settings → API Keys. Secret keys must never go in the app.');
        config = { url: url.origin, key };
        localStorage.setItem('family-cloud-config', JSON.stringify(config));
        initialize();
      } catch (error) { document.querySelector('#auth-message').textContent = error.message; }
    };
    return;
  }
  document.querySelector('#change-project').onclick = () => {
    localStorage.removeItem('family-cloud-config');
    location.reload();
  };
  const auth = async () => {
    const form = document.querySelector('#auth');
    if (!form.reportValidity()) return;
    const buttons = [...form.querySelectorAll('button')];
    buttons.forEach(b => b.disabled = true);
    const credentials = { email: document.querySelector('#email').value.trim(), password: document.querySelector('#password').value };
    try {
      const { error } = await client.auth.signInWithPassword(credentials);
      if (error) throw error;
    } catch (error) { document.querySelector('#auth-message').textContent = error.message; }
    finally { buttons.forEach(b => b.disabled = false); }
  };
  document.querySelector('#auth').onsubmit = e => { e.preventDefault(); auth(); };
}
function input(day, field, person, placeholder, label, textarea = false) {
  const id = rowId(day, field, person);
  const attrs = `maxlength="20000" data-id="${esc(id)}" placeholder="${esc(placeholder)}" aria-label="${esc(label)}"`;
  return textarea ? `<textarea rows="2" ${attrs}>${esc(get(id))}</textarea>` : `<input ${attrs} value="${esc(get(id))}">`;
}
function render() {
  const end = new Date(monday); end.setDate(end.getDate() + 6);
  const fmt = { month: 'short', day: 'numeric' };
  app.innerHTML = `<div class="shell">${header()}<main><section class="intro"><div><div class="eyebrow">THE SHARED FAMILY PLANNER</div><h1>Our week, together<span>.</span></h1><p>Every schedule, every ride, every dinner. Shared between you two.</p></div><button class="print secondary" id="print">↗ Print week</button></section><section class="toolbar"><div class="week-nav"><button id="prev" aria-label="Previous week">‹</button><div><span class="small-label">WEEK OF</span><h2>${monday.toLocaleDateString('en-US', fmt)} – ${end.toLocaleDateString('en-US', fmt)}<span class="year">, ${end.getFullYear()}</span></h2></div><button id="next" aria-label="Next week">›</button><button class="today" id="today">This week</button></div><button class="secondary" id="members">♧ Edit names</button></section><div class="family-strip"><span class="small-label">OUR CREW</span>${names().map((name, i) => `<span class="person"><i class="dot color${i}"></i><span data-name="${i}">${esc(name)}</span></span>`).join('')}<span class="hint">Changes sync automatically</span></div><section class="week-grid">${days.map((day, i) => {
    const date = new Date(monday); date.setDate(date.getDate() + i);
    const today = iso(date) === iso(new Date());
    return `<article class="day ${i > 4 ? 'weekend' : ''} ${today ? 'is-today' : ''}"><div class="day-title"><h3>${day}</h3><span class="date">${date.getDate()}</span></div>${today ? '<span class="today-tag">TODAY</span>' : ''}<div class="schedules">${names().map((name, j) => `<label class="schedule"><span><i class="dot color${j}"></i><span data-name="${j}">${esc(name)}</span></span>${input(i, 'schedule', j, 'Add a plan…', `${name} schedule for ${day}`, true)}</label>`).join('')}</div><div class="rides"><label><span>↗ DROP-OFF</span>${input(i, 'dropoff', undefined, "Who's driving?", `${day} drop-off`)}</label><label><span>↙ PICKUP</span>${input(i, 'pickup', undefined, "Who's driving?", `${day} pickup`)}</label></div><label class="dinner"><span>♨ ON THE MENU</span>${input(i, 'dinner', undefined, "What's for dinner?", `${day} dinner`, true)}</label></article>`;
  }).join('')}</section><footer><span id="status" role="status">${esc(status)}</span><span>${esc(session.user.email)} · <button id="change-password" class="text-button">Change password</button> · <button id="signout" class="text-button">Sign out</button></span></footer><p class="sync-note">Updates appear within a few seconds. If you both edit the same field, the last saved change wins. Names label the two schedule columns; they do not change account access.</p></main></div><dialog id="family-dialog"><form id="family-form"><div class="eyebrow">YOUR PEOPLE</div><h2>Meet the crew.</h2><p>One schedule column for each of you.</p>${names().map((name, i) => `<label>Person ${i + 1}<input id="name-${i}" value="${esc(name)}" maxlength="60" required></label>`).join('')}<div class="dialog-actions"><button type="button" class="secondary" id="cancel">Cancel</button><button type="submit" class="primary">Save names</button></div></form></dialog><dialog id="password-dialog"><form id="password-form"><h2>Change your password</h2><label>New password<input id="new-password" type="password" autocomplete="new-password" minlength="12" required></label><label>Repeat new password<input id="repeat-password" type="password" autocomplete="new-password" minlength="12" required></label><p id="password-message" role="status"></p><div class="dialog-actions"><button type="button" id="password-cancel" class="secondary">Cancel</button><button class="primary">Save password</button></div></form></dialog>`;
  document.querySelector('#prev').onclick = () => move(-7);
  document.querySelector('#next').onclick = () => move(7);
  document.querySelector('#today').onclick = () => { monday = new Date(); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7)); render(); };
  document.querySelector('#print').onclick = () => window.print();
  document.querySelectorAll('[data-id]').forEach(el => el.addEventListener('input', () => set(el.dataset.id, el.value)));
  const dialog = document.querySelector('dialog');
  document.querySelector('#members').onclick = () => dialog.showModal();
  document.querySelector('#cancel').onclick = () => dialog.close();
  document.querySelector('#family-form').onsubmit = e => {
    e.preventDefault();
    const values = [0, 1].map(i => document.querySelector(`#name-${i}`).value.trim());
    if (values.some(v => !v)) return;
    values.forEach((value, i) => set(`name/${i}`, value));
    render();
  };
  const passwordDialog = document.querySelector('#password-dialog');
  document.querySelector('#change-password').onclick = () => passwordDialog.showModal();
  document.querySelector('#password-cancel').onclick = () => passwordDialog.close();
  document.querySelector('#password-form').onsubmit = async e => {
    e.preventDefault();
    const password = document.querySelector('#new-password').value;
    const message = document.querySelector('#password-message');
    if (password !== document.querySelector('#repeat-password').value) { message.textContent = 'The passwords do not match.'; return; }
    const button = e.target.querySelector('button.primary');
    button.disabled = true;
    try {
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      e.target.reset();
      message.textContent = 'Password updated. Use it next time you sign in.';
    } catch (error) { message.textContent = error.message; }
    finally { button.disabled = false; }
  };
  document.querySelector('#signout').onclick = async () => {
    if (engine.pending.size && !confirm('Some changes have not synced yet. They will retry when you sign in again on this device. Sign out anyway?')) return;
    const { error } = await client.auth.signOut();
    if (error) setStatus(`Could not sign out: ${error.message}`);
  };
}
function move(n) { monday.setDate(monday.getDate() + n); render(); }
async function startSession(nextSession) {
  const version = ++sessionVersion;
  engine?.stop(); clearInterval(poll); clearTimeout(saveTimer);
  session = nextSession;
  rows = new Map();
  if (!session) { gate(); return; }
  setStatus('Connecting to shared planner…');
  // Membership is checked before rendering editable fields. RLS independently checks every request.
  const { data, error } = await client.from('planner_members').select('user_id').eq('user_id', session.user.id);
  if (version !== sessionVersion) return;
  if (error || !data?.length) {
    app.innerHTML = `<div class="shell">${header()}<main class="welcome"><h1>One more step.</h1><p>${esc(error ? `Could not check access: ${error.message}` : 'Your account is signed in, but not approved for this planner yet.')}</p><p>The planner owner needs to complete the database setup in SETUP.md, approving exactly two accounts.</p><button id="retry" class="primary">Check access again</button> <button id="logout" class="secondary">Sign out</button></main></div>`;
    document.querySelector('#retry').onclick = () => startSession(session);
    document.querySelector('#logout').onclick = () => client.auth.signOut();
    return;
  }
  engine = new SyncEngine({
    storage: localStorage,
    storageKey: `family-shared-v1:${config.url}:${session.user.id}`,
    read: async () => {
      const result = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await client.from('planner_entries').select('id,value').order('id').range(offset, offset + 499);
        if (error) throw error;
        result.push(...data);
        if (data.length < 500) return result;
      }
    },
    write: async row => { const { error } = await client.from('planner_entries').upsert(row); if (error) throw error; },
    onRows: applyRows,
    onStatus: setStatus,
  });
  render();
  await engine.tick();
  if (version === sessionVersion) poll = setInterval(() => engine.tick(), 4000);
}
function initialize() {
  if (!config) { gate(); return; }
  client = createClient(config.url, config.key);
  gate();
  client.auth.onAuthStateChange((event, nextSession) => {
    // Supabase auth callbacks must finish before other Supabase requests start.
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_OUT' || event === 'SIGNED_IN' && nextSession?.user.id !== session?.user.id) {
      setTimeout(() => startSession(nextSession), 0);
    }
  });
}
window.addEventListener('online', () => engine?.tick());
window.addEventListener('beforeunload', e => { if (engine?.pending.size) { e.preventDefault(); e.returnValue = ''; } });
initialize();
