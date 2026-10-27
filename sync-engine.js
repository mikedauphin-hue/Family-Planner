// Field-level writes prevent edits to different days/fields from overwriting each other.
export class SyncEngine {
  constructor({ read, write, storage, storageKey, onRows, onStatus }) {
    Object.assign(this, { read, write, storage, storageKey, onRows, onStatus });
    let saved;
    try { saved = JSON.parse(storage.getItem(storageKey)); } catch {}
    this.rows = new Map((saved?.rows || []).map(row => [row.id, row]));
    this.pending = new Map((saved?.pending || []).map(row => [row.id, row]));
    this.active = true;
    this.emit();
  }
  persist() {
    this.storage.setItem(this.storageKey, JSON.stringify({ rows: [...this.rows.values()], pending: [...this.pending.values()] }));
  }
  emit() {
    this.onRows([...new Map([...this.rows, ...this.pending]).values()]);
  }
  set(id, value) {
    this.pending.set(id, { id, value });
    try { this.persist(); } catch { this.onStatus('Browser storage is full. Keep this page open until synced.'); }
    this.onStatus('Saving changes…');
  }
  async tick() {
    if (this.busy || !this.active) return;
    this.busy = true;
    try {
      for (const [id, row] of [...this.pending]) {
        if (!this.active) return;
        await this.write(row);
        this.rows.set(id, row);
        // A newer edit can arrive while this request is in flight.
        if (this.pending.get(id) === row) this.pending.delete(id);
        this.persist();
      }
      const rows = await this.read();
      if (!this.active) return;
      this.rows = new Map(rows.map(row => [row.id, row]));
      this.persist();
      this.emit();
      this.onStatus(this.pending.size ? 'Saving changes…' : '✓ Synced · checks for changes every 4 seconds');
    } catch (error) {
      if (this.active) this.onStatus(`Not synced: ${error.message}. Changes on this device will retry automatically.`);
    } finally { this.busy = false; }
  }
  stop() { this.active = false; }
}
