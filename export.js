/* Rechnungserstellung – Excel-Jahresübersicht (für Steuerberater) */
const EXPORT = (() => {
  const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const EUR = '#,##0.00 "€"';
  /* Excel-Datum als Seriennummer – unabhängig von Zeitzonen */
  const toDate = s => { const [y, m, d] = s.split('-').map(Number); return { t: 'n', v: (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5, z: 'dd.mm.yyyy' }; };
  const sign = i => (i.kind === 'storno' ? -1 : 1);
  const statusText = i => i.kind === 'storno' ? 'Storno' : i.status === 'storniert' ? 'storniert' : i.paidAt ? 'bezahlt' : 'offen';
  const clientName = c => (c.anrede === 'Familie' ? 'Familie ' : '') + c.name;

  const HEAD = ['Rechnungs-Nr.', 'Art', 'Rechnungsdatum', 'Leistungsdatum', 'Klient:in', 'Leistung', 'Von', 'Bis', 'Minuten', 'Stunden', 'Satz €/Std.', 'Netto', 'USt.', 'Brutto', 'Status', 'Bezahlt am', 'Bezug'];
  const WIDTHS = [14, 13, 14, 14, 26, 22, 7, 7, 9, 9, 11, 12, 10, 12, 10, 12, 13];

  function rowsFor(list) {
    return list.map(i => {
      const it = i.items[0], s = sign(i);
      return [i.no, i.kind === 'storno' ? 'Stornorechnung' : 'Rechnung', toDate(i.issued), toDate(it.date), clientName(i.client), it.desc,
        it.from || '', it.to || '', s * it.billedMinutes, s * it.billedMinutes / 60, it.rate, s * i.net, s * i.vat, s * i.gross,
        statusText(i), i.paidAt ? toDate(i.paidAt) : '', i.ref || ''];
    });
  }
  function listSheet(XLSX, list) {
    const ws = XLSX.utils.aoa_to_sheet([HEAD, ...rowsFor(list)]);
    const n = list.length;
    for (let r = 1; r <= n; r++) {
      for (const c of [10, 11, 12, 13]) { const a = XLSX.utils.encode_cell({ r, c }); if (ws[a]) ws[a].z = EUR; }
      const h = XLSX.utils.encode_cell({ r, c: 9 }); if (ws[h]) ws[h].z = '0.00';
    }
    if (n) {
      const r = n + 1, col = c => XLSX.utils.encode_col(c);
      XLSX.utils.sheet_add_aoa(ws, [['Summe']], { origin: { r, c: 0 } });
      for (const c of [8, 9, 11, 12, 13]) {
        ws[XLSX.utils.encode_cell({ r, c })] = { t: 'n', f: `SUM(${col(c)}2:${col(c)}${n + 1})`, z: c >= 11 ? EUR : (c === 9 ? '0.00' : '0') };
      }
      ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r, c: HEAD.length - 1 } });
    }
    ws['!cols'] = WIDTHS.map(w => ({ wch: w }));
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(n, 1), c: HEAD.length - 1 } }) };
    return ws;
  }

  function yearWorkbook(year, invoices, settings) {
    const XLSX = window.XLSX;
    const wb = XLSX.utils.book_new();
    const inYear = invoices.filter(i => i.issued.startsWith(String(year))).sort((a, b) => a.issued.localeCompare(b.issued) || a.seq - b.seq);
    const month = i => +i.issued.slice(5, 7);

    // Blatt 1: Übersicht nach Monaten
    const head = ['Monat', 'Rechnungen', 'Stornos', 'Stunden', 'Netto', 'USt.', 'Brutto', 'davon bezahlt', 'davon offen'];
    const rows = MONTHS.map((m, ix) => {
      const l = inYear.filter(i => month(i) === ix + 1);
      const reg = l.filter(i => i.kind !== 'storno');
      const sum = k => l.reduce((a, i) => a + sign(i) * i[k], 0);
      return [m, reg.length, l.length - reg.length, l.reduce((a, i) => a + sign(i) * i.items[0].billedMinutes / 60, 0), sum('net'), sum('vat'), sum('gross'),
        reg.filter(i => i.status !== 'storniert' && i.paidAt).reduce((a, i) => a + i.gross, 0),
        reg.filter(i => i.status !== 'storniert' && !i.paidAt).reduce((a, i) => a + i.gross, 0)];
    });
    const title = [[`Rechnungsübersicht ${year}`], [[settings.sender.name, settings.sender.street, settings.sender.city, settings.sender.taxno ? 'Steuernr. ' + settings.sender.taxno : ''].filter(Boolean).join(', ')], [`Stand: ${new Date().toLocaleDateString('de-DE')}`], []];
    const ws = XLSX.utils.aoa_to_sheet([...title, head, ...rows]);
    const top = title.length; // Zeile der Überschrift (0-basiert)
    const col = c => XLSX.utils.encode_col(c);
    const tr = top + 13;
    ws[XLSX.utils.encode_cell({ r: tr, c: 0 })] = { t: 's', v: `Gesamt ${year}` };
    for (let c = 1; c < head.length; c++) ws[XLSX.utils.encode_cell({ r: tr, c })] = { t: 'n', f: `SUM(${col(c)}${top + 2}:${col(c)}${top + 13})` };
    for (let r = top + 1; r <= tr; r++) {
      for (let c = 4; c < head.length; c++) { const a = XLSX.utils.encode_cell({ r, c }); if (ws[a]) ws[a].z = EUR; }
      const h = XLSX.utils.encode_cell({ r, c: 3 }); if (ws[h]) ws[h].z = '0.00';
    }
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: tr, c: head.length - 1 } });
    ws['!cols'] = [16, 11, 9, 9, 13, 11, 13, 14, 13].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, `Übersicht ${year}`);

    // Blatt 2: alle Rechnungen des Jahres
    XLSX.utils.book_append_sheet(wb, listSheet(XLSX, inYear), 'Alle Rechnungen');

    // Ein Blatt pro Monat mit Rechnungen
    MONTHS.forEach((m, ix) => {
      const l = inYear.filter(i => month(i) === ix + 1);
      if (l.length) XLSX.utils.book_append_sheet(wb, listSheet(XLSX, l), `${String(ix + 1).padStart(2, '0')} ${m}`);
    });
    return XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
  }

  return { yearWorkbook, MONTHS };
})();
