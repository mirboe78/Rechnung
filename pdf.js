/* Rechnungserstellung – PDF im Briefformat (A4, mm) */
const PDF = (() => {

  const dec = n => new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const eurT = n => dec(n) + '€';                         // Schreibweise wie in der Vorlage: 85,00€
  const hrs = m => new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(m / 60);
  const rateT = r => (Number.isInteger(r) ? String(r) : dec(r));
  const fmtD = s => { const [y, m, d] = s.split('-'); return `${d}.${m}.${y}`; };
  const addDays = (s, n) => { const d = new Date(s + 'T12:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

  const senderLine = s => [s.practice || s.name, s.street, s.city].filter(Boolean).join(' – ');
  const footerText = s => [s.name, s.street, s.city, s.phone ? 'Mobil: ' + s.phone : '', s.mail].filter(Boolean).join(' - ');

  /* Satz vor der Bankverbindung: mit Zahlungsfrist die Variante mit {frist}, sonst die ohne.
   * Ältere Rechnungen ohne zweite Variante behalten die frühere Schreibweise. */
  function payLine(texts, inv) {
    if (!inv.dueDays) return texts.payText || '';
    const d = fmtD(addDays(inv.issued, inv.dueDays));
    if (texts.payTextDue) return texts.payTextDue.replace(/\{frist\}/g, d);
    return (texts.payText || '') + ` Bitte bis zum ${d}.`;
  }
  /* Leere Zeilen weglassen; Kontoinhaber fällt auf den Absendernamen zurück */
  const bankRows = s => [['Kontoinhaber:', s.bank.owner || s.sender.name], ['IBAN:', s.bank.iban], ['BIC:', s.bank.bic], ['Bank:', s.bank.bank]].filter(([, v]) => v && String(v).trim());

  function recipientLines(c) {
    const l = [];
    if (c.anrede === 'Familie') l.push('Familie ' + c.name);
    else { if (c.anrede) l.push(c.anrede); l.push(c.name); }
    if (c.street) l.push(c.street);
    if (c.city) l.push(c.city);
    return l;
  }

  /* inv enthält alles Nötige inkl. snap (Absender, Bank, Texte zum Erstellungszeitpunkt) */
  /* logo: { dataUrl, format, w, h, shadow } aus den Einstellungen oder null */
  function build(inv, logo) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const s = inv.snap, storno = inv.kind === 'storno', sign = storno ? -1 : 1;
    const L = 15, W = 175, C2 = 71, C3 = 99, LH = 5.2;
    doc.setProperties({ title: `${storno ? 'Stornorechnung' : 'Rechnung'} ${inv.no}`, author: s.sender.name, creator: 'Rechnungserstellung ' + (inv.appVersion || '') });
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(26, 26, 26);
    doc.setLineHeightFactor(LH / (11 * 0.3528));   // Zeilenabstand mehrzeiliger Texte = Abstand der Einzelzeilen

    // Logo oben rechts, eingepasst in 76 x 31 mm (optional mit weichem Schatten)
    if (logo && logo.dataUrl) {
      const boxW = 76, boxH = 31.1, right = 203, top = 5;
      const sc = Math.min(boxW / logo.w, boxH / logo.h), w = logo.w * sc, h = logo.h * sc, x = right - w, y = top;
      if (logo.shadow) {
        for (let i = 4; i >= 1; i--) {
          doc.setGState(new doc.GState({ opacity: 0.045 }));
          doc.setFillColor(0, 0, 0);
          doc.rect(x + 0.3 + i * 0.35, y + 0.9 + i * 0.45, w, h, 'F');
        }
        doc.setGState(new doc.GState({ opacity: 1 }));
      }
      doc.addImage(logo.dataUrl, logo.format || 'PNG', x, y, w, h);
    }

    // Absenderzeile (unterstrichen)
    doc.setFontSize(7);
    const sl = senderLine(s.sender);
    if (sl) {
      doc.text(sl, L, 46);
      doc.setLineWidth(0.15); doc.setDrawColor(26, 26, 26);
      doc.line(L, 46.6, L + doc.getTextWidth(sl), 46.6);
    }

    // Empfänger
    doc.setFontSize(11);
    let y = 51.5;
    for (const line of recipientLines(inv.client)) { doc.text(line, L, y); y += LH; }

    // Datum rechts
    y = Math.max(y + 6, 70);
    doc.text(`Datum ${fmtD(inv.issued)}`, 190, y, { align: 'right' });

    // Rechnungsnummer
    y = Math.max(y + 20, 93);
    doc.setFont('helvetica', 'bold');
    doc.text(`${storno ? 'Stornorechnung' : 'Rechnung'} Nr. ${inv.no}`, L, y);
    doc.setFont('helvetica', 'normal');
    y += 15;

    /* Absätze aus den Einstellungen übernehmen: jede Zeile einzeln umbrechen, Leerzeilen bleiben erhalten */
    const wrap = txt => String(txt || '').replace(/\r\n?/g, '\n').split('\n').flatMap(l => (l.trim() ? doc.splitTextToSize(l, W) : ['']));
    const para = (txt, gap = LH * 2) => { const lines = wrap(txt); doc.text(lines, L, y); y += lines.length * LH + (gap - LH); };
    if (storno) {
      para(s.texts.greeting);
      para(`hiermit storniere ich die Rechnung Nr. ${inv.ref} vom ${fmtD(inv.refIssued)}. Der unten stehende Betrag wird Ihnen gutgeschrieben.`);
    } else {
      para(s.texts.greeting);
      para(s.texts.intro);
    }

    // Positionen
    for (const it of inv.items) {
      doc.text(it.desc, L, y);
      doc.text(fmtD(it.date), C2, y);
      doc.text(`${eurT(sign * it.amount)} (${rateT(it.rate)} x ${hrs(it.billedMinutes)} Std.)`, C3, y);
      y += LH;
    }
    if (inv.taxMode === 'ust19') {
      doc.text('zzgl. 19 % USt.', L, y); doc.text(eurT(sign * inv.vat), C3, y); y += LH;
    }
    y += LH * 1.6;
    doc.setFont('helvetica', 'bold');
    doc.text(storno ? 'Gutschrift' : 'Gesamt', L, y);
    doc.text(eurT(sign * inv.gross), C3, y);
    doc.setFont('helvetica', 'normal');
    y += LH;
    if (inv.taxMode === 'ku') {
      doc.setFontSize(9); doc.setTextColor(90, 90, 90);
      doc.text('Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.', L, y + 0.8);
      doc.setFontSize(11); doc.setTextColor(26, 26, 26);
      y += LH;
    }
    y += LH;

    if (!storno) {
      para(payLine(s.texts, inv));
      for (const [k, v] of bankRows(s)) {
        doc.text(k, L, y); doc.text(v, C2, y); y += LH;
      }
      y += LH;
    }
    doc.text(wrap(s.texts.closing), L + 0.8, y);

    // Fußzeile
    doc.setFontSize(8);
    const foot = footerText(s.sender);
    if (foot) doc.text(foot, 105, 287, { align: 'center' });
    if (s.sender.taxno) doc.text(`Steuernummer: ${s.sender.taxno}`, 105, 291, { align: 'center' });

    return doc.output('arraybuffer');
  }

  return { build, recipientLines, footerText, senderLine, bankRows, payLine };
})();
