/* Rechnungserstellung – Oberfläche */
'use strict';

/* ---------- Hilfsfunktionen ---------- */
const MONTHS = EXPORT.MONTHS;
const SCHEMA = 1;   // Datenformat-Version. Bei Änderungen: erhöhen und unten in MIGRATIONS ergänzen.
const MIGRATIONS = {
  // 2: async () => { … bestehende Daten erweitern, nie löschen … }
};
const eur = n => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);
const dec = n => new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const hrs = m => new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(m / 60);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n, l = 2) => String(n).padStart(l, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => iso(new Date());
const fmtD = s => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${d}.${m}.${y}`; };
const fmtDT = s => s ? new Date(s).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–';
const addDays = (s, n) => { const d = new Date(s + 'T12:00'); d.setDate(d.getDate() + n); return iso(d); };
const toMin = t => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fromMin = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const r2 = n => Math.round(n * 100) / 100;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const clone = o => JSON.parse(JSON.stringify(o));
const fullName = c => (c.anrede === 'Familie' ? 'Familie ' : '') + (c.name || '');
const addr = c => [c.street, c.city].filter(Boolean).join(', ');
const lastName = c => (c.name || '').trim().split(/\s+/).pop().replace(/[^\wÄÖÜäöüß-]/g, '') || 'Klient';
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ls = { get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }, del(k) { try { localStorage.removeItem(k); } catch (_) {} } };

/* Bewusst ohne persönliche Daten: alles wird bei der Einrichtung auf dem Gerät eingetragen. */
const DEFAULT_SETTINGS = {
  sender: { name: '', practice: '', street: '', city: '', phone: '', mail: '', taxno: '' },
  bank: { owner: '', iban: '', bic: '', bank: '' },
  taxMode: 'ku',
  rates: [{ id: 'r1', name: 'Beratung', rate: 0 }],
  step: 15, dueDays: 0, resetYearly: true, prefix: '',
  mail: {
    greetingWord: 'Guten Tag',
    subject: 'Rechnung {nummer}',
    body: '{anrede}\n\nanbei erhalten Sie meine Rechnung {nummer} über {betrag}.\n\nMit freundlichen Grüßen\n{absender}'
  },
  texts: {
    greeting: 'Guten Tag,',
    intro: 'vielen Dank für Ihr Vertrauen. Für meine Leistung erlaube ich mir, Ihnen Folgendes in Rechnung zu stellen:',
    payText: 'Ich bitte Sie, den Gesamtbetrag auf folgende Bankverbindung zu überweisen:',
    closing: 'Mit freundlichen Grüßen'
  }
};

/* ---------- Zustand (Spiegel der Datenbank) ---------- */
const A = {
  settings: null, logo: null, counters: {}, clients: [], invoices: [], dirty: 0, lastBackup: null, setupDone: false,
  persisted: false, view: 'start', D: null, lastId: null, lastBytes: null, listYear: new Date().getFullYear(), listFilter: 'all',
  clientQ: '', busy: false, update: null, pdfCache: new Map(), pending: null, restore: null, clientEdit: null, setupCounter: ''
};
const counterKey = year => (A.settings.resetYearly ? String(year) : 'all');
const nextSeq = year => (A.counters[counterKey(year)] || 0) + 1;
const cleanPrefix = v => String(v || '').toUpperCase().replace(/[^A-Z0-9ÄÖÜ_-]/g, '').slice(0, 6);
const fmtNo = (seq, year) => `${cleanPrefix(A.settings && A.settings.prefix)}${seq}-${year}`;
const peekNo = year => fmtNo(nextSeq(year), year);
const signed = i => (i.kind === 'storno' ? -i.gross : i.gross);
const pdfName = i => `${i.kind === 'storno' ? 'Stornorechnung' : 'Rechnung'}_${i.no}_${lastName(i.client)}.pdf`;
const folderHint = i => `Rechnungen › ${i.issued.slice(0, 4)} › ${i.issued.slice(5, 7)} ${MONTHS[+i.issued.slice(5, 7) - 1]}`;

async function loadAll() {
  const [settings, counters, clients, invoices, dirty, lastBackup, setupDone, logo] = await Promise.all([
    DB.getMeta('settings'), DB.getMeta('counters'), DB.all('clients'), DB.all('invoices'), DB.getMeta('dirty'), DB.getMeta('lastBackup'), DB.getMeta('setupDone'), DB.getMeta('logo')]);
  A.logo = logo || null;
  A.settings = settings ? Object.assign(clone(DEFAULT_SETTINGS), settings, { texts: Object.assign(clone(DEFAULT_SETTINGS.texts), settings.texts || {}), mail: Object.assign(clone(DEFAULT_SETTINGS.mail), settings.mail || {}) }) : clone(DEFAULT_SETTINGS);
  A.counters = counters || {};
  A.clients = clients;
  A.invoices = invoices;
  A.dirty = dirty || 0;
  A.lastBackup = lastBackup || null;
  A.setupDone = !!setupDone;
}
async function refreshMeta() {
  A.dirty = (await DB.getMeta('dirty')) || 0;
  A.lastBackup = (await DB.getMeta('lastBackup')) || null;
  A.counters = (await DB.getMeta('counters')) || {};
}

async function migrate() {
  const schema = await DB.getMeta('schema');
  if (schema === undefined) { await DB.setMeta('schema', SCHEMA, { dirty: false }); return; }
  if (schema > SCHEMA) throw new Error('Die Daten stammen aus einer neueren App-Version. Bitte die App aktualisieren.');
  if (schema < SCHEMA) {
    await DB.snapshot('vor-migration-' + schema + '-zu-' + SCHEMA);   // Sicherheitskopie vor jeder Umstellung
    for (let v = schema + 1; v <= SCHEMA; v++) { if (MIGRATIONS[v]) await MIGRATIONS[v](); await DB.setMeta('schema', v, { dirty: false, log: 'migration' }); }
  }
}

/* ---------- Rechnung bauen ---------- */
function calc(from, to) {
  const a = toMin(from), b = toMin(to);
  if (a == null || b == null || b <= a) return { raw: 0, billed: 0 };
  const raw = b - a, step = A.settings.step || 1;
  return { raw, billed: Math.max(step, Math.round(raw / step) * step) };
}
function clientById(id) { return A.clients.find(c => c.id === id); }
function rateById(id) { return A.settings.rates.find(r => r.id === id) || A.settings.rates[0]; }

function buildInvoice(D) {
  const s = A.settings, c = clientById(D.clientId) || { id: null, anrede: '', name: '', street: '', city: '' };
  const rate = rateById(D.rateId);
  const { raw, billed } = calc(D.from, D.to);
  const issued = today(), year = +issued.slice(0, 4), seq = nextSeq(year);
  const net = r2(billed / 60 * rate.rate), vat = s.taxMode === 'ust19' ? r2(net * 0.19) : 0;
  return {
    id: uid(), kind: 'rechnung', seq, counterKey: counterKey(year), year, no: fmtNo(seq, year), issued, createdAt: new Date().toISOString(),
    client: { id: c.id, anrede: c.anrede || '', name: c.name, street: c.street || '', city: c.city || '' },
    items: [{ desc: rate.name, date: D.date, from: D.from, to: D.to, minutes: raw, billedMinutes: billed, rate: rate.rate, amount: net }],
    net, vat, gross: r2(net + vat), taxMode: s.taxMode, dueDays: s.dueDays,
    status: 'ok', paidAt: null, savedAt: null, ref: null, refId: null, refIssued: null,
    snap: { sender: clone(s.sender), bank: clone(s.bank), texts: clone(s.texts) }, appVersion: self.APP_VERSION
  };
}
function buildStorno(orig) {
  const issued = today(), year = +issued.slice(0, 4), seq = nextSeq(year), s = A.settings;
  return Object.assign(clone(orig), {
    id: uid(), kind: 'storno', seq, counterKey: counterKey(year), year, no: fmtNo(seq, year), issued, createdAt: new Date().toISOString(),
    status: 'ok', paidAt: null, savedAt: null, ref: orig.no, refId: orig.id, refIssued: orig.issued, stornoNo: undefined, stornoId: undefined,
    snap: { sender: clone(s.sender), bank: clone(s.bank), texts: clone(s.texts) }, appVersion: self.APP_VERSION
  });
}

/* Nummer + Rechnung + PDF atomar speichern. Bei Konflikt neu nummerieren (max. 3 Versuche). */
async function persistNew(make, updateFor) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const inv = make();
    const bytes = PDF.build(inv, A.logo);
    const upd = updateFor ? updateFor(inv) : null;
    try {
      A.counters = await DB.createInvoice(inv, bytes, upd);
      A.invoices.push(inv);
      if (upd) Object.assign(A.invoices.find(i => i.id === upd.id), upd);
      A.pdfCache.set(inv.id, bytes);
      await refreshMeta();
      return { inv, bytes };
    } catch (e) {
      if (e.code === 'SEQ') { A.counters = (await DB.getMeta('counters')) || {}; continue; }
      throw e;
    }
  }
  throw new Error('Die Rechnungsnummer konnte nicht vergeben werden. Bitte die App neu öffnen.');
}

/* ---------- Dateien teilen / in „Dateien“ sichern ---------- */
function download(file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
}
/* Muss direkt aus einem Tipp heraus aufgerufen werden (Apple-Vorgabe). */
async function shareFiles(files, onDone) {
  let ok = false;
  if (navigator.canShare && navigator.share && navigator.canShare({ files })) {
    try { await navigator.share({ files }); ok = true; }
    catch (e) {
      if (e.name === 'AbortError') { toast('Abgebrochen – nichts gesichert.'); return false; }
      if (e.name === 'NotAllowedError') { A.pending = { files, onDone }; pendingSheet(); return false; }
      toast('Teilen nicht möglich: ' + e.message, true); return false;
    }
  } else {
    for (const f of files) { download(f); await new Promise(r => setTimeout(r, 350)); }
    ok = true;
  }
  if (ok && onDone) { try { await onDone(); } catch (e) { toast('Gesichert, aber Status nicht gespeichert: ' + e.message, true); } }
  return ok;
}
const pdfFile = (inv, bytes) => new File([bytes], pdfName(inv), { type: 'application/pdf' });
async function backupFile() {
  const data = await DB.exportAll(true);
  const d = new Date();
  return new File([JSON.stringify(data)], `Rechnungen-Datensicherung_${iso(d)}_${pad(d.getHours())}-${pad(d.getMinutes())}.json`, { type: 'application/json' });
}
async function markBackupDone(count) {
  const lb = { at: new Date().toISOString(), invoices: count };
  await DB.setMeta('lastBackup', lb, { dirty: false, log: 'datensicherung' });
  await DB.setMeta('dirty', 0, { dirty: false });
  A.lastBackup = lb; A.dirty = 0;
}
async function markSaved(ids) {
  const at = new Date().toISOString();
  await DB.markSaved(ids, at);
  A.invoices.forEach(i => { if (ids.includes(i.id) && !i.savedAt) i.savedAt = at; });
}
/* Zweistufig: erst vorbereiten (kann dauern), dann ein Tipp zum Sichern. */
async function prepareShare(title, hint, build, onDone) {
  sheet(`<div class="sheet-head"><h1>${esc(title)}</h1><button class="btn small" data-act="close">Schließen</button></div><p class="muted">Dateien werden vorbereitet …</p>`);
  try {
    const files = await build();
    A.pending = { files, onDone };
    pendingSheet(title, hint);
  } catch (e) { closeSheet(); toast('Vorbereiten fehlgeschlagen: ' + e.message, true); }
}
function pendingSheet(title = 'Dateien sind bereit', hint = '') {
  const p = A.pending; if (!p) return;
  sheet(`<div class="sheet-head"><h1>${esc(title)}</h1><button class="btn small" data-act="close">Schließen</button></div>
    <div class="card"><div class="stack" style="gap:6px">${p.files.map(f => `<div class="path">${esc(f.name)}</div>`).join('')}</div>
    ${hint ? `<p class="fine">${hint}</p>` : ''}
    <button class="btn primary big" data-act="sharePending">In Dateien sichern</button>
    <p class="fine">Im iPad-Menü „In Dateien sichern“ wählen, dann den Ordner aussuchen und „Sichern“ tippen.</p></div>`);
}

/* ---------- Vorschau (entspricht dem PDF) ---------- */
function paper(i, opts = {}) {
  const s = i.snap, st = i.kind === 'storno', sign = st ? -1 : 1, c = i.client;
  const wm = opts.draft ? '<div class="wm">Entwurf</div>' : i.status === 'storniert' ? '<div class="wm" style="color:rgb(150 58 49 / .16)">Storniert</div>' : '';
  const rcpt = c.name ? PDF.recipientLines(c).map(esc).join('<br>') : '<span style="color:var(--paper-muted)">Klient:in auswählen …</span>';
  const e = v => `${dec(sign * v)}€`, it = i.items[0];
  const rateT = Number.isInteger(it.rate) ? it.rate : dec(it.rate);
  return `<div class="paper" aria-label="Rechnungsvorschau">${wm}
    ${A.logo ? `<img class="p-logo ${A.logo.shadow ? 'shadow' : ''}" src="${A.logo.dataUrl}" alt="Logo">` : '<div class="p-logo-space"></div>'}
    <div class="p-sender">${esc(PDF.senderLine(s.sender))}</div>
    <div class="p-rcpt">${rcpt}</div>
    <div class="p-date">Datum ${fmtD(i.issued)}</div>
    <div class="p-no">${st ? 'Stornorechnung' : 'Rechnung'} Nr. ${esc(i.no)}</div>
    <div class="p-body">
      <p>${esc(s.texts.greeting)}</p>
      <p>${st ? `hiermit storniere ich die Rechnung Nr. ${esc(i.ref)} vom ${fmtD(i.refIssued)}. Der unten stehende Betrag wird Ihnen gutgeschrieben.` : esc(s.texts.intro)}</p>
      <div>
        <div class="p-grid"><span>${esc(it.desc)}</span><span>${fmtD(it.date)}</span><span>${e(it.amount)} (${rateT} x ${hrs(it.billedMinutes)} Std.)</span></div>
        ${i.taxMode === 'ust19' ? `<div class="p-grid"><span>zzgl. 19 % USt.</span><span></span><span>${e(i.vat)}</span></div>` : ''}
        <div class="p-grid p-tot"><span>${st ? 'Gutschrift' : 'Gesamt'}</span><span></span><span>${e(i.gross)}</span></div>
        ${i.taxMode === 'ku' ? '<p class="p-note">Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.</p>' : ''}
      </div>
      ${st ? '' : `<p>${esc(s.texts.payText)}${i.dueDays ? ` Bitte bis zum ${fmtD(addDays(i.issued, i.dueDays))}.` : ''}</p>
      <div class="p-grid bank">${PDF.bankRows(s).map(([k, v]) => `<span>${k}</span><span>${esc(v)}</span>`).join('')}</div>`}
      <p>${esc(s.texts.closing)}</p>
    </div>
    <div class="p-foot">${esc(PDF.footerText(s.sender))}${s.sender.taxno ? `<br>Steuernummer: ${esc(s.sender.taxno)}` : ''}</div>
  </div>`;
}

/* ---------- Ansichten ---------- */
const V = {};
const unsaved = () => A.invoices.filter(i => !i.savedAt);
const backupAgeDays = () => A.lastBackup ? Math.floor((Date.now() - new Date(A.lastBackup.at)) / 864e5) : null;
const needsBackup = () => A.invoices.length > 0 && (A.dirty > 0 && (!A.lastBackup || backupAgeDays() >= 7 || A.dirty >= 5));

function banners() {
  let h = '';
  if (A.update) h += `<div class="banner info"><span><b>Neue Version der App verfügbar.</b> Deine Daten bleiben erhalten.</span><button class="btn small primary" data-act="applyUpdate">Jetzt aktualisieren</button></div>`;
  if (needsBackup()) h += `<div class="banner warn"><span><b>Datensicherung fällig.</b> ${A.dirty} Änderung${A.dirty === 1 ? '' : 'en'} seit ${A.lastBackup ? 'der letzten Sicherung (' + fmtDT(A.lastBackup.at) + ')' : 'Beginn'} noch nicht gesichert.</span><button class="btn small" data-act="backupNow">Jetzt sichern</button></div>`;
  return h;
}

V.install = () => `
  <div class="topbar"><span class="brand">Rechnungserstellung</span></div>
  <h1>Bitte zuerst auf den Home-Bildschirm legen</h1>
  <div class="card"><ol class="steps">
    <li>Oben in Safari auf das <b>Teilen-Symbol</b> tippen (Quadrat mit Pfeil nach oben).</li>
    <li><b>„Zum Home-Bildschirm“</b> wählen und <b>„Hinzufügen“</b> tippen.</li>
    <li>Safari schließen und die App über das neue Symbol <b>„Rechnungen“</b> öffnen.</li>
  </ol>
  <p class="fine">Wichtig: Die App speichert ihre Daten nur, wenn sie über das Symbol geöffnet wird. Safari und die App haben getrennte Speicher.</p></div>
  <button class="link" data-act="useBrowser">Trotzdem hier im Browser verwenden</button>`;

V.setup = () => {
  const s = A.settings, y = new Date().getFullYear(), f = (k, label, v, extra = '') => `<label>${label}<input data-set="${k}" value="${esc(v)}" ${extra}></label>`;
  return `<div class="topbar"><span class="brand">Rechnungserstellung</span></div>
  <h1>Einrichtung</h1>
  <p class="muted" style="margin:0">Einmal ausfüllen. Alle Angaben werden nur auf diesem Gerät gespeichert und lassen sich später unter Einstellungen ändern.</p>
  <section class="card"><h2>Rechnungsnummer</h2>
    <div class="g3"><label>Kürzel davor (optional)<input id="setup-prefix" value="${esc(s.prefix)}" placeholder="z. B. P" autocapitalize="characters" maxlength="6"></label><label>Letzte vergebene Nummer ${y} (nur die Zahl)<input id="setup-counter" inputmode="numeric" placeholder="z. B. 128" value="${esc(A.setupCounter)}"></label>
    <label>Erste Rechnung in der App<input id="setup-next" value="${fmtNo((parseInt(A.setupCounter, 10) || 0) + 1, y)}" disabled></label></div>
    <p class="fine">Bitte die zuletzt vergebene Nummer eintragen. Die App zählt lückenlos weiter.</p></section>
  <section class="card"><h2>Stundensatz</h2>
    <div class="g2"><label>Leistung<input data-rate="0" data-k="name" value="${esc(s.rates[0].name)}"></label><label>€ pro Stunde<input data-rate="0" data-k="rate" inputmode="decimal" placeholder="z. B. 85" value="${s.rates[0].rate ? dec(s.rates[0].rate) : ''}"></label></div></section>
  <section class="card"><h2>Umsatzsteuer-Hinweis</h2>${taxSeg()}<p class="fine">Mit dem Steuerberater abstimmen, lässt sich später ändern.</p></section>
  <section class="card"><h2>Absender</h2><div class="g2">${f('sender.name', 'Name', s.sender.name)}${f('sender.practice', 'Absenderzeile', s.sender.practice)}${f('sender.street', 'Straße und Nr.', s.sender.street)}${f('sender.city', 'PLZ und Ort', s.sender.city)}${f('sender.phone', 'Mobil', s.sender.phone)}${f('sender.mail', 'E-Mail', s.sender.mail)}</div></section>
  <section class="card"><h2>Bankverbindung</h2><div class="g2">${f('bank.owner', 'Kontoinhaberin', s.bank.owner)}${f('bank.bank', 'Bank', s.bank.bank)}${f('bank.iban', 'IBAN', s.bank.iban)}${f('bank.bic', 'BIC', s.bank.bic)}</div></section>
  ${logoSection()}
  <section class="card"><h2>Texte auf der Rechnung</h2>${textFields()}</section>
  ${mailSection()}
  <button class="btn primary big" data-act="finishSetup">Einrichtung abschließen</button>
  <section class="card"><h2>Neues iPad oder App neu installiert?</h2><p class="fine">Dann statt der Einrichtung die letzte Datensicherung laden. Alle Rechnungen, Klient:innen und Nummern sind danach wieder da.</p>
    <button class="btn" data-act="pickRestore">Datensicherung wiederherstellen</button></section>`;
};

V.start = () => {
  const now = new Date(), ym = iso(now).slice(0, 7);
  const mi = A.invoices.filter(i => i.issued.startsWith(ym));
  const open = A.invoices.filter(i => i.kind === 'rechnung' && i.status === 'ok' && !i.paidAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const r = A.settings.rates, rec = recentClients().slice(0, 6);
  return `${banners()}
  <div class="topbar"><span class="brand">Rechnungserstellung</span><span class="muted">${now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span></div>
  <div class="hero">
    <button class="newbtn" data-act="new"><span class="t">Neue Rechnung</span><span class="s">${r.length === 1 ? `${esc(r[0].name)} · ${eur(r[0].rate)} pro Stunde` : `${r.length} Leistungen hinterlegt`} · nächste Nr. ${peekNo(now.getFullYear())}</span></button>
    <div class="card"><h2>${MONTHS[now.getMonth()]} ${now.getFullYear()}</h2>
      <div class="month num"><div><b>${mi.filter(i => i.kind === 'rechnung').length}</b><span>Rechnungen</span></div><div><b>${eur(mi.reduce((a, i) => a + signed(i), 0))}</b><span>Umsatz</span></div><div><b>${open.length}</b><span>noch offen</span></div></div>
      <button class="btn" data-act="go" data-v="list">Alle Rechnungen ansehen</button></div>
  </div>
  <section class="stack"><h2>Zuletzt – antippen und Rechnung ist vorausgefüllt</h2>
    ${rec.length ? `<div class="recent">${rec.map(c => `<button class="rc" data-act="new" data-c="${c.id}"><b>${esc(fullName(c))}</b><span>${c.last ? 'zuletzt ' + fmtD(c.last) : 'noch keine Rechnung'}</span></button>`).join('')}</div>`
      : `<div class="empty">Hier erscheinen die Klient:innen, für die zuletzt eine Rechnung erstellt wurde. Leg die erste Person direkt beim Erstellen einer Rechnung an.</div>`}
  </section>
  ${open.length ? `<section class="card"><h2>Noch nicht bezahlt</h2><div class="inv-list">${open.slice(0, 6).map(rowHTML).join('')}</div></section>` : ''}`;
};

function recentClients() {
  const last = {};
  A.invoices.forEach(i => { const id = i.client.id; if (id && (!last[id] || last[id] < i.items[0].date)) last[id] = i.items[0].date; });
  return [...A.clients].sort((a, b) => (last[b.id] || '').localeCompare(last[a.id] || '') || a.name.localeCompare(b.name, 'de')).map(c => ({ ...c, last: last[c.id] }));
}
function matches(c, q) { q = q.trim().toLowerCase(); if (!q) return true; return [fullName(c), c.phone, c.mail, c.city].some(v => (v || '').toLowerCase().includes(q)); }

function freshDraft(cid) {
  const now = new Date(), m = Math.floor((now.getHours() * 60 + now.getMinutes()) / 15) * 15;
  return { clientId: cid || null, q: '', newClient: null, date: today(), from: fromMin(Math.max(0, m - 60)), to: fromMin(m), rateId: A.settings.rates[0].id };
}
function saveDraft() { if (A.D) ls.set('rechnung-draft', JSON.stringify({ day: today(), D: A.D })); }

V.new = () => {
  const rates = A.settings.rates;
  return `<div class="row"><button class="link" data-act="go" data-v="start">‹ Zurück</button></div>
  <h1>Neue Rechnung</h1>
  <div class="split">
    <div class="stack">
      <section class="card"><h2>Klient:in</h2><div id="clientBox" class="stack"></div></section>
      <section class="card"><h2>Termin</h2>
        <div class="g3"><label>Datum<input type="date" id="f-date" value="${A.D.date}"></label><label>Von<input type="time" id="f-from" value="${A.D.from}" step="300"></label><label>Bis<input type="time" id="f-to" value="${A.D.to}" step="300"></label></div>
        <div class="row"><span class="fine">Dauer:</span>${[45, 60, 90, 120].map(m => `<button class="chip" data-act="dur" data-m="${m}">${m} Min.</button>`).join('')}</div>
      </section>
      ${rates.length > 1 ? `<section class="card"><h2>Leistung</h2><div class="seg">${rates.map(r => `<button data-act="rate" data-r="${r.id}" aria-pressed="${A.D.rateId === r.id}"><b>${esc(r.name)}</b><small>${eur(r.rate)} / Std.</small></button>`).join('')}</div></section>` : ''}
      <div class="sum num" id="sum"></div>
      <button class="btn primary big" id="createBtn" data-act="create">Rechnung erstellen</button>
      <p class="fine">Nach dem Erstellen hat die Rechnung ihre feste Nummer und kann nicht mehr verändert werden. Fehler korrigierst du über „Stornieren“ und eine neue Rechnung.</p>
    </div>
    <div class="sticky"><div class="paper-wrap" id="preview"></div></div>
  </div>`;
};
function anredeSeg(pfx, val) {
  return `<div class="chips" role="group" aria-label="Anrede">${['Frau', 'Herr', 'Familie', ''].map(a => `<button class="chip" data-act="anrede" data-p="${pfx}" data-a="${a}" aria-pressed="${(val || '') === a}">${a || 'ohne Anrede'}</button>`).join('')}</div>`;
}
function clientFields(pfx, c) {
  return `${anredeSeg(pfx, c.anrede)}
    <label>Name (steht auf der Rechnung)<input id="${pfx}-name" value="${esc(c.name)}" autocomplete="off"></label>
    <div class="g2"><label>Straße und Nr. (optional)<input id="${pfx}-street" value="${esc(c.street)}" autocomplete="off"></label><label>PLZ und Ort (optional)<input id="${pfx}-city" value="${esc(c.city)}" autocomplete="off"></label></div>
    <div class="g2"><label>Handy (nur intern)<input id="${pfx}-phone" type="tel" value="${esc(c.phone)}" autocomplete="off"></label><label>E-Mail (nur intern)<input id="${pfx}-mail" type="email" value="${esc(c.mail)}" autocomplete="off"></label></div>`;
}
function clientBoxHTML() {
  const D = A.D;
  if (D.clientId) {
    const c = clientById(D.clientId);
    if (c) return `<div class="sel"><div><b>${esc(fullName(c))}</b><br><span class="muted">${esc(addr(c) || 'ohne Adresse')}</span></div><button class="btn small" data-act="clearClient">Ändern</button></div>`;
    D.clientId = null;
  }
  if (D.newClient) return `${clientFields('nc', D.newClient)}
      <div class="row"><button class="btn primary" data-act="saveNewClient">Übernehmen</button><button class="btn" data-act="cancelNewClient">Abbrechen</button></div>
      <p class="fine">Handy und E-Mail kommen nicht auf die Rechnung. Keine Gesprächsinhalte speichern. Die Adresse ist erst ab 250 € pro Rechnung Pflicht.</p>`;
  return `<input id="f-q" type="search" placeholder="Name, Handy oder E-Mail suchen …" value="${esc(D.q)}" autocomplete="off" aria-label="Klient:in suchen">
    <div class="results" id="results">${resultsHTML()}</div>
    <button class="btn" data-act="newClient">+ Neue:n Klient:in anlegen</button>`;
}
function resultsHTML() {
  const q = A.D.q.trim();
  const list = recentClients().filter(c => matches(c, q)).slice(0, q ? 30 : 5);
  if (!A.clients.length) return '<p class="fine">Noch keine Klient:innen gespeichert.</p>';
  if (!list.length) return '<p class="fine">Niemand gefunden. Lege die Person einfach neu an.</p>';
  return (q ? '' : '<span class="fine">Zuletzt</span>') + list.map(c => `<button class="rc" data-act="pick" data-c="${c.id}"><b>${esc(fullName(c))}</b><span>${esc([c.city, c.last ? 'zuletzt ' + fmtD(c.last) : ''].filter(Boolean).join(' · '))}</span></button>`).join('');
}
function updateNew() {
  const D = A.D; if (!D) return;
  const inv = buildInvoice(D);
  const ok = !!D.clientId && inv.items[0].billedMinutes > 0 && !!D.date;
  const raw = inv.items[0].minutes, billed = inv.items[0].billedMinutes;
  const sum = document.getElementById('sum'); if (!sum) return;
  sum.innerHTML = `<span class="muted">${raw ? `${raw} Min. Termin → ${billed} Min. abgerechnet` : 'Bitte Uhrzeit von–bis eintragen'}</span><span></span>
    <span class="big">${eur(inv.gross)}</span><span class="muted" style="align-self:end">Nr. ${inv.no}</span>`;
  document.getElementById('preview').innerHTML = paper(inv, { draft: true });
  document.getElementById('createBtn').disabled = !ok || A.busy;
  saveDraft();
}
function refreshClientBox() { const b = document.getElementById('clientBox'); if (b) { b.innerHTML = clientBoxHTML(); updateNew(); } }

V.done = () => {
  const i = A.invoices.find(x => x.id === A.lastId);
  if (!i) return V.start();
  return `<div class="card" style="background:var(--ok-soft);box-shadow:none"><h1 style="color:var(--ok)">${i.kind === 'storno' ? 'Stornorechnung' : 'Rechnung'} ${esc(i.no)} ist erstellt</h1>
    <div>${esc(fullName(i.client))} · ${fmtD(i.items[0].date)} · <b class="num">${eur(signed(i))}</b></div>
    <p class="fine" style="color:inherit">In der App gespeichert. Jetzt noch als PDF in „Dateien“ ablegen:</p>
    <div class="path">${esc(folderHint(i))} › ${esc(pdfName(i))}</div></div>
  <div class="split">
    <div class="stack">
      <button class="btn primary big" data-act="sharePdf" data-id="${i.id}">${i.savedAt ? 'Nochmal in Dateien sichern' : 'In Dateien sichern'}</button>
      <button class="btn big" data-act="mailPdf" data-id="${i.id}">Per E-Mail senden</button>
      ${i.savedAt ? '<p class="status-ok" style="margin:0">✓ PDF wurde gesichert</p>' : ''}
      <button class="btn big" data-act="new">Nächste Rechnung</button>
      <button class="link" data-act="go" data-v="start">Zur Startseite</button>
    </div>
    <div class="paper-wrap">${paper(i)}</div>
  </div>`;
};

const savedIcon = i => `<svg class="saved ${i.savedAt ? '' : 'no'}" viewBox="0 0 24 24" aria-label="${i.savedAt ? 'in Dateien gesichert' : 'noch nicht in Dateien gesichert'}"><path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z"/>${i.savedAt ? '<path d="M9.5 13.5l2 2 3.5-3.5"/>' : ''}</svg>`;
function rowHTML(i) {
  const pill = i.kind === 'storno' ? '<span class="pill void">Storno</span>' : i.status === 'storniert' ? '<span class="pill void">storniert</span>' : i.paidAt ? '<span class="pill paid">bezahlt</span>' : '<span class="pill open">offen</span>';
  return `<button class="inv num" data-act="open" data-id="${i.id}"><span class="no">${esc(i.no)}</span><span class="date muted">${fmtD(i.issued)}</span><span class="name">${esc(fullName(i.client))}</span><span class="amt">${eur(signed(i))}</span>${pill}${savedIcon(i)}</button>`;
}

V.list = () => {
  const years = [...new Set(A.invoices.map(i => +i.issued.slice(0, 4)).concat([new Date().getFullYear()]))].sort();
  let inv = A.invoices.filter(i => i.issued.startsWith(String(A.listYear)));
  const total = inv.reduce((a, i) => a + signed(i), 0);
  if (A.listFilter === 'open') inv = inv.filter(i => i.kind === 'rechnung' && i.status === 'ok' && !i.paidAt);
  if (A.listFilter === 'unsaved') inv = inv.filter(i => !i.savedAt);
  const byM = {}; inv.forEach(i => { const m = +i.issued.slice(5, 7); (byM[m] = byM[m] || []).push(i); });
  const nUnsaved = unsaved().length;
  return `${banners()}<div class="topbar"><h1>Rechnungen ${A.listYear}</h1><span class="num muted">Jahressumme <b style="color:var(--ink)">${eur(total)}</b></span></div>
  <div class="row" style="justify-content:space-between">
    <div class="chips">${years.map(y => `<button class="chip" data-act="year" data-y="${y}" aria-pressed="${y === A.listYear}">${y}</button>`).join('')}
      <span style="width:8px"></span>
      <button class="chip" data-act="filter" data-f="all" aria-pressed="${A.listFilter === 'all'}">Alle</button>
      <button class="chip" data-act="filter" data-f="open" aria-pressed="${A.listFilter === 'open'}">Nur offene</button>
      <button class="chip" data-act="filter" data-f="unsaved" aria-pressed="${A.listFilter === 'unsaved'}">Nicht gesichert${nUnsaved ? ` (${nUnsaved})` : ''}</button></div>
    <button class="btn" data-act="excel" data-y="${A.listYear}">Excel-Jahresübersicht</button>
  </div>
  ${Object.keys(byM).length ? Object.keys(byM).sort((a, b) => b - a).map(m => {
    const l = byM[m].sort((a, b) => b.seq - a.seq);
    return `<section class="card"><div class="mhead"><h3>${MONTHS[m - 1]}</h3><div class="row"><span class="muted num">${l.filter(i => i.kind === 'rechnung').length} Rechnung${l.length === 1 ? '' : 'en'} · ${eur(l.reduce((a, i) => a + signed(i), 0))}</span><button class="btn small" data-act="saveMonth" data-y="${A.listYear}" data-m="${m}">Monat sichern</button></div></div><div class="inv-list">${l.map(rowHTML).join('')}</div></section>`;
  }).join('') : `<div class="empty">Für ${A.listYear} gibt es ${A.listFilter === 'all' ? 'noch keine Rechnungen' : 'hier keine passenden Rechnungen'}.</div>`}
  <p class="fine">Das Wolken-Symbol zeigt, ob das PDF schon in „Dateien“ gesichert wurde. „Monat sichern“ legt alle PDFs des Monats, die Excel-Übersicht und eine Datensicherung auf einmal ab.</p>`;
};

V.clients = () => {
  const list = recentClients().filter(c => matches(c, A.clientQ));
  return `${banners()}<div class="topbar"><h1>Klient:innen</h1><button class="btn primary" data-act="editClient">+ Neu anlegen</button></div>
  <input id="c-q" type="search" placeholder="Name, Handy oder E-Mail suchen …" value="${esc(A.clientQ)}" aria-label="Klient:innen suchen">
  <section class="card"><div class="inv-list" id="clist">${clistHTML(list)}</div></section>
  <p class="fine">Name und Adresse stehen auf der Rechnung. Handy und E-Mail sind nur für dich und erscheinen nirgends sonst. Bei Paaren und Familien reicht ein:e Rechnungsempfänger:in.</p>`;
};
function clistHTML(list) {
  if (!A.clients.length) return '<p class="fine">Noch keine Klient:innen gespeichert.</p>';
  return list.map(c => `<button class="inv" style="grid-template-columns:1fr auto" data-act="editClient" data-c="${c.id}"><span class="name"><b>${esc(fullName(c))}</b><br><span class="muted">${esc([c.phone, c.mail].filter(Boolean).join(' · ') || addr(c) || 'keine weiteren Angaben')}</span></span><span class="muted num">${c.last ? 'zuletzt ' + fmtD(c.last) : ''}</span></button>`).join('') || '<p class="fine">Niemand gefunden.</p>';
}

V.backup = () => {
  const age = backupAgeDays(), n = unsaved().length;
  return `${banners()}<h1>Datensicherung</h1>
  <section class="card"><h2>Stand</h2>
    <dl class="kv">
      <dt>Letzte Sicherung</dt><dd>${A.lastBackup ? `${fmtDT(A.lastBackup.at)} <span class="muted">(${age === 0 ? 'heute' : 'vor ' + age + ' Tag' + (age === 1 ? '' : 'en')})</span>` : '<span class="status-warn">noch nie</span>'}</dd>
      <dt>Seitdem geändert</dt><dd>${A.dirty ? `<span class="status-warn">${A.dirty} Änderung${A.dirty === 1 ? '' : 'en'}</span>` : '<span class="status-ok">nichts – alles gesichert</span>'}</dd>
      <dt>PDFs nicht in Dateien</dt><dd>${n ? `<span class="status-warn">${n}</span>` : '<span class="status-ok">keine</span>'}</dd>
      <dt>In der App gespeichert</dt><dd>${A.invoices.length} Rechnungen, ${A.clients.length} Klient:innen</dd>
      <dt>Dauerhafter Speicher</dt><dd>${A.persisted ? '<span class="status-ok">vom iPad bestätigt</span>' : '<span class="status-warn">nicht bestätigt – umso wichtiger: regelmäßig sichern</span>'}</dd>
      <dt>App-Version</dt><dd>${esc(self.APP_VERSION)}</dd>
    </dl></section>
  <section class="card"><h2>Komplette Sicherung</h2>
    <p style="margin:0">Eine Datei mit allem: Einstellungen, Klient:innen, alle Rechnungen samt PDFs und Nummernstand. Damit lässt sich die App jederzeit vollständig wiederherstellen.</p>
    <button class="btn primary big" data-act="backupNow">Datensicherung in Dateien ablegen</button>
    <p class="fine">Empfohlener Ordner: <b>Rechnungen › Datensicherung</b>. Am besten einmal pro Woche oder nach jedem Arbeitstag.</p></section>
  <section class="card"><h2>Wiederherstellen</h2>
    <p style="margin:0">Lädt eine Sicherungsdatei. Vorhandene Rechnungen bleiben unverändert, fehlende werden ergänzt. Die Nummerierung macht beim höchsten Stand weiter.</p>
    <button class="btn" data-act="pickRestore">Sicherungsdatei auswählen</button></section>
  <section class="card"><h2>Wichtig</h2><ul class="steps">
    <li>Das App-Symbol auf dem Home-Bildschirm <b>nicht löschen</b>. Damit würde das iPad die gespeicherten Daten entfernen.</li>
    <li>Updates der App ändern nur das Programm. Die Daten bleiben erhalten.</li>
    <li>Bei einem neuen iPad: App einrichten, dann hier die letzte Sicherung laden.</li></ul></section>`;
};

/* ---------- E-Mail ---------- */
function greetingFor(c) {
  const w = (A.settings.mail.greetingWord || 'Guten Tag').trim(), last = (c.name || '').trim().split(/\s+/).pop();
  if (c.anrede === 'Frau' || c.anrede === 'Herr') return `${w} ${c.anrede} ${last},`;
  if (c.anrede === 'Familie') return `${w} Familie ${c.name},`;
  return c.name ? `${w} ${c.name},` : `${w},`;
}
function fillTpl(tpl, inv) {
  const v = { anrede: greetingFor(inv.client), name: fullName(inv.client), nummer: inv.no, betrag: eur(signed(inv)),
    datum: fmtD(inv.items[0].date), rechnungsdatum: fmtD(inv.issued), absender: A.settings.sender.name };
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
}
function mailSection() {
  const m = A.settings.mail;
  return `<section class="card"><h2>E-Mail-Vorlage</h2>
    <div class="g2"><label>Begrüßungswort<input data-set="mail.greetingWord" value="${esc(m.greetingWord)}"></label><label>Betreff<input data-set="mail.subject" value="${esc(m.subject)}"></label></div>
    <label>Text der E-Mail<textarea data-set="mail.body" style="min-height:260px">${esc(m.body)}</textarea></label>
    <p class="fine">Platzhalter: <b>{anrede}</b> wird zu „${esc(greetingFor({ anrede: 'Frau', name: 'Anna Muster' }))}“ bzw. „${esc(greetingFor({ anrede: 'Familie', name: 'Weber' }))}“, außerdem <b>{nummer}</b>, <b>{betrag}</b>, <b>{datum}</b> (Termin), <b>{name}</b> und <b>{absender}</b>. Links und Telefonnummern einfach als Text hineinschreiben.</p></section>`;
}
async function mailSheet(id) {
  const inv = A.invoices.find(x => x.id === id); if (!inv) return;
  if (!A.pdfCache.has(id)) { let b = await DB.getPdf(id); if (!b) { b = PDF.build(inv, A.logo); await DB.putPdfIfMissing(id, b); } A.pdfCache.set(id, b); }
  const c = clientById(inv.client.id) || {}, m = A.settings.mail, to = c.mail || '';
  sheet(`<div class="sheet-head"><h1>E-Mail an ${esc(fullName(inv.client))}</h1><button class="btn small" data-act="close">Schließen</button></div>
    <div class="card">
      <label>An${to ? '' : ' (noch keine Adresse gespeichert – hier eintragen, wird bei der Person gespeichert)'}<input id="m-to" type="email" value="${esc(to)}" autocomplete="off"></label>
      <label>Betreff<input id="m-subj" value="${esc(fillTpl(m.subject, inv))}"></label>
      <label>Text<textarea id="m-body" style="min-height:240px">${esc(fillTpl(m.body, inv))}</textarea></label>
      <div class="path">📎 ${esc(pdfName(inv))}</div>
      <div class="g2"><button class="btn big" data-act="copyMail">1. Adresse kopieren</button><button class="btn primary big" data-act="mailOpen" data-id="${id}">2. Mail mit Rechnung öffnen</button></div>
      <p class="fine">In Mail auf das Feld „An:“ tippen und „Einfügen“ wählen. Die Rechnung hängt schon an, der Text steht drin. Falls der Betreff leer ist, oben kopieren oder kurz eintippen.</p>
    </div>`);
  A.mailCtx = { id, clientId: inv.client.id, original: to };
}
function textFields() {
  const t = A.settings.texts, f = (k, label, v) => `<label>${label}<input data-set="texts.${k}" value="${esc(v)}"></label>`;
  return `${f('greeting', 'Anrede', t.greeting)}
    <label>Einleitung<textarea data-set="texts.intro">${esc(t.intro)}</textarea></label>
    <label>Satz vor der Bankverbindung<textarea data-set="texts.payText" style="min-height:80px">${esc(t.payText)}</textarea></label>
    <label>Grußformel<textarea data-set="texts.closing" style="min-height:80px">${esc(t.closing)}</textarea></label>
    <p class="fine">Zeilenumbrüche und Leerzeilen erscheinen genau so auf der Rechnung.</p>`;
}
function logoSection() {
  const l = A.logo;
  return `<section class="card"><h2>Logo (optional)</h2>
    ${l ? `<img class="logo-prev" src="${l.dataUrl}" alt="Aktuelles Logo">` : '<p class="fine">Noch kein Logo. Ohne Logo bleibt die Ecke oben rechts frei.</p>'}
    <div class="row"><button class="btn" data-act="pickLogo">${l ? 'Anderes Logo wählen' : 'Logo auswählen'}</button>
      ${l ? `<button class="btn" data-act="logoShadow" aria-pressed="${!!l.shadow}">${l.shadow ? 'Schatten: an' : 'Schatten: aus'}</button><button class="btn danger" data-act="removeLogo">Entfernen</button>` : ''}</div>
    <p class="fine">PNG oder JPG, am besten im Querformat. Es wird oben rechts auf jede neue Rechnung gesetzt und nur auf diesem Gerät gespeichert.</p></section>`;
}
async function setLogo(l) {
  await DB.setMeta('logo', l, { log: l ? 'logo-gesetzt' : 'logo-entfernt', dirty: A.setupDone });
  A.logo = l; if (A.setupDone) A.dirty = (await DB.getMeta('dirty')) || 0;
}
function readLogo(file) {
  return new Promise((res, rej) => {
    if (!file.type.startsWith('image/')) return rej(new Error('Bitte eine Bilddatei wählen.'));
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const max = 1200, sc = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * sc), h = Math.round(img.naturalHeight * sc);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const png = file.type === 'image/png' || file.type === 'image/gif' || file.type === 'image/webp';
      const ctx = c.getContext('2d'); if (!png) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
      ctx.drawImage(img, 0, 0, w, h); URL.revokeObjectURL(url);
      res({ dataUrl: png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9), format: png ? 'PNG' : 'JPEG', w, h, shadow: false });
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Das Bild konnte nicht gelesen werden.')); };
    img.src = url;
  });
}
function taxSeg() {
  const t = A.settings.taxMode;
  return `<div class="seg"><button data-act="tax" data-t="ku" aria-pressed="${t === 'ku'}"><b>Kleinunternehmerin</b><small>Hinweis auf § 19 UStG unter dem Betrag</small></button>
    <button data-act="tax" data-t="ust19" aria-pressed="${t === 'ust19'}"><b>Mit 19 % Umsatzsteuer</b><small>Stundensatz gilt als Nettobetrag</small></button>
    <button data-act="tax" data-t="none" aria-pressed="${t === 'none'}"><b>Kein Hinweis</b><small>kein Steuersatz-Hinweis auf der Rechnung</small></button></div>`;
}
V.settings = () => {
  const s = A.settings, y = new Date().getFullYear(), key = counterKey(y);
  const f = (k, label, v) => `<label>${label}<input data-set="${k}" value="${esc(v)}"></label>`;
  const counterLocked = A.invoices.some(i => i.counterKey === key);
  return `${banners()}<h1>Einstellungen</h1>
  <section class="card"><h2>Leistungen und Stundensätze</h2>
    ${s.rates.map((r, ix) => `<div class="rate-row"><label>Bezeichnung auf der Rechnung<input data-rate="${ix}" data-k="name" value="${esc(r.name)}"></label><label>€ pro Stunde<input data-rate="${ix}" data-k="rate" inputmode="decimal" value="${dec(r.rate)}"></label>${s.rates.length > 1 ? `<button class="btn small danger" data-act="delRate" data-i="${ix}">Entfernen</button>` : '<span></span>'}</div>`).join('')}
    <div class="row"><button class="btn" data-act="addRate">+ Weitere Leistung</button><span class="fine">Bei mehr als einer Leistung erscheint beim Erstellen eine Auswahl.</span></div>
    <div class="g2"><label>Abrechnung in Schritten von<select data-set="step">${[1, 5, 10, 15, 30].map(n => `<option value="${n}" ${s.step == n ? 'selected' : ''}>${n === 1 ? 'genau nach Minuten' : n + ' Minuten'}</option>`).join('')}</select></label>
      <label>Zahlungsfrist auf der Rechnung<select data-set="dueDays">${[0, 7, 14, 30].map(n => `<option value="${n}" ${s.dueDays == n ? 'selected' : ''}>${n ? n + ' Tage' : 'keine (wie bisher)'}</option>`).join('')}</select></label></div>
  </section>
  <section class="card"><h2>Rechnungsnummern</h2>
    <label>Kürzel vor der Nummer (optional, z. B. P → P115-${y})<input id="set-prefix" value="${esc(s.prefix || '')}" placeholder="kein Kürzel" autocapitalize="characters" maxlength="6"></label>
    <div class="g2"><label>Zuletzt vergebene Nummer${s.resetYearly ? ' ' + y : ''}<input id="set-counter" inputmode="numeric" value="${A.counters[key] || 0}" ${counterLocked ? 'disabled' : ''}></label><label>Nächste Rechnung bekommt<input id="set-next" value="${peekNo(y)}" disabled></label></div>
    <div class="seg"><button data-act="resetYearly" data-v="1" aria-pressed="${s.resetYearly}" ${A.invoices.length ? 'disabled' : ''}><b>Jedes Jahr neu ab 1</b><small>1-2027, 2-2027 …</small></button><button data-act="resetYearly" data-v="0" aria-pressed="${!s.resetYearly}" ${A.invoices.length ? 'disabled' : ''}><b>Durchlaufend</b><small>Nummer zählt über Jahre weiter</small></button></div>
    <p class="fine">${counterLocked ? 'Die Nummer ist gesperrt, weil schon Rechnungen damit erstellt wurden. So kann keine Nummer doppelt oder mit Lücke vergeben werden.' : 'Nur beim Einrichten ändern: die letzte Nummer aus der alten Vorlage eintragen.'}</p></section>
  <section class="card"><h2>Umsatzsteuer-Hinweis</h2>${taxSeg()}
    <p class="fine">Bitte mit dem Steuerberater abstimmen. Bereits erstellte Rechnungen ändern sich dadurch nicht.</p></section>
  ${logoSection()}
  <section class="card"><h2>Texte auf der Rechnung</h2>${textFields()}</section>
  ${mailSection()}
  <section class="card"><h2>Praxis und Absender</h2>
    <div class="g2">${f('sender.name', 'Name', s.sender.name)}${f('sender.practice', 'Absenderzeile', s.sender.practice)}${f('sender.street', 'Straße und Nr.', s.sender.street)}${f('sender.city', 'PLZ und Ort', s.sender.city)}${f('sender.phone', 'Mobil', s.sender.phone)}${f('sender.mail', 'E-Mail', s.sender.mail)}${f('sender.taxno', 'Steuernummer (optional, ab 250 € Pflicht)', s.sender.taxno)}</div></section>
  <section class="card"><h2>Bankverbindung</h2>
    <div class="g2">${f('bank.owner', 'Kontoinhaberin', s.bank.owner)}${f('bank.bank', 'Bank', s.bank.bank)}${f('bank.iban', 'IBAN', s.bank.iban)}${f('bank.bic', 'BIC', s.bank.bic)}</div></section>
  <p class="fine">Änderungen werden sofort gespeichert und gelten für neue Rechnungen. App-Version ${esc(self.APP_VERSION)}.</p>`;
};

