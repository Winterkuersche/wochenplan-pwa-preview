# Teil 3 – Evolutionäre Weiterentwicklung auf stabiler Basis

## Priorisierter Feature-Plan (2 Sprints)

## Sprint 3

### Must: Monats-Iststunden UX 2.0 (Mehrfach-Erfassung/Bulk-Paste)
- **Nutzerproblem:** Teamleitungen erfassen Monats-Iststunden häufig aus externen Listen. Einzelzeilen-Eingabe ist langsam und fehleranfällig.
- **Technische Lösung:** Dialog um Bulk-Paste-Textarea + Parser erweitern (`YYYY-MM HH:MM` je Zeile), Zeilenvalidierung mit Fehlerfeedback, Merge mit Tabellenzeilen, Persistenz über bestehendes `manualMonthActualMinutes`.
- **Risiken:** Uneinheitliche Eingabeformate; Duplikate überschreiben Werte; Fehlermeldungen müssen eindeutig bleiben.
- **Akzeptanzkriterien:**
  1. Bulk-Input akzeptiert mehrere Monate in einem Schritt.
  2. Validierungsfehler zeigen Zeilennummer und blockieren Übernahme.
  3. Übernommene Daten sind nach Speichern/Reload vorhanden.
  4. Manuelle Marker im Monats-View bleiben konsistent.
- **Tests:**
  - Unit-Test Parser: gültige Zeilen, Duplikate, Fehlerzeilen.
  - Regression: bestehende Zeit-/Saldo-Tests bleiben grün.

### Should: Saldo-Transparenz pro Mitarbeiter (Drilldown)
- **Nutzerproblem:** Differenzen sind sichtbar, aber Ursache (Tag/Monat/Abwesenheit) bleibt unklar.
- **Technische Lösung:** Optionales Drilldown-Panel je Mitarbeiter mit Herkunft der Monatsdifferenz (Soll, Plan-Ist, manuelle Übersteuerungen, Abwesenheiten).
- **Risiken:** Performance bei großen Teams; visuelle Komplexität im Monats-Grid.
- **Akzeptanzkriterien:** Drilldown ist pro Mitarbeiter ein-/ausblendbar; Werte entsprechen Hauptsaldo.
- **Tests:** Unit-Tests für Breakdown-Berechnung, Snapshot/DOM-Checks für Rendering.

### Nice: Schnellaktionen in Team-Setup
- **Nutzerproblem:** Wiederkehrende administrative Klickstrecken (z. B. Bonus/Vertragsmodell) dauern zu lange.
- **Technische Lösung:** Batch-Aktionen für mehrere Mitarbeiter (Toggle Bonus, Vertragsmodell setzen).
- **Risiken:** Fehlbedienung bei Massenänderungen.
- **Akzeptanzkriterien:** Änderungen sind sofort sichtbar, rücksetzbar, persistent.
- **Tests:** UI-Flow-Tests für Multi-Select und Persistenz.

## Sprint 4

### Must: Import/Export für Monats-Iststunden (CSV)
- **Nutzerproblem:** Externe Vorlagen (Lohn, Controlling) können nicht direkt übernommen werden.
- **Technische Lösung:** CSV-Import/Export für `manualMonthActualMinutes` mit Schema-Validierung.
- **Risiken:** CSV-Varianten (Delimiter, Encoding), inkonsistente Monatsformate.
- **Akzeptanzkriterien:** Standard-CSV kann importiert/exportiert werden; Fehlerreport pro Zeile.
- **Tests:** Parser-/Serializer-Tests, Roundtrip-Test.

### Should: Konfliktwarnungen bei Plan-/Ist-Abweichungen
- **Nutzerproblem:** Kritische Abweichungen werden erst spät erkannt.
- **Technische Lösung:** Schwellwert-Logik für Warnindikatoren in Monat/Woche.
- **Risiken:** Warnmüdigkeit durch zu viele Hinweise.
- **Akzeptanzkriterien:** Warnungen nur bei konfigurierter Abweichung; keine Fehlalarme bei manuellen Overrides.
- **Tests:** Unit-Tests Schwellwertberechnung, UI-Tests für Markierung.

### Nice: KPI-Widget für Monatsabschluss
- **Nutzerproblem:** Monatliche Gesamtlage ist nur aus mehreren Ansichten zusammensetzbar.
- **Technische Lösung:** KPI-Kacheln (Soll, Ist, Delta, offene Urlaubstage) im Monatsheader.
- **Risiken:** Informationsdichte auf kleinen Displays.
- **Akzeptanzkriterien:** KPI-Werte stimmen mit bestehenden Berechnungen überein.
- **Tests:** Rechen-Regression + responsives Rendering.
