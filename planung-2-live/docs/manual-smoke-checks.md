# Manueller Smoke-Check (Release-Gate Sprint 2)

Stand: 2026-03-29

## Ziel und Scope

Diese Schritte sind als **manueller Browser-Smoke** dokumentiert, weil im Repository kein Browser-E2E-Tooling (Playwright/Cypress) konfiguriert ist. Der vorhandene Smoke-Test `tests/smoke-e2e.test.js` läuft in Node und deckt Kernlogik, nicht DOM-Interaktion, ab.

Die Flows **A–D sind manuelle Pflichtflows vor einem GO im Release-Gate** und gelten erst als erfüllt, wenn sie mit Datum/Ergebnis protokolliert wurden.

Vorbereitung:
1. App lokal starten/öffnen (`index.html` im Browser).
2. Leeren Test-Datensatz nutzen oder frische Sicherung importieren.
3. Nach jedem Flow einmal explizit speichern und Seite neu laden.

## Flow A: Monatszelle klicken -> Typ wählen -> speichern

1. In die Ansicht **Monat** wechseln.
2. Eine leere Monatszelle anklicken.
3. Im Auswahl-Dialog einen Typ wählen (z. B. Schicht/Status).
4. Dialog bestätigen.
5. Auf **Speichern** klicken.
6. Seite neu laden.
7. Erwartung: Eintrag bleibt in der Monatszelle erhalten.

## Flow B: Urlaub/Krank eintragen -> ändern/trimmen -> speichern

1. In die Ansicht **Urlaub** wechseln.
2. Für eine Person Urlaub oder Krank von Datum A bis Datum B eintragen.
3. Einen überlappenden Zeitraum bearbeiten/entfernen, so dass ein Trim oder Split entsteht.
4. Speichern.
5. Seite neu laden.
6. Erwartung: Nur der bearbeitete Abschnitt ist verändert, nicht überlappende Intervalle bleiben bestehen.

## Flow C: Monats-Iststunden Dialog öffnen -> Bulk-Paste einfügen -> übernehmen -> speichern -> Reload prüfen

1. In die **Monat**-Ansicht wechseln.
2. Monats-Iststunden-Dialog öffnen.
3. Mehrere Zeilen im Bulk-Format einfügen (z. B. `2026-01 120:00`, `2026-02 118:30`).
4. Übernehmen bestätigen.
5. Speichern.
6. Seite neu laden.
7. Erwartung: Die manuell gesetzten Monats-Iststunden sind weiterhin sichtbar (inkl. Marker/Tooltip).

## Flow D: Backup Export -> Import (aktuelles Format)

1. **Sicherung exportieren** ausführen (aktueller Datenstand).
2. Optional Teständerung durchführen und speichern.
3. **Sicherung importieren** mit der gerade exportierten Datei.
4. Speichern.
5. Seite neu laden.
6. Erwartung: Datenstand entspricht dem exportierten Snapshot (Roundtrip erfolgreich).

## Service Worker: temporär aktivieren und Offline prüfen (Testmodus)

Ohne riskanten Umbau, nur lokal/temporär:
1. In `index.html` den aktuell auskommentierten Service-Worker-Block temporär aktivieren.
2. Hard-Reload durchführen, damit Registrierung greift.
3. DevTools -> Application -> Service Workers: Aktivierung kontrollieren.
4. DevTools -> Network auf **Offline** setzen.
5. Navigation in der App prüfen (z. B. Reload auf Monatsseite): `index.html`-Fallback muss greifen.
6. Eine statische Datei mit Query testen (z. B. `app.js?v=...`): Asset-Fallback muss aus Cache laden.
7. Optional API-ähnlichen Pfad testen: kein aggressives `ignoreSearch`-Fallback für nicht-statische Requests erwarten.
8. Nach dem Test den SW-Block wieder auf den bisherigen Zustand zurücksetzen, falls kein produktiver Rollout geplant ist.

Dokumentationshinweis: Dieser Ablauf ist eine Testanleitung; im aktuellen Stand bleibt der SW absichtlich deaktiviert.