/* ---------- Overlays ---------- */
function sheet(html) { A.sheetInvId = null; document.getElementById('sheetRoot').innerHTML = `<div class="sheet-bg" data-act="closeBg"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`; }
function closeSheet() { document.getElementById('sheetRoot').innerHTML = ''; A.clientEdit = null; A.sheetInvId = null; A.mailCtx = null; }
async function invSheet(id, confirm) {
  const i = A.invoices.find(x => x.id === id); if (!i) return;
  const storno = i.stornoId ? A.invoices.find(x => x.id === i.stornoId) : null;
  sheet(`<div class="sheet-head"><h1>${i.kind === 'storno' ? 'Storno ' : 'Rechnung '}${esc(i.no)}</h1><button class="btn small" data-act="close">Schließen</button></div>
    <div class="split"><div class="stack">
      <dl class="kv"><dt>Klient:in</dt><dd>${esc(fullName(i.client))}</dd><dt>Termin</dt><dd>${fmtD(i.items[0].date)}, ${esc(i.items[0].from)}–${esc(i.items[0].to)} Uhr</dd>
        <dt>Betrag</dt><dd class="num">${eur(signed(i))}</dd><dt>Erstellt</dt><dd>${fmtDT(i.createdAt)}</dd>
        <dt>In Dateien</dt><dd>${i.savedAt ? '<span class="status-ok">gesichert ' + fmtDT(i.savedAt) + '</span>' : '<span class="status-warn">noch nicht gesichert</span>'}</dd>
        ${i.paidAt ? `<dt>Bezahlt</dt><dd>${fmtD(i.paidAt)}</dd>` : ''}
        ${i.ref ? `<dt>Storniert</dt><dd>Rechnung ${esc(i.ref)}</dd>` : ''}${storno ? `<dt>Storno</dt><dd>${esc(storno.no)}</dd>` : ''}</dl>
      ${i.kind === 'rechnung' && i.status === 'ok' ? `<button class="btn big ${i.paidAt ? '' : 'primary'}" data-act="paid" data-id="${i.id}">${i.paidAt ? 'Doch noch offen' : 'Als bezahlt markieren'}</button>` : ''}
      <div class="g2"><button class="btn big" data-act="sharePdf" data-id="${i.id}">In Dateien sichern</button><button class="btn big" data-act="mailPdf" data-id="${i.id}">Per E-Mail senden</button></div>
      ${i.kind === 'rechnung' && i.status === 'ok' ? (confirm ? `<div class="confirm"><b>Rechnung ${esc(i.no)} wirklich stornieren?</b><span>Es entsteht eine Stornorechnung mit neuer Nummer. Die alte Rechnung bleibt erhalten und wird als storniert markiert.</span><div class="row"><button class="btn danger" data-act="doStorno" data-id="${i.id}">Ja, stornieren</button><button class="btn" data-act="open" data-id="${i.id}">Abbrechen</button></div></div>` : `<button class="btn danger" data-act="storno" data-id="${i.id}">Stornieren</button>`) : ''}
    </div><div class="paper-wrap">${paper(i)}</div></div>`);
  A.sheetInvId = id;
  if (!A.pdfCache.has(id)) { const b = await DB.getPdf(id); if (b) A.pdfCache.set(id, b); }
}
function clientSheet(id, confirmDel) {
  const c = id ? clientById(id) : { anrede: 'Frau', name: '', street: '', city: '', phone: '', mail: '' };
  if (!c) return;
  A.clientEdit = { id: id || null, anrede: c.anrede || '' };
  const invs = id ? A.invoices.filter(i => i.client.id === id).sort((a, b) => b.seq - a.seq) : [];
  sheet(`<div class="sheet-head"><h1>${id ? esc(fullName(c)) : 'Neue:r Klient:in'}</h1><button class="btn small" data-act="close">Schließen</button></div>
    <div class="card">${clientFields('ce', c)}
      <p class="fine">Änderungen gelten für neue Rechnungen. Erstellte Rechnungen behalten die damaligen Angaben.</p>
      <div class="row"><button class="btn primary" data-act="saveClient">Speichern</button>${id ? `<button class="btn" data-act="new" data-c="${id}">Rechnung erstellen</button>` : ''}
      ${id && !invs.length ? (confirmDel ? '' : `<button class="btn danger" data-act="delClient" data-c="${id}">Löschen</button>`) : ''}</div>
      ${confirmDel ? `<div class="confirm"><b>${esc(fullName(c))} wirklich löschen?</b><div class="row"><button class="btn danger" data-act="doDelClient" data-c="${id}">Ja, löschen</button><button class="btn" data-act="editClient" data-c="${id}">Abbrechen</button></div></div>` : ''}
    </div>
    ${invs.length ? `<section class="card"><h2>Rechnungen</h2><div class="inv-list">${invs.map(rowHTML).join('')}</div><p class="fine">Personen mit Rechnungen können wegen der Aufbewahrungspflicht nicht gelöscht werden.</p></section>` : ''}`);
}
function restoreSheet() {
  const r = A.restore;
  sheet(`<div class="sheet-head"><h1>Datensicherung laden</h1><button class="btn small" data-act="close">Schließen</button></div>
    <div class="card"><dl class="kv"><dt>Datei</dt><dd>${esc(r.name)}</dd><dt>Erstellt</dt><dd>${fmtDT(r.info.exportedAt)}</dd>
      <dt>Inhalt</dt><dd>${r.info.invoices} Rechnungen, ${r.info.clients} Klient:innen, ${r.info.pdfs} PDFs</dd><dt>Letzte Nummer</dt><dd>${esc(r.info.lastNo)}</dd></dl>
      <div class="confirm neutral"><b>Jetzt zusammenführen?</b><span>Bestehende Daten auf diesem iPad bleiben unverändert. Vorher wird automatisch eine interne Sicherheitskopie angelegt.</span>
      <div class="row"><button class="btn primary" data-act="doRestore">Wiederherstellen</button><button class="btn" data-act="close">Abbrechen</button></div></div></div>`);
}
function toast(msg, err) {
  const r = document.getElementById('toastRoot');
  r.innerHTML = `<div class="toast ${err ? 'err' : ''}" role="status">${esc(msg)}</div>`;
  clearTimeout(toast.t); toast.t = setTimeout(() => (r.innerHTML = ''), err ? 6000 : 3200);
}

