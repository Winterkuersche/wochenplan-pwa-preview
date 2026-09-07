# Stability Checklist (Wochenplan-PWA)

Stand: 2026-03-29

## 1) Risikoanalyse (vor Feature-Arbeit)

### Logik-Risiken
- [x] **Zeitnormalisierung**: Eingaben mit Sonderzeiten (`08:55`, `19:10`) und Rundung auf 15 Minuten bleiben konsistent (abgedeckt in `tests/time-logic.test.js`).
- [x] **Pausenlogik**: Pflichtpause (>6h) sowie Spät-/Checkout-Ausnahmen berechnen reproduzierbar Minuten (abgedeckt in `tests/time-logic.test.js`).
- [x] **Saldo-Berechnung**: Monatsdifferenz und historischer Saldo nutzen die gleichen Monatsgrenzen und Sollzeit-Quelle (abgedeckt in `tests/balance.test.js`).

### Datenintegrität
- [ ] **Schedule-Sanitizing**: Persistierte `minutes` werden gegen Start/Ende/Pause validiert und korrigiert (kein expliziter Testnachweis im aktuellen Testset).
- [x] **Abwesenheiten**: Bereichs-Entfernung (trim/split/full remove) erzeugt nur gültige Datumsintervalle (abgedeckt in `tests/absences.test.js`).
- [x] **Import/Export-Validierung**: Backup-Formatvalidierung und Legacy-Normalisierung sind automatisiert abgedeckt (`tests/backup-validation.test.js`).

### UI-Flows
- [ ] **Import-Flow**: Vor Import existiert eine interne Rückfallsicherung (`pre-import`) (funktional vorhanden, aber nicht dediziert testseitig abgehakt).
- [x] **Monatsnavigation**: Monatsgrid zeigt vollständige Wochen inkl. Monatsgrenzen (abgedeckt in `tests/month-boundaries.test.js`).
- [ ] **Absence-Änderungen**: UI-Operationen auf Abwesenheiten zerstören keine nicht überlappenden Teilintervalle (Logiktest vorhanden, Browser-UI-Smoke noch offen).
- [x] **Dialog-Fokusmanagement (Monat-Fallback)**: ESC schließt Dialog und Fokus wird auf Trigger zurückgesetzt (`tests/month-fallback-dialog.test.js`).
- [x] **Mobile Toolbar Basisstruktur**: „Mehr“-Menü und Forward-Targets bleiben vorhanden (`tests/mobile-ui-regressions.test.js`).
- [x] **Manual-Month Mobile Labeling**: Responsive `data-label`-Texte bleiben im Rendercode erhalten (`tests/mobile-ui-regressions.test.js`).

## 2) Stabilitäts-Checks vor Release
- [x] `node --test tests/*.test.js` (2026-03-29: 40/40 pass, 0 fail, Dauer 1500.514405 ms)
- [x] Automatisierte Backup-Formatvalidierung und Legacy-Normalisierung (`tests/backup-validation.test.js`)
- [ ] Manueller Backup Export->Import->Reload-UI-Roundtrip (aktuelles Format) durchgeführt
- [ ] Manuelle Smoke-Checks im Browser (A-D) dokumentiert durchgeführt (siehe `docs/manual-smoke-checks.md`)

## 3) Offene Risiken (bewusst verbleibend)
- Service Worker ist aktuell in `index.html` deaktiviert (auskommentierte Registrierung), daher keine reale Offline-Wirkung im Live-UI-Standardpfad.
- Service Worker precache listet weiterhin nur einen Teil der lokalen Skripte; Offline-first bleibt damit funktional eingeschränkt.
- Keine Browser-E2E-Tests für DOM-Interaktionen in dieser Iteration; Fokus auf Kernlogik/Node-Tests.
