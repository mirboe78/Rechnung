/* Rechnungserstellung – Datenbank (IndexedDB)
 *
 * Grundregeln, damit bei Updates nie Daten verloren gehen:
 *  1. Die Datenbank wird nur ERWEITERT, nie gelöscht oder umgebaut.
 *     Neue Versionen fügen in onupgradeneeded nur Stores/Indizes hinzu.
 *  2. Erstellte Rechnungen werden nie überschrieben (add statt put),
 *     nur Status-Felder (bezahlt, gesichert, storniert) ändern sich.
 *  3. Nummer vergeben + Rechnung + PDF speichern passiert in EINER Transaktion.
 *  4. Vor jeder Daten-Migration wird ein vollständiger Schnappschuss abgelegt.
 */
const DB = (() => {
  const NAME = 'rechnungserstellung';
  const VERSION = 1;          // IndexedDB-Strukturversion (nur erhöhen, nie zurück)
  let db = null;

  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  function open() {
    return new Promise((res, rej) => {
      if (!('indexedDB' in self)) return rej(new Error('Dieser Browser kann keine Daten speichern.'));
      const r = indexedDB.open(NAME, VERSION);
      r.onupgradeneeded = e => {
        const d = r.result, old = e.oldVersion;
        if (old < 1) {
          d.createObjectStore('meta');                                   // Einstellungen, Zähler, Status
          d.createObjectStore('clients', { keyPath: 'id' });
          const inv = d.createObjectStore('invoices', { keyPath: 'id' });
          inv.createIndex('no', 'no', { unique: true });                 // doppelte Nummern sind unmöglich
          d.createObjectStore('pdfs', { keyPath: 'id' });                // archivierte PDFs (unveränderbar)
          d.createObjectStore('log', { keyPath: 'seq', autoIncrement: true });
          d.createObjectStore('snapshots', { keyPath: 'at' });
        }
        // Spätere Versionen: if (old < 2) { …nur hinzufügen… }
      };
      r.onsuccess = () => {
        db = r.result;
        db.onversionchange = () => { db.close(); location.reload(); };
        res(db);
      };
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('Die App ist noch in einem anderen Fenster geöffnet. Bitte dort schließen.'));
    });
  }

  /* Führt fn innerhalb einer Transaktion aus. Resolved erst, wenn die Daten wirklich geschrieben sind. */
  function tx(stores, mode, fn) {
    return new Promise((res, rej) => {
      const t = db.transaction(stores, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
      let out, failed = false;
      t.oncomplete = () => { if (!failed) res(out); };
      t.onerror = () => { failed = true; rej(t.error); };
      t.onabort = () => { failed = true; rej(t.error || new Error('Speichern abgebrochen')); };
      Promise.resolve().then(() => fn(t)).then(v => { out = v; }).catch(e => {
        failed = true; try { t.abort(); } catch (_) {} rej(e);
      });
    });
  }
  const store = (t, n) => t.objectStore(n);

  const getMeta = k => tx(['meta'], 'readonly', t => req(store(t, 'meta').get(k)));
  const all = name => tx([name], 'readonly', t => req(store(t, name).getAll()));
  const get = (name, key) => tx([name], 'readonly', t => req(store(t, name).get(key)));

  function logEntry(t, action, detail) {
    return req(store(t, 'log').add({ at: new Date().toISOString(), action, detail }));
  }
  async function bumpDirty(t) {
    const m = store(t, 'meta');
    const n = (await req(m.get('dirty'))) || 0;
    await req(m.put(n + 1, 'dirty'));
  }

  /* Allgemeines Schreiben von Metadaten (Einstellungen usw.) */
  const setMeta = (k, v, opts = {}) => tx(['meta', 'log'], 'readwrite', async t => {
    await req(store(t, 'meta').put(v, k));
    if (opts.dirty !== false) await bumpDirty(t);
    if (opts.log) await logEntry(t, opts.log, k);
  });

  const putClient = c => tx(['clients', 'meta', 'log'], 'readwrite', async t => {
    await req(store(t, 'clients').put(c));
    await bumpDirty(t);
    await logEntry(t, 'klient-gespeichert', c.id);
  });
  const deleteClient = id => tx(['clients', 'invoices', 'meta', 'log'], 'readwrite', async t => {
    const invs = await req(store(t, 'invoices').getAll());
    if (invs.some(i => i.client && i.client.id === id)) throw new Error('Für diese Person gibt es Rechnungen. Sie kann deshalb nicht gelöscht werden.');
    await req(store(t, 'clients').delete(id));
    await bumpDirty(t);
    await logEntry(t, 'klient-geloescht', id);
  });

  /* Rechnung anlegen: Nummer prüfen + hochzählen, Rechnung + PDF speichern – alles oder nichts.
   * expectedSeq: die Nummer, mit der das PDF erzeugt wurde. Stimmt sie nicht mehr, wird abgebrochen. */
  const createInvoice = (inv, pdfBytes, update) => tx(['meta', 'invoices', 'pdfs', 'log'], 'readwrite', async t => {
    const m = store(t, 'meta');
    const counters = (await req(m.get('counters'))) || {};
    const cur = counters[inv.counterKey] || 0;
    if (cur + 1 !== inv.seq) { const e = new Error('Nummer hat sich geändert'); e.code = 'SEQ'; throw e; }
    counters[inv.counterKey] = inv.seq;
    await req(m.put(counters, 'counters'));
    await req(store(t, 'invoices').add(inv));                 // add: wirft Fehler, falls die Nummer existiert
    await req(store(t, 'pdfs').add({ id: inv.id, bytes: pdfBytes }));
    if (update) await req(store(t, 'invoices').put(update));  // z. B. Original als „storniert“ markieren
    await bumpDirty(t);
    await logEntry(t, inv.kind === 'storno' ? 'storno-erstellt' : 'rechnung-erstellt', inv.no);
    return counters;
  });

  /* Nur Status-Felder ändern – Nummer, Beträge und PDF bleiben unberührt. */
  const STATUS_FIELDS = ['paidAt', 'savedAt', 'status', 'stornoNo', 'stornoId'];
  const updateInvoiceStatus = (id, patch, action) => tx(['invoices', 'meta', 'log'], 'readwrite', async t => {
    const s = store(t, 'invoices');
    const inv = await req(s.get(id));
    if (!inv) throw new Error('Rechnung nicht gefunden');
    for (const k of Object.keys(patch)) if (!STATUS_FIELDS.includes(k)) throw new Error('Feld darf nicht geändert werden: ' + k);
    Object.assign(inv, patch);
    await req(s.put(inv));
    if (action) { await bumpDirty(t); await logEntry(t, action, inv.no); }
    return inv;
  });
  const markSaved = (ids, at) => tx(['invoices'], 'readwrite', async t => {
    const s = store(t, 'invoices');
    for (const id of ids) { const inv = await req(s.get(id)); if (inv && !inv.savedAt) { inv.savedAt = at; await req(s.put(inv)); } }
  });

  const getPdf = async id => { const r = await get('pdfs', id); return r ? r.bytes : null; };
  const putPdfIfMissing = (id, bytes) => tx(['pdfs'], 'readwrite', async t => {
    const s = store(t, 'pdfs'); if (!(await req(s.get(id)))) await req(s.add({ id, bytes }));
  });

  /* ---------- Datensicherung ---------- */
  const b64 = buf => { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = str => { const s = atob(str), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a.buffer; };

  async function exportAll(includePdfs = true) {
    return tx(['meta', 'clients', 'invoices', 'pdfs', 'log'], 'readonly', async t => {
      const meta = {};
      const keys = await req(store(t, 'meta').getAllKeys());
      for (const k of keys) meta[k] = await req(store(t, 'meta').get(k));
      const out = {
        app: 'rechnungserstellung', format: 1, exportedAt: new Date().toISOString(),
        appVersion: self.APP_VERSION,
        meta: { settings: meta.settings, counters: meta.counters || {}, schema: meta.schema, logo: meta.logo || null },
        clients: await req(store(t, 'clients').getAll()),
        invoices: await req(store(t, 'invoices').getAll()),
        log: await req(store(t, 'log').getAll()),
        pdfs: {}
      };
      if (includePdfs) for (const p of await req(store(t, 'pdfs').getAll())) out.pdfs[p.id] = b64(p.bytes);
      return out;
    });
  }

  function validateBackup(d) {
    if (!d || d.app !== 'rechnungserstellung' || !Array.isArray(d.invoices) || !Array.isArray(d.clients)) throw new Error('Das ist keine Datensicherung dieser App.');
    if (d.format > 1) throw new Error('Diese Sicherung stammt aus einer neueren App-Version. Bitte zuerst die App aktualisieren.');
    return {
      clients: d.clients.length, invoices: d.invoices.length,
      pdfs: Object.keys(d.pdfs || {}).length, exportedAt: d.exportedAt,
      lastNo: d.invoices.slice().sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')).map(i => i.no).pop() || '–'
    };
  }

  /* Zusammenführen: Vorhandenes bleibt, Fehlendes wird ergänzt. Zähler = jeweils der höhere Wert. */
  async function importBackup(d) {
    validateBackup(d);
    const before = await exportAll(true);
    await tx(['snapshots'], 'readwrite', t => req(store(t, 'snapshots').put({ at: new Date().toISOString(), reason: 'vor-wiederherstellung', data: before })));
    return tx(['meta', 'clients', 'invoices', 'pdfs', 'log'], 'readwrite', async t => {
      const m = store(t, 'meta'), ci = store(t, 'clients'), iv = store(t, 'invoices'), pd = store(t, 'pdfs');
      let added = { clients: 0, invoices: 0, updated: 0 };
      for (const c of d.clients) if (!(await req(ci.get(c.id)))) { await req(ci.add(c)); added.clients++; }
      const existingNos = new Set((await req(iv.getAll())).map(i => i.no));
      for (const i of d.invoices) {
        const cur = await req(iv.get(i.id));
        if (!cur) {
          if (existingNos.has(i.no)) throw new Error(`Die Nummer ${i.no} gibt es auf diesem Gerät schon mit anderem Inhalt. Wiederherstellung abgebrochen, es wurde nichts verändert.`);
          await req(iv.add(i)); added.invoices++;
        } else {
          let ch = false;   // Status-Infos aus der Sicherung übernehmen, falls hier noch leer
          for (const k of STATUS_FIELDS) if (i[k] && !cur[k]) { cur[k] = i[k]; ch = true; }
          if (ch) { await req(iv.put(cur)); added.updated++; }
        }
        if (d.pdfs && d.pdfs[i.id] && !(await req(pd.get(i.id)))) await req(pd.add({ id: i.id, bytes: unb64(d.pdfs[i.id]) }));
      }
      const counters = (await req(m.get('counters'))) || {};
      for (const [k, v] of Object.entries((d.meta && d.meta.counters) || {})) counters[k] = Math.max(counters[k] || 0, v);
      for (const i of d.invoices) counters[i.counterKey] = Math.max(counters[i.counterKey] || 0, i.seq || 0);
      await req(m.put(counters, 'counters'));
      if (!(await req(m.get('settings'))) && d.meta && d.meta.settings) await req(m.put(d.meta.settings, 'settings'));
      if (!(await req(m.get('logo'))) && d.meta && d.meta.logo) await req(m.put(d.meta.logo, 'logo'));
      await logEntry(t, 'wiederherstellung', JSON.stringify(added));
      return added;
    });
  }

  async function snapshot(reason) {
    const data = await exportAll(true);
    await tx(['snapshots'], 'readwrite', t => req(store(t, 'snapshots').put({ at: new Date().toISOString(), reason, data })));
  }

  async function persist() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        if (await navigator.storage.persisted()) return true;
        return await navigator.storage.persist();
      }
    } catch (_) {}
    return false;
  }
  async function estimate() {
    try { if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate(); } catch (_) {}
    return null;
  }

  return { open, getMeta, setMeta, all, get, putClient, deleteClient, createInvoice, updateInvoiceStatus, markSaved,
    getPdf, putPdfIfMissing, exportAll, validateBackup, importBackup, snapshot, persist, estimate };
})();
