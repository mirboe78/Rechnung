# Rechnungserstellung – Einrichtung und Pflege

Eine Web-App, die nur auf dem iPad läuft. Im Code stehen **keine persönlichen Daten**: kein Name, keine Adresse, keine Bankverbindung, kein Logo.
Alles wird bei der Einrichtung auf dem Gerät eingetragen und bleibt dort.

## 1. Online stellen mit GitHub Pages

**Was ist das?** GitHub ist eine Plattform, auf der man Programmcode ablegt. *GitHub Pages* ist eine kostenlose Funktion,
die die Dateien eines Projekts als Website ausliefert, mit HTTPS. Das iPad lädt von dort einmal das Programm und arbeitet danach offline.
Hochgeladen wird **nur dieser Ordner**. Daten fließen nie zurück.

Schritte im Browser, ohne Programmierkenntnisse:
1. Auf github.com ein Konto anlegen. Tipp: einen **neutralen Benutzernamen** wählen, denn er steht später in der Adresse
   (`https://BENUTZERNAME.github.io/rechnungen/`).
2. Oben rechts **+ › New repository**. Name: `rechnungen`, Sichtbarkeit **Public** (Pages ist nur für öffentliche Projekte kostenlos), › *Create repository*.
3. Auf der neuen Seite **„uploading an existing file“** anklicken. Den **Inhalt** dieses Ordners hineinziehen (alle Dateien und die Ordner
   `icons` und `vendor`, nicht den Ordner selbst) › *Commit changes*.
4. **Settings › Pages**. Bei *Source* „Deploy from a branch“ wählen, Branch `main`, Ordner `/ (root)` › *Save*.
5. Nach 1–2 Minuten steht oben die Adresse der App. Diese Adresse auf dem iPad öffnen.

> **Die Adresse darf sich nie ändern** (Benutzername und Projektname nicht umbenennen). Das iPad bindet die gespeicherten Daten
> an die Adresse. Bei einer neuen Adresse startet die App leer, dann hilft nur die Datensicherung.

Niemals PDFs, Excel-Dateien oder Datensicherungen in das Projekt hochladen. Die mitgelieferte `.gitignore` blockiert das zusätzlich, wenn mit Git gearbeitet wird.

## 2. Auf dem iPad installieren

1. Die Adresse in **Safari** öffnen.
2. Teilen-Symbol › **Zum Home-Bildschirm** › Hinzufügen.
3. Safari schließen und die App über das neue Symbol **„Rechnungen“** öffnen.
4. Einrichtung: Name, Adresse, Bankverbindung, Stundensatz, **letzte bisher vergebene Rechnungsnummer** und optional das Logo eintragen.
5. In der App „Dateien“ einen Ordner **Rechnungen** mit dem Unterordner **Datensicherung** anlegen.
6. Eine Testrechnung erstellen, „In Dateien sichern“ tippen und den Ordner wählen. Danach die Testrechnung stornieren (Nummern dürfen nie gelöscht werden).

## 3. Alltag

- **Nach der Sitzung:** „Neue Rechnung“ › Person antippen oder anlegen › Uhrzeit › „Rechnung erstellen“ › „In Dateien sichern“.
- **Bezahlt:** Rechnung antippen › „Als bezahlt markieren“.
- **Fehler:** Rechnung antippen › „Stornieren“ und neu erstellen. Eine erstellte Rechnung lässt sich absichtlich nicht ändern.
- **Monatsende:** „Rechnungen“ › „Monat sichern“. Das legt alle PDFs, die Excel-Übersicht für den Steuerberater und eine Datensicherung auf einmal ab.
- **Datensicherung:** Ein gelber Hinweis erscheint, wenn gesichert werden sollte.

**Das App-Symbol nie löschen.** Damit löscht das iPad auch die Daten. Bei einem neuen iPad: App installieren › „Datensicherung wiederherstellen“.

## 4. Datenschutz – was wohin geht

| Was | Wo | Wer kann es sehen |
|---|---|---|
| Programmcode | GitHub Pages | Jeder mit dem Link. Enthält keine persönlichen Daten. |
| Klient:innen, Rechnungen, Einstellungen, Bankdaten, Logo | Nur in der App auf dem iPad | Nur wer das entsperrte iPad hat. |
| PDFs, Excel, Datensicherung | Dort, wo sie in „Dateien“ abgelegt werden | Bei iCloud: Apple. Mit „Erweitertem Datenschutz“ Ende-zu-Ende verschlüsselt. |
| Abruf des Programms | Server-Protokoll von GitHub | IP-Adresse und Uhrzeit des iPads. Keine Kundendaten. |

Technisch abgesichert und getestet:
- Keine Uploads, keine Statistik, keine Schriftarten oder Bibliotheken aus dem Internet.
- Eine Content-Security-Policy verbietet jede Verbindung zu fremden Servern. Gezielte Versuche (fetch, Beacon, Bild-Pixel) wurden alle blockiert.
- Eingaben werden nie als Code ausgeführt (mit einem Schadcode-Namen getestet).
- Wer den Link öffnet, sieht eine leere App. Suchmaschinen werden per `noindex` ausgeschlossen.

Empfehlungen:
- iPad mit Code bzw. Face ID sperren.
- In iCloud den **Erweiterten Datenschutz** einschalten (Einstellungen › Name › iCloud).
- Den Windows-Laptop mit BitLocker verschlüsseln, wenn dort Rechnungsdateien liegen.
- Handy und E-Mail von Klient:innen löschen, wenn sie nicht mehr gebraucht werden. Rechnungen selbst müssen 8 Jahre aufbewahrt werden.

## 5. Updates

1. Dateien ändern.
2. In `version.js` die Versionsnummer erhöhen. **Ohne diesen Schritt kommt das Update nicht an.**
3. Auf GitHub die geänderten Dateien erneut hochladen (*Add file › Upload files*, gleiche Namen überschreiben).
4. Auf dem iPad erscheint „Neue Version verfügbar – Jetzt aktualisieren“. Die Daten bleiben erhalten.

Regeln für Änderungen am Code:
- In `db.js` die Datenbank nur **erweitern**: `VERSION` erhöhen und mit `if (old < 2) { … }` nur Neues anlegen. Nie etwas löschen.
- Ändert sich das Format gespeicherter Daten: in `app.js` `SCHEMA` erhöhen und eine Funktion in `MIGRATIONS` ergänzen. Vorher wird automatisch ein Schnappschuss gespeichert.
- Vor größeren Updates auf dem iPad eine Datensicherung machen.

## Dateien und Lizenzen

| Datei | Inhalt |
|---|---|
| `index.html`, `styles.css`, `app.js` | Oberfläche |
| `db.js` | Datenbank, Nummernvergabe, Datensicherung |
| `pdf.js` | PDF im Briefformat |
| `export.js` | Excel-Jahresübersicht |
| `sw.js`, `manifest.webmanifest`, `version.js` | Offline-Betrieb, Home-Bildschirm, Updates |
| `vendor/` | jsPDF 2.5.1 (MIT-Lizenz) und SheetJS 0.18.5 (Apache-2.0), mit Lizenztexten. Sie werden nur zum Schreiben von PDF und Excel genutzt. |
