import test from 'node:test';
import assert from 'node:assert/strict';
import { SyncEngine } from '../sync-engine.js';
function storage() {
  const map = new Map();
  return { getItem: key => map.get(key), setItem: (key, value) => map.set(key, value) };
}
function fixture(database = new Map(), overrides = {}) {
  let rows, status;
  const options = { storage: storage(), storageKey: 'test',
    read: async () => [...database.values()], write: async row => { database.set(row.id, row); },
    onRows: value => { rows = value; }, onStatus: value => { status = value; }, ...overrides };
  return { engine: new SyncEngine(options), options, get rows() { return rows; }, get status() { return status; } };
}
test('two devices edit separate fields without overwriting each other', async () => {
  const database = new Map();
  const a = fixture(database), b = fixture(database);
  a.engine.set('2026-10-26/0/dinner', 'Tacos');
  b.engine.set('2026-10-26/0/pickup', 'Jamie');
  await Promise.all([a.engine.tick(), b.engine.tick()]);
  await Promise.all([a.engine.tick(), b.engine.tick()]);
  assert.deepEqual(a.rows, b.rows);
  assert.equal(a.rows.length, 2);
  assert.equal(database.get('2026-10-26/0/dinner').value, 'Tacos');
});
test('failed writes remain durable and retry after reloading the device', async () => {
  const persistent = storage();
  const a = fixture(new Map(), { storage: persistent, write: async () => { throw new Error('Offline'); } });
  a.engine.set('name/0', 'Alex');
  await a.engine.tick();
  assert.match(a.status, /Not synced: Offline/);
  assert.equal(a.engine.pending.size, 1);
  a.engine.stop();
  const database = new Map();
  const b = fixture(database, { storage: persistent });
  assert.equal(b.rows[0].value, 'Alex');
  await b.engine.tick();
  assert.equal(database.get('name/0').value, 'Alex');
  assert.equal(b.engine.pending.size, 0);
});
test('typing during an in-flight save does not lose the newer edit', async () => {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const database = new Map();
  const a = fixture(database, { write: async row => { await wait; database.set(row.id, row); } });
  a.engine.set('dinner', 'Taco');
  const first = a.engine.tick();
  a.engine.set('dinner', 'Tacos for two');
  release(); await first;
  assert.equal(a.engine.pending.get('dinner').value, 'Tacos for two');
  assert.equal(a.rows[0].value, 'Tacos for two');
  await a.engine.tick();
  assert.equal(database.get('dinner').value, 'Tacos for two');
});
test('weeks remain distinct and simultaneous changes to the same field use last saved value', async () => {
  const database = new Map();
  const a = fixture(database), b = fixture(database);
  a.engine.set('2026-10-26/0/dinner', 'Soup');
  a.engine.set('2026-11-02/0/dinner', 'Pasta');
  await a.engine.tick();
  b.engine.set('2026-10-26/0/dinner', 'Pizza');
  await b.engine.tick(); await a.engine.tick();
  assert.equal(database.get('2026-10-26/0/dinner').value, 'Pizza');
  assert.equal(database.get('2026-11-02/0/dinner').value, 'Pasta');
  assert.equal(a.rows.find(row => row.id === '2026-10-26/0/dinner').value, 'Pizza');
});
test('stopped sessions do not apply responses after signing out', async () => {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  let applied = 0;
  const a = fixture(new Map(), { read: async () => { await wait; return [{ id: 'name/0', value: 'Alex' }]; }, onRows: () => { applied++; } });
  const initial = applied;
  const tick = a.engine.tick();
  a.engine.stop(); release(); await tick;
  assert.equal(applied, initial);
});
