# Vorschläge aus Codebasis-Review

## 1) Aufgabe: Tippfehler/Versionsangabe im Seitentitel korrigieren
**Fund:** In `index.html` steht im statischen `<title>` noch `Wochenplan V9`, während die App-Version zentral in `version.js` als `V9.2` gepflegt wird.

**Risiko/Nutzen:** Nutzer sehen je nach Stelle unterschiedliche Versionsstände (Browser-Tab vs. App-Header), was zu Verwirrung bei Fehlermeldungen und Support führen kann.

**Vorschlag:**
- Entweder den statischen Titel in `index.html` auf den aktuellen Stand bringen,
- oder den statischen Titel auf einen neutralen Wert setzen und nur noch per `APP_META` setzen lassen.

**Akzeptanzkriterien:**
- Browser-Tab und App-Header zeigen denselben Versionsstand.
- Es gibt nur noch eine zentrale Quelle für die sichtbare Version.

---

## 2) Aufgabe: Programmierfehler im Service Worker (Offline-Fähigkeit) beheben
**Fund:** `sw.js` cached nur einen Teil der JavaScript-Dateien. Mehrere Laufzeit-Abhängigkeiten (z. B. Utility-Module) fehlen in `APP_FILES`.

**Risiko/Nutzen:** Bei Offline-Nutzung kann die App trotz gecachtem `index.html` nicht vollständig starten (fehlende Skripte/`ReferenceError`).

**Vorschlag:**
- `APP_FILES` vollständig um alle lokal geladenen JS-Dateien ergänzen,
- optional Build-/Lint-Check ergänzen, der sicherstellt, dass alle in `index.html` referenzierten lokalen Assets im Precache enthalten sind.

**Akzeptanzkriterien:**
- Vollständiger Erstaufruf online, danach funktionaler Reload offline.
- Keine fehlenden Script-Requests im Offline-Modus.

---

## 3) Aufgabe: Kommentar-/Doku-Unstimmigkeit bereinigen
**Fund:** Die UI kommuniziert in der Kopfzeile „Mo-Sa · Stammdaten + 4 Ansichten“, gleichzeitig existieren in der Formularansicht Spalten/Platzhalter für Sonntag (`So`, `mepDateSo`).

**Risiko/Nutzen:** Der fachliche Geltungsbereich (6-Tage- vs. 7-Tage-Sicht) ist uneinheitlich und kann zu Fehlbedienung oder falschen Erwartungen führen.

**Vorschlag:**
- Fachlich entscheiden, ob Sonntag offiziell Teil der Planung ist,
- danach UI-Text und Formulardarstellung konsistent ziehen (entweder Sonntag entfernen oder Texte auf Mo-So anpassen).

**Akzeptanzkriterien:**
- Keine widersprüchlichen Hinweise mehr zwischen Kopfzeile, Tabellen und Formularansicht.
- Team kann den Geltungsbereich eindeutig benennen.

---

## 4) Aufgabe: Tests verbessern (Regressionen bei Abwesenheitslogik verhindern)
**Fund:** Es fehlen automatisierte Tests für kritische Randfälle in Datums- und Abwesenheitslogik (u. a. Bereichs-Abzug/Splitten von Abwesenheiten).

**Risiko/Nutzen:** Kleine Änderungen an Datumslogik können unbemerkt falsche Urlaub-/Krankheitszeiträume erzeugen.

**Vorschlag:**
- Unit-Tests für `subtractRangeFromAbsenceEntry` ergänzen:
  - komplette Überdeckung,
  - Abschneiden am Anfang,
  - Abschneiden am Ende,
  - Split in zwei Teilzeiträume,
  - kein Overlap.
- Zusätzliche Datums-Tests (`fromIsoDate`) für ungültige Tage und Schaltjahrfälle.

**Akzeptanzkriterien:**
- Testfälle decken die genannten Randfälle reproduzierbar ab.
- Bei Regressionen schlagen Tests deterministisch fehl.

---

## 5) Aufgabe: MEP-Geometrie auf eine Autorität festlegen (CSS-only)
**Entscheidung:** Für die MEP-Seitengeometrie gilt ausschließlich die feste CSS-Berechnung (mm-basierte Variablen). Die bisherige JS-Nachmessung und das nachträgliche Überschreiben von `--mep-table-height` / `--mep-subrow-height` entfallen vollständig.

**Akzeptanzkriterien:**
- Auf jeder MEP-Seite sind alle 9 MA-Zeilen vollständig sichtbar.
- Der Footer wird vollständig angezeigt (kein Abschneiden).
- Die unten definierte QA-Prüfkette für MEP-PDFs ist vollständig durchgeführt und dokumentiert (inkl. Viewer-Vergleich und Befundklassifikation).

### Verbindliche QA-Prüfkette für MEP-PDF-Änderungen
1. Export erzeugen.
2. Datei in `Dateien` speichern.
3. Dieselbe Datei in einem **externen PDF-Viewer** öffnen (z. B. Adobe Acrobat, Foxit, Files-Viewer) – **nicht nur** in der Safari-Tab-Vorschau.
4. Dieselbe Datei in **mindestens zwei iOS-Viewern** vergleichen (z. B. Safari-Preview + Adobe/Foxit/Files-Viewer).
5. Ergebnis eindeutig dokumentieren mit der Klassifikation:
   - **„Safari-Preview-Abweichung“** (Viewer-spezifisches Rendering-Problem), oder
   - **„Dateiinhalt korrekt“** (PDF-Datei selbst ist korrekt, Abweichung nur in einzelner Vorschau).

**Gate für MEP-PDF-PRs:**
- Ohne diese Prüfkette gilt die Abnahme als **nicht erfüllt**.
- Layoutfixes dürfen nicht allein auf Basis einer einzelnen Safari-Vorschau blockiert werden, wenn die Datei in externen Viewern korrekt ist.
