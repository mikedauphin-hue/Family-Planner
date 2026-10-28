import './style.css';
import { createClient } from '@supabase/supabase-js';
import { SyncEngine } from './sync-engine.js';
import { mountNotificationControls, disableDeviceNotifications } from './notifications.js';

const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
let monday = new Date();
monday.setHours(0, 0, 0, 0);
monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
const requestedWeek = new URLSearchParams(location.search).get('week');
if (/^\d{4}-\d{2}-\d{2}$/.test(requestedWeek || '')) {
  const [year, month, day] = requestedWeek.split('-').map(Number);
  const requested = new Date(year, month - 1, day);
  if (iso(requested) === requestedWeek && requested.getDay() === 1) monday = requested;
}
let config;
try { config = JSON.parse(localStorage.getItem('family-cloud-config')); } catch {}
let client, session, engine, poll, saveTimer;
let sessionVersion = 0;
let rows = new Map();
let status = 'Connect your shared planner to get started.';
const app = document.querySelector('#app');
const rowId = (day, field, person) => `${iso(monday)}/${day}/${field}${person === undefined ? '' : `/${person}`}`;
const get = id => rows.get(id) ?? '';
const defaultCopy = {
  brand: 'hearth',
  heading: 'Our week, together.',
  tagline: 'Every schedule, every ride, every dinner. Shared between you two.',
};
const copy = field => rows.has(`custom/${field}`) ? get(`custom/${field}`) : defaultCopy[field];
function updateCopy() {
  document.querySelectorAll('[data-copy]').forEach(el => { el.textContent = copy(el.dataset.copy); });
  document.title = `${copy('brand')} · Family Planner`;
}
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
  updateCopy();
}
function header() {
  return `<header><a class="brand" href="./"><span class="brand-icon">▦</span><span data-copy="brand">${esc(copy('brand'))}</span><span class="brand-dot">.</span></a><span class="header-note">A little planning. More time together.</span></header>`;
}
function isPublicKey(key) {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  // Legacy anon JWTs are public browser keys too; never accept service_role keys.
  try {
    const parts = key.split('.');
    if (parts.length !== 3) return false;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload)).role === 'anon';
  } catch { return false; }
}
function connectionError(message, fieldId) {
  const messageElement = document.querySelector('#auth-message');
  messageElement.textContent = message;
  messageElement.classList.add('connection-error');
  if (fieldId) document.querySelector(fieldId).focus();
  messageElement.scrollIntoView?.({ block: 'nearest' });
}
function gate(message = '') {
  app.innerHTML = `<div class="shell">${header()}<main class="welcome"><div class="eyebrow">ONE WEEK. TWO PEOPLE.</div><h1>Our week, together<span>.</span></h1><p>Your schedules, rides, and dinners, shared across devices.</p><section class="connection-card"><div class="eyebrow">STEP ${config ? '2' : '1'} OF 2</div><h2>${config ? 'Sign in to your planner' : 'Connect your shared planner'}</h2><p>${config ? 'Use the email and password your planner owner created for you. Both people connect to the same Supabase project.' : 'First-time setup? Follow SETUP.md in the GitHub repository. Enter the same project details on each device.'}</p><p id="auth-message" role="alert">${esc(message)}</p>${config ? `<form id="auth"><label>Email<input id="email" type="email" autocomplete="username" required></label><label>Password<input id="password" type="password" autocomplete="current-password" minlength="8" required></label><div class="dialog-actions"><button class="primary" type="submit">Sign in</button></div></form><button id="change-project" class="text-button">Change project connection</button>` : `<form id="connect" novalidate><label>Supabase project URL<input id="project-url" type="url" placeholder="https://your-project.supabase.co" required></label><label>Publishable key or legacy anon key<input id="public-key" type="text" autocomplete="off" placeholder="sb_publishable_…" required></label><p>Paste your public publishable key (sb_publishable_…) or legacy anon key (eyJ…). Never enter a secret or service_role key.</p><button class="primary" type="submit">Connect planner</button></form>`}</section><p class="privacy-note">Only the two approved accounts can access your planner. Your old local planner is kept separately on this device.</p></main></div>`;
  if (!config) {
    document.querySelector('#connect').onsubmit = e => {
      e.preventDefault();
      const rawUrl = document.querySelector('#project-url').value.trim();
      const key = document.querySelector('#public-key').value.trim();
      let url;
      try { url = new URL(rawUrl); } catch {
        connectionError('Enter your full Project URL, starting with https://, from Supabase → Settings → Data API.', '#project-url');
        return;
      }
      if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.pathname !== '/' || url.search || url.hash || url.port || url.username || url.password) {
        connectionError('Use only the Project URL: https://your-project.supabase.co — without /rest/v1 or other text.', '#project-url');
        return;
      }
      if (!isPublicKey(key)) {
        connectionError('Paste the complete publishable key (starts sb_publishable_) or legacy anon public key (starts eyJ) from Supabase → Settings → API Keys. Secret and service_role keys cannot be used here.', '#public-key');
        return;
      }
      try {
        const nextConfig = { url: url.origin, key };
        const nextClient = createClient(nextConfig.url, nextConfig.key);
        try { localStorage.setItem('family-cloud-config', JSON.stringify(nextConfig)); } catch {
          connectionError('Your browser could not save the connection. Allow site storage for this website, then try again.');
          return;
        }
        config = nextConfig;
        initialize(nextClient);
        document.querySelector('#auth-message').textContent = 'Project details saved. Now sign in with the email and password created in Supabase.';
        document.querySelector('#email').focus();
      } catch {
        config = null;
        gate('The planner could not initialize the connection. Check your project details and try again, or refresh the page.');
      }
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
    } catch (error) { connectionError(error.message); }
    finally { buttons.forEach(b => b.disabled = false); }
  };
  document.querySelector('#auth').onsubmit = e => { e.preventDefault(); auth(); };
  document.querySelector('#email').focus();
}
function input(day, field, person, placeholder, label, textarea = false) {
  const id = rowId(day, field, person);
  const attrs = `maxlength="20000" data-id="${esc(id)}" placeholder="${esc(placeholder)}" aria-label="${esc(label)}"`;
  return textarea ? `<textarea rows="${field === 'dinner' ? 4 : 2}" ${attrs}>${esc(get(id))}</textarea>` : `<input ${attrs} value="${esc(get(id))}">`;
}
function render() {
  const end = new Date(monday); end.setDate(end.getDate() + 6);
  const fmt = { month: 'short', day: 'numeric' };
  app.innerHTML = `<div class="shell">${header()}<main><section class="intro"><div><div class="eyebrow">THE SHARED FAMILY PLANNER</div><h1 data-copy="heading">${esc(copy('heading'))}</h1><p data-copy="tagline">${esc(copy('tagline'))}</p></div><div class="intro-actions"><button class="secondary" id="notifications">Notifications</button><button class="secondary" id="customize">Customize planner</button><button class="print secondary" id="print">↗ Print week</button></div></section><section class="toolbar"><div class="week-nav"><button id="prev" aria-label="Previous week">‹</button><div><span class="small-label">WEEK OF</span><h2>${monday.toLocaleDateString('en-US', fmt)} – ${end.toLocaleDateString('en-US', fmt)}<span class="year">, ${end.getFullYear()}</span></h2></div><button id="next" aria-label="Next week">›</button><button class="today" id="today">This week</button></div><button class="secondary" id="members">♧ Edit names</button></section><div class="family-strip"><span class="small-label">OUR CREW</span>${names().map((name, i) => `<span class="person"><i class="dot color${i}"></i><span data-name="${i}">${esc(name)}</span></span>`).join('')}<span class="hint">Changes sync automatically</span></div><section class="week-grid">${days.map((day, i) => {
    const date = new Date(monday); date.setDate(date.getDate() + i);
    const today = iso(date) === iso(new Date());
    return `<article class="day ${i > 4 ? 'weekend' : ''} ${today ? 'is-today' : ''}"><div class="day-title"><h3>${day}</h3><span class="date">${date.getDate()}</span></div>${today ? '<span class="today-tag">TODAY</span>' : ''}<div class="rides"><label><span>↗ DROP-OFF</span>${input(i, 'dropoff', undefined, "Who's dropping off?", `${day} drop-off`)}</label><label><span>↙ PICKUP</span>${input(i, 'pickup', undefined, "Who's picking up?", `${day} pickup`)}</label></div><label class="dinner"><span>♨ ON THE MENU</span>${input(i, 'dinner', undefined, "What's for dinner?", `${day} dinner`, true)}</label><div class="schedules">${names().map((name, j) => `<label class="schedule"><span><i class="dot color${j}"></i><span data-name="${j}">${esc(name)}</span></span>${input(i, 'schedule', j, 'Add a plan…', `${name} schedule for ${day}`, true)}</label>`).join('')}</div></article>`;
  }).join('')}</section><footer><span id="status" role="status">${esc(status)}</span><span>${esc(session.user.email)} · <button id="change-password" class="text-button">Change password</button> · <button id="signout" class="text-button">Sign out</button></span></footer><p class="sync-note">Updates appear within a few seconds. If you both edit the same field, the last saved change wins. Names label the two schedule columns; they do not change account access.</p></main></div><dialog id="family-dialog"><form id="family-form"><div class="eyebrow">YOUR PEOPLE</div><h2>Meet the crew.</h2><p>One schedule column for each of you.</p>${names().map((name, i) => `<label>Person ${i + 1}<input id="name-${i}" value="${esc(name)}" maxlength="60" required></label>`).join('')}<div class="dialog-actions"><button type="button" class="secondary" id="cancel">Cancel</button><button type="submit" class="primary">Save names</button></div></form></dialog><dialog id="password-dialog"><form id="password-form"><h2>Change your password</h2><label>New password<input id="new-password" type="password" autocomplete="new-password" minlength="12" required></label><label>Repeat new password<input id="repeat-password" type="password" autocomplete="new-password" minlength="12" required></label><p id="password-message" role="status"></p><div class="dialog-actions"><button type="button" id="password-cancel" class="secondary">Cancel</button><button class="primary">Save password</button></div></form></dialog><dialog id="customize-dialog"><form id="customize-form"><div class="eyebrow">MAKE IT YOURS</div><h2>Customize your planner</h2><p>Choose the words that feel like your family. These changes are shared with both people.</p><label>App name<input id="custom-brand" maxlength="40" required></label><label>Main heading<input id="custom-heading" maxlength="100" required></label><label>Tagline<textarea id="custom-tagline" rows="3" maxlength="200"></textarea></label><button type="button" class="text-button" id="custom-defaults">Use default wording</button><div class="dialog-actions"><button type="button" class="secondary" id="custom-cancel">Cancel</button><button type="submit" class="primary">Save changes</button></div></form></dialog><dialog id="notifications-dialog"><div class="eyebrow">A LITTLE HEADS-UP</div><h2>Tomorrow, planned.</h2><p>Get tomorrow’s schedules, rides, and dinner at <strong>9 p.m. Eastern</strong>, following daylight saving time automatically.</p><p>Notifications may show private plans on your Lock Screen. Signing out turns them off on this device.</p><p id="notification-message" role="status"></p><div class="notification-actions"><button id="notification-enable" class="primary" disabled>Enable notifications</button><button id="notification-test" class="secondary" disabled>Send test</button><button id="notification-disable" class="secondary" disabled>Turn off on this device</button><button id="notification-close" class="secondary">Close</button></div></dialog>`;
  document.querySelector('#prev').onclick = () => move(-7);
  document.querySelector('#next').onclick = () => move(7);
  document.querySelector('#today').onclick = () => { monday = new Date(); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7)); render(); };
  document.querySelector('#print').onclick = () => window.print();
  updateCopy();
  mountNotificationControls({ client });
  const customizeDialog = document.querySelector('#customize-dialog');
  const customFields = Object.keys(defaultCopy);
  const fillCustom = values => customFields.forEach(field => {
    const input = document.querySelector(`#custom-${field}`);
    input.value = values[field];
    input.setCustomValidity('');
  });
  document.querySelector('#customize').onclick = () => {
    fillCustom(Object.fromEntries(customFields.map(field => [field, copy(field)])));
    customizeDialog.showModal();
  };
  document.querySelector('#custom-cancel').onclick = () => customizeDialog.close();
  document.querySelector('#custom-defaults').onclick = () => fillCustom(defaultCopy);
  customFields.forEach(field => document.querySelector(`#custom-${field}`).addEventListener('input', e => e.target.setCustomValidity('')));
  document.querySelector('#customize-form').onsubmit = e => {
    e.preventDefault();
    for (const field of ['brand', 'heading']) {
      const input = document.querySelector(`#custom-${field}`);
      input.setCustomValidity(input.value.trim() ? '' : 'Please enter some wording.');
    }
    if (!e.target.reportValidity()) return;
    customFields.forEach(field => set(`custom/${field}`, document.querySelector(`#custom-${field}`).value.trim()));
    updateCopy();
    customizeDialog.close();
  };

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
    try { await disableDeviceNotifications(client); } catch (error) { setStatus(error.message); return; }
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
  if (!session) { gate(config ? 'Project details saved. Sign in below with your planner email and password.' : ''); return; }
  setStatus('Connecting to shared planner…');
  // Membership is checked before rendering editable fields. RLS independently checks every request.
  const { data, error } = await client.from('planner_members').select('user_id').eq('user_id', session.user.id);
  if (version !== sessionVersion) return;
  if (error || !data?.length) {
    app.innerHTML = `<div class="shell">${header()}<main class="welcome"><h1>One more step.</h1><p>${esc(error ? `Could not check access: ${error.message}` : 'Your account is signed in, but not approved for this planner yet.')}</p><p>The planner owner needs to complete the database setup in SETUP.md, approving exactly two accounts.</p><p id="access-message" role="status"></p><button id="retry" class="primary">Check access again</button> <button id="logout" class="secondary">Sign out</button></main></div>`;
    document.querySelector('#retry').onclick = () => startSession(session);
    document.querySelector('#logout').onclick = async () => {
      try {
        await disableDeviceNotifications(client);
        const { error } = await client.auth.signOut();
        if (error) throw error;
      } catch (error) { document.querySelector('#access-message').textContent = error.message; }
    };
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
function initialize(preparedClient) {
  if (!config) { gate(); return; }
  try {
    client = preparedClient || createClient(config.url, config.key);
  } catch {
    config = null;
    gate('The saved connection could not be opened. Please enter your project details again.');
    return;
  }
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