/* ---------- Steuerung ---------- */
const tabOf = v => ({ start: 'start', new: 'start', done: 'start', list: 'list', clients: 'clients', backup: 'backup', settings: 'settings' })[v];
function render(scroll = true) {
  document.getElementById('main').innerHTML = V[A.view]();
  const tabs = document.getElementById('tabs');
  tabs.hidden = ['install', 'setup'].includes(A.view);
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-current', tabOf(A.view) === t.dataset.tab ? 'page' : 'false'));
  document.getElementById('backupDot').hidden = !needsBackup();
  if (A.view === 'new') { document.getElementById('clientBox').innerHTML = clientBoxHTML(); updateNew(); }
  if (scroll) window.scrollTo(0, 0);
}
function go(v) { closeSheet(); A.view = v; render(); }

/* Einstellungen speichern (verzögert, aber spätestens beim Verlassen) */
let settingsTimer = null;
function saveSettingsSoon() { clearTimeout(settingsTimer); settingsTimer = setTimeout(saveSettingsNow, 500); }
async function saveSettingsNow() {
  clearTimeout(settingsTimer); settingsTimer = null;
  if (!A.setupDone) return;
  try { await DB.setMeta('settings', clone(A.settings)); A.dirty = (await DB.getMeta('dirty')) || 0; }
  catch (e) { toast('Einstellungen nicht gespeichert: ' + e.message, true); }
}
addEventListener('pagehide', () => { if (settingsTimer) saveSettingsNow(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && settingsTimer) saveSettingsNow(); });

