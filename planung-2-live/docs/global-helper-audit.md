# Global Helper Audit

- Stand: 2026-03-25
- Geprüfte Dateien: 18
- Gefundene Top-Level-Helper: 352
- Kollisionen (dateiübergreifend): 0

## Ergebnis
Es wurden **keine** doppelten globalen Helper-Namen über mehrere Dateien gefunden.

## Regel für neue Helper
- Pro Helper-Name genau eine öffentliche Top-Level-Definition behalten.
- Zusätzliche Helfer mit gleichem Zweck als modulinterne Funktionen kapseln (z. B. IIFE/Closure oder `internal*`-Präfix).
