# Release Readiness Gate – Sprint 2

Stand: 2026-03-29

## 1) Verifiziert

### Automatisierte Tests (voller Lauf)
- Befehl: `node --test tests/*.test.js`
- Ergebnis: **PASS**
- Statistik: **40 Tests**, **40 bestanden**, **0 fehlgeschlagen**, Dauer **1500.514405 ms** (Lauf vom 2026-03-29).

### Kritische Bereiche mit Nachweis
- Abwesenheits-Trim/Split/Entfernung korrekt (`tests/absences.test.js`).
- Backup-Formatvalidierung und Legacy-Normalisierung sind automatisiert abgedeckt (`tests/backup-validation.test.js`). Ein echter Export->Import->Reload-UI-Roundtrip bleibt als manueller Smoke-Check offen.
- Monatsgrenzen/Monatsnavigation stabil (`tests/month-boundaries.test.js`).
- Zeitlogik inkl. Rundung/Pausen robust (`tests/time-logic.test.js`).
- Dialog-Hardening regressionsseitig abgedeckt: ESC schließt Month-Fallback und gibt Fokus zurück (`tests/month-fallback-dialog.test.js`).
- Mobile-Toolbar-/Manual-Month-Markup-Regressionschecks vorhanden (`tests/mobile-ui-regressions.test.js`).
- Service Worker Fallback-Regeln testseitig vorhanden (`tests/sw-cache-behavior.test.js`):
  - Navigation nutzt `index.html` mit `ignoreSearch`.
  - Statische Assets nutzen `ignoreSearch`.
  - API-ähnliche Requests nutzen **kein** pauschales `ignoreSearch`.

### Service Worker Status im Code
- Service Worker Registrierung in `index.html` ist aktuell **deaktiviert** (kompletter Block auskommentiert).
- Auswirkung: Die in `sw.js` implementierte Cache-/Offline-Logik greift im aktuellen App-Standardlauf nicht.

## 2) Offen / nicht abschließend verifiziert

1. **Manuelle Browser-Smokes A-D als Pflichtflows vor GO** (Monatszelle, Urlaub/Krank-Trim, Monats-Iststunden-Bulk-Paste, Backup Export/Import Roundtrip) sind dokumentiert, aber nicht als durchgeführter Browserlauf protokolliert.
2. **SW im echten Offline-Browserlauf** ist nicht als aktivierter End-to-End-Lauf nachgewiesen, weil Registrierung bewusst deaktiviert ist.
3. **Schedule-Sanitizing** bleibt als separater offener Nachweis (kein dedizierter Testfall im aktuellen Set).

## 3) Risiken (priorisiert, nach Mobile-UX-Hardening)

- **Mittel-Hoch:** Kein real ausgeführter Browser-Smoke für die vier Kernflows vor dem Gate-Abschluss.
- **Mittel:** Service Worker ist deaktiviert; Offline-/Update-Verhalten bleibt ohne temporäre Aktivierung unbestätigt.
- **Mittel:** Precache-Liste in `sw.js` enthält nicht alle lokalen Skripte, daher eingeschränkte Offline-Abdeckung.
- **Niedrig:** Kein dedizierter Automationsnachweis für Schedule-Sanitizing.

## 4) Go/No-Go Empfehlung

**Empfehlung: NO-GO (konservativ), bis die manuellen Browser-Smokes A–D dokumentiert durchgeführt sind.**

Begründung:
- Die automatisierten Node-Tests sind vollständig grün (Kernlogik, Validierung, SW-Fallback-Regeln).
- Ein realer Browser-Interaktionsnachweis (DOM-Flow) für die Gate-Flows A–D ist noch offen.
- Die Service-Worker-Registrierung ist im Standardlauf aktuell deaktiviert; Offline-Verhalten ist daher noch nicht im echten UI-Laufpfad bestätigt.

## 5) SW-Testmodus: temporär aktivieren (ohne riskanten Umbau)

Die Schritt-für-Schritt-Anleitung ist in `docs/manual-smoke-checks.md` enthalten:
- SW-Block in `index.html` nur lokal temporär einkommentieren.
- Offline-Navigation/Asset-Fallback prüfen.
- Danach auf den ursprünglichen Zustand zurücksetzen.

## 6) Nächste 3 konkrete Schritte

1. Manuelle Browser-Smokes A-D gemäß `docs/manual-smoke-checks.md` durchführen und mit Datum/Ergebnis protokollieren.
2. SW lokal temporär aktivieren, einen Offline-Durchlauf dokumentieren, dann wieder deaktivieren.
3. Nach erfolgreichem Nachweis Gate-Status in `docs/stability-checklist.md` auf GO aktualisieren.