async function saveMailToClient(v) {
  const ctx = A.mailCtx; if (!ctx || !v || v === ctx.original || !ctx.clientId) return;
  const c = clientById(ctx.clientId); if (!c || c.mail === v) return;
  const upd = Object.assign(clone(c), { mail: v, updatedAt: new Date().toISOString() });
  try { await DB.putClient(upd); Object.assign(c, upd); ctx.original = v; A.dirty++; } catch (e) { toast('Adresse nicht gespeichert: ' + e.message, true); }
}
function readClientForm(pfx, anrede) {
  const v = k => (document.getElementById(`${pfx}-${k}`)?.value || '').trim();
  return { anrede, name: v('name'), street: v('street'), city: v('city'), phone: v('phone'), mail: v('mail') };
}

const actions = {
  go: el => go(el.dataset.v),
  new: el => {
    const d = el.dataset.c ? null : JSON.parse(ls.get('rechnung-draft') || 'null');
    A.D = d && d.day === today() && !el.dataset.c ? Object.assign(freshDraft(), d.D) : freshDraft(el.dataset.c);
    if (A.D.newClient === undefined) A.D.newClient = null;
    go('new');
  },
  pick: el => { A.D.clientId = el.dataset.c; refreshClientBox(); },
  clearClient: () => { A.D.clientId = null; A.D.q = ''; refreshClientBox(); setTimeout(() => document.getElementById('f-q')?.focus(), 0); },
  newClient: () => { A.D.newClient = { anrede: 'Frau', name: A.D.q, street: '', city: '', phone: '', mail: '' }; refreshClientBox(); setTimeout(() => document.getElementById('nc-name')?.focus(), 0); },
  cancelNewClient: () => { A.D.newClient = null; refreshClientBox(); },
  saveNewClient: async () => {
    const c = Object.assign({ id: uid(), createdAt: new Date().toISOString() }, readClientForm('nc', A.D.newClient.anrede));
    if (!c.name) return toast('Bitte einen Namen eintragen.', true);
    await DB.putClient(c); A.clients.push(c); A.D.clientId = c.id; A.D.newClient = null; A.dirty++;
    refreshClientBox();
  },
  anrede: el => {
    const a = el.dataset.a;
    if (el.dataset.p === 'nc') A.D.newClient.anrede = a; else if (A.clientEdit) A.clientEdit.anrede = a;
    el.parentElement.querySelectorAll('.chip').forEach(b => b.setAttribute('aria-pressed', b === el));
  },
  dur: el => { const f = toMin(A.D.from); if (f != null) { A.D.to = fromMin(f + +el.dataset.m); document.getElementById('f-to').value = A.D.to; updateNew(); } },
  rate: el => { A.D.rateId = el.dataset.r; render(false); },
  create: async () => {
    if (A.busy) return;
    const D = A.D, c = clientById(D.clientId);
    if (!c || !calc(D.from, D.to).billed) return toast('Bitte Klient:in und Uhrzeit angeben.', true);
    A.busy = true; document.getElementById('createBtn').disabled = true;
    try {
      const { inv, bytes } = await persistNew(() => buildInvoice(D));
      A.lastId = inv.id; A.lastBytes = bytes; A.D = null; ls.del('rechnung-draft');
      go('done');
    } catch (e) { toast('Rechnung nicht erstellt: ' + e.message, true); }
    finally { A.busy = false; const b = document.getElementById('createBtn'); if (b) updateNew(); }
  },
  sharePdf: el => {
    const id = el.dataset.id, inv = A.invoices.find(i => i.id === id), bytes = A.pdfCache.get(id);
    if (!inv) return;
    const done = async () => { await markSaved([id]); if (A.sheetInvId === id) { render(false); invSheet(id); } else if (!A.sheetInvId && !A.pending) render(false); toast('PDF gesichert.'); };
    if (bytes) return shareFiles([pdfFile(inv, bytes)], done);
    prepareShare('PDF ' + inv.no, `Ordner: <b>${esc(folderHint(inv))}</b>`, async () => {
      let b = await DB.getPdf(id);
      if (!b) { b = PDF.build(inv, A.logo); await DB.putPdfIfMissing(id, b); }
      A.pdfCache.set(id, b); return [pdfFile(inv, b)];
    }, done);
  },
  sharePending: () => { const p = A.pending; if (!p) return; A.pending = null; closeSheet(); shareFiles(p.files, p.onDone); },
  open: el => invSheet(el.dataset.id),
  paid: async el => {
    const i = A.invoices.find(x => x.id === el.dataset.id);
    const v = i.paidAt ? null : today();
    try { await DB.updateInvoiceStatus(i.id, { paidAt: v }, v ? 'bezahlt' : 'wieder-offen'); i.paidAt = v; A.dirty++; render(false); invSheet(i.id); toast(v ? 'Als bezahlt markiert.' : 'Wieder als offen markiert.'); }
    catch (e) { toast(e.message, true); }
  },
  storno: el => invSheet(el.dataset.id, true),
  doStorno: async el => {
    if (A.busy) return; A.busy = true;
    const orig = A.invoices.find(x => x.id === el.dataset.id);
    try {
      const { inv } = await persistNew(() => buildStorno(orig), s => Object.assign(clone(orig), { status: 'storniert', stornoNo: s.no, stornoId: s.id }));
      closeSheet(); A.lastId = inv.id; go('done'); toast(`Stornorechnung ${inv.no} erstellt.`);
    } catch (e) { toast('Storno nicht möglich: ' + e.message, true); }
    finally { A.busy = false; }
  },
  year: el => { A.listYear = +el.dataset.y; render(false); },
  filter: el => { A.listFilter = el.dataset.f; render(false); },
  excel: el => {
    const y = +el.dataset.y;
    prepareShare(`Excel-Übersicht ${y}`, `Ordner: <b>Rechnungen › ${y}</b>`, async () =>
      [new File([EXPORT.yearWorkbook(y, A.invoices, A.settings)], `Rechnungsuebersicht_${y}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })]);
  },
  saveMonth: el => {
    const y = +el.dataset.y, m = +el.dataset.m, ym = `${y}-${pad(m)}`;
    const list = A.invoices.filter(i => i.issued.startsWith(ym)).sort((a, b) => a.seq - b.seq);
    prepareShare(`${MONTHS[m - 1]} ${y} sichern`, `Ordner: <b>Rechnungen › ${y} › ${pad(m)} ${MONTHS[m - 1]}</b>. Alle Dateien landen zusammen in diesem Ordner.`, async () => {
      const files = [];
      for (const i of list) { let b = A.pdfCache.get(i.id) || await DB.getPdf(i.id); if (!b) { b = PDF.build(i, A.logo); await DB.putPdfIfMissing(i.id, b); } files.push(pdfFile(i, b)); }
      files.push(new File([EXPORT.yearWorkbook(y, A.invoices, A.settings)], `Rechnungsuebersicht_${y}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      files.push(await backupFile());
      return files;
    }, async () => { await markSaved(list.map(i => i.id)); await markBackupDone(A.invoices.length); render(false); toast('Monat gesichert.'); });
  },
  backupNow: () => prepareShare('Datensicherung', 'Ordner: <b>Rechnungen › Datensicherung</b>', async () => [await backupFile()],
    async () => { await markBackupDone(A.invoices.length); render(false); toast('Datensicherung abgelegt.'); }),
  pickRestore: () => { const inp = document.getElementById('restoreInput'); inp.value = ''; inp.click(); },
  doRestore: async () => {
    const r = A.restore; if (!r) return;
    try {
      const added = await DB.importBackup(r.data);
      if (!A.setupDone) { await DB.setMeta('setupDone', true, { dirty: false }); }
      await loadAll(); A.setupDone = true; A.restore = null; closeSheet(); go('start');
      toast(`Wiederhergestellt: ${added.invoices} Rechnungen, ${added.clients} Klient:innen ergänzt.`);
    } catch (e) { closeSheet(); toast(e.message, true); }
  },
  editClient: el => clientSheet(el.dataset.c),
  saveClient: async () => {
    const e = A.clientEdit; const f = readClientForm('ce', e.anrede);
    if (!f.name) return toast('Bitte einen Namen eintragen.', true);
    const c = e.id ? Object.assign(clone(clientById(e.id)), f, { updatedAt: new Date().toISOString() }) : Object.assign({ id: uid(), createdAt: new Date().toISOString() }, f);
    try {
      await DB.putClient(c);
      const ix = A.clients.findIndex(x => x.id === c.id); if (ix >= 0) A.clients[ix] = c; else A.clients.push(c);
      A.dirty++; closeSheet(); render(false); toast('Gespeichert.');
    } catch (err) { toast('Nicht gespeichert: ' + err.message, true); }
  },
  delClient: el => clientSheet(el.dataset.c, true),
  doDelClient: async el => {
    try { await DB.deleteClient(el.dataset.c); A.clients = A.clients.filter(c => c.id !== el.dataset.c); A.dirty++; closeSheet(); render(false); toast('Gelöscht.'); }
    catch (e) { toast(e.message, true); }
  },
  tax: el => { A.settings.taxMode = el.dataset.t; saveSettingsNow(); render(false); },
  resetYearly: el => { if (A.invoices.length) return; A.settings.resetYearly = el.dataset.v === '1'; saveSettingsNow(); render(false); },
  addRate: () => { A.settings.rates.push({ id: uid(), name: 'Neue Leistung', rate: A.settings.rates[0].rate }); saveSettingsNow(); render(false); },
  delRate: el => { A.settings.rates.splice(+el.dataset.i, 1); saveSettingsNow(); render(false); },
  finishSetup: async () => {
    const n = parseInt(A.setupCounter, 10);
    const s = A.settings, miss = [];
    if (!s.sender.name.trim()) miss.push('Name'); if (!s.sender.street.trim() || !s.sender.city.trim()) miss.push('Adresse');
    if (!s.bank.iban.trim()) miss.push('IBAN'); if (!(s.rates[0].rate > 0)) miss.push('Stundensatz');
    if (miss.length) return toast('Bitte noch ausfüllen: ' + miss.join(', ') + '.', true);
    if (A.setupCounter !== '' && (isNaN(n) || n < 0)) return toast('Bitte eine gültige Nummer eintragen.', true);
    try {
      await DB.setMeta('settings', clone(A.settings), { dirty: false });
      const counters = (await DB.getMeta('counters')) || {};
      const key = counterKey(new Date().getFullYear());
      if (!A.invoices.some(i => i.counterKey === key)) counters[key] = n || 0;
      await DB.setMeta('counters', counters, { dirty: false, log: 'einrichtung' });
      await DB.setMeta('setupDone', true, { dirty: false });
      A.counters = counters; A.setupDone = true; go('start');
      toast('Eingerichtet. Die nächste Rechnung bekommt Nr. ' + peekNo(new Date().getFullYear()) + '.');
    } catch (e) { toast('Speichern fehlgeschlagen: ' + e.message, true); }
  },
  useBrowser: () => { try { sessionStorage.setItem('rechnung-browser', '1'); } catch (_) {} A.view = A.setupDone ? 'start' : 'setup'; render(); },
  applyUpdate: async () => { if (settingsTimer) await saveSettingsNow(); if (A.update) { A.updating = true; A.update.postMessage('skipWaiting'); } },
  pickLogo: () => { const i = document.getElementById('logoInput'); i.value = ''; i.click(); },
  logoShadow: async () => { await setLogo(Object.assign({}, A.logo, { shadow: !A.logo.shadow })); render(false); },
  removeLogo: async () => { await setLogo(null); render(false); toast('Logo entfernt.'); },
  mailPdf: el => mailSheet(el.dataset.id),
  copyMail: el => {
    const inp = document.getElementById('m-to'), v = (inp?.value || '').trim();
    if (!v) { toast('Bitte zuerst eine E-Mail-Adresse eintragen.', true); inp?.focus(); return; }
    const ok = () => { el.textContent = '✓ Adresse kopiert'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(ok, () => { inp.select(); toast('Bitte die Adresse markieren und kopieren.', true); });
    else { inp.select(); document.execCommand && document.execCommand('copy'); ok(); }
    saveMailToClient(v);
  },
  mailOpen: el => {
    const inv = A.invoices.find(x => x.id === el.dataset.id), bytes = A.pdfCache.get(el.dataset.id);
    if (!inv || !bytes) return toast('Die Rechnung ist noch nicht bereit. Bitte noch einmal tippen.', true);
    const to = document.getElementById('m-to').value.trim(), subj = document.getElementById('m-subj').value, body = document.getElementById('m-body').value;
    const file = pdfFile(inv, bytes);
    saveMailToClient(to);
    if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      // Muss sofort im Tipp passieren (Apple-Vorgabe) – darum kein await davor.
      navigator.share({ files: [file], title: subj, text: body }).then(() => toast('Mail vorbereitet.'))
        .catch(e => { if (e.name !== 'AbortError') toast('Mail konnte nicht geöffnet werden: ' + e.message, true); });
    } else {
      // Laptop/Browser ohne Teilen: PDF herunterladen und Mailprogramm mit Adresse, Betreff und Text öffnen
      download(file);
      setTimeout(() => { location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`; }, 500);
      toast('PDF heruntergeladen – bitte in der Mail anhängen.');
    }
  },
  close: () => closeSheet(),
  closeBg: () => closeSheet()
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
  if (el.dataset.act === 'closeBg' && e.target !== el) return;
  const fn = actions[el.dataset.act];
  if (fn) Promise.resolve(fn(el)).catch(err => toast(err.message || String(err), true));
});

document.addEventListener('input', e => {
  const t = e.target;
  if (A.view === 'new' && A.D) {
    if (t.id === 'f-q') { A.D.q = t.value; document.getElementById('results').innerHTML = resultsHTML(); return; }
    if (t.id === 'f-date') { A.D.date = t.value || today(); updateNew(); return; }
    if (t.id === 'f-from') { A.D.from = t.value; updateNew(); return; }
    if (t.id === 'f-to') { A.D.to = t.value; updateNew(); return; }
    if (t.id && t.id.startsWith('nc-') && A.D.newClient) { A.D.newClient[t.id.slice(3)] = t.value; return; }
  }
  if (t.id === 'c-q') { A.clientQ = t.value; document.getElementById('clist').innerHTML = clistHTML(recentClients().filter(c => matches(c, A.clientQ))); return; }
  if (t.id === 'setup-prefix' || t.id === 'set-prefix') {
    A.settings.prefix = cleanPrefix(t.value);
    const nx = document.getElementById(t.id === 'setup-prefix' ? 'setup-next' : 'set-next');
    if (nx) nx.value = t.id === 'setup-prefix' ? fmtNo((parseInt(A.setupCounter, 10) || 0) + 1, new Date().getFullYear()) : peekNo(new Date().getFullYear());
    saveSettingsSoon(); return;
  }
  if (t.id === 'setup-counter') { A.setupCounter = t.value.trim(); document.getElementById('setup-next').value = fmtNo((parseInt(A.setupCounter, 10) || 0) + 1, new Date().getFullYear()); return; }
  if (t.id === 'set-counter') {
    const n = parseInt(t.value, 10), y = new Date().getFullYear(), key = counterKey(y);
    if (isNaN(n) || n < 0 || A.invoices.some(i => i.counterKey === key)) return;
    A.counters[key] = n;
    DB.setMeta('counters', clone(A.counters), { log: 'zaehler-geaendert' }).catch(err => toast(err.message, true));
    document.getElementById('set-next').value = peekNo(y); return;
  }
  if (t.dataset.set) {
    const [a, b] = t.dataset.set.split('.');
    const val = ['step', 'dueDays'].includes(a) ? +t.value : t.value;
    if (b) A.settings[a][b] = val; else A.settings[a] = val;
    saveSettingsSoon(); return;
  }
  if (t.dataset.rate != null) {
    const r = A.settings.rates[+t.dataset.rate];
    if (t.dataset.k === 'rate') { const n = parseFloat(t.value.replace(/\./g, '').replace(',', '.')); if (!isNaN(n) && n >= 0) r.rate = n; }
    else r.name = t.value;
    saveSettingsSoon();
  }
});
document.addEventListener('change', e => { if (e.target.tagName === 'SELECT' && e.target.dataset.set) saveSettingsNow(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

document.getElementById('logoInput').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  try { await setLogo(await readLogo(f)); render(false); toast('Logo gespeichert.'); } catch (err) { toast(err.message, true); }
});
document.getElementById('restoreInput').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const info = DB.validateBackup(data);
    A.restore = { name: f.name, data, info }; restoreSheet();
  } catch (err) { toast(err instanceof SyntaxError ? 'Die Datei ist beschädigt oder keine Datensicherung.' : err.message, true); }
});

/* ---------- Updates ---------- */
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    const show = w => { A.update = w; if (!['new', 'setup'].includes(A.view)) render(false); };
    if (reg.waiting && navigator.serviceWorker.controller) show(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing; if (!w) return;
      w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) show(w); });
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
  let reloading = false;
  // Nur neu laden, wenn das Update ausdrücklich angetippt wurde – nie mitten in der Arbeit.
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading || !A.updating) return; reloading = true; location.reload(); });
}

/* ---------- Start ---------- */
async function boot() {
  try {
    await DB.open();
    await migrate();
    await loadAll();
  } catch (e) {
    document.getElementById('main').innerHTML = `<h1>Die App konnte nicht starten</h1><div class="banner danger">${esc(e.message || e)}</div><p class="fine">Die gespeicherten Daten sind dadurch nicht verloren. Bitte die App schließen und neu öffnen.</p>`;
    return;
  }
  A.persisted = await DB.persist();
  registerSW();
  let browserOk = false; try { browserOk = sessionStorage.getItem('rechnung-browser') === '1'; } catch (_) {}
  if (isIOS && !standalone() && !browserOk && !A.invoices.length) A.view = 'install';
  else A.view = A.setupDone ? 'start' : 'setup';
  render();
}
boot();
