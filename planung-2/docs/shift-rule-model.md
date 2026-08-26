# Shift Rule Model

Die Schichtlogik wird zentral über `shift-rules.js` gesteuert.

## Ziele

- Eine zentrale Registry pro Schicht-/Dialogtyp (`SHIFT_RULES`).
- Einheitliche interne Codes (`FO`), bei gleichbleibender Anzeige (`FÖ`).
- Generischer Builder in `shift-utils.js` (`buildShiftEntryFromRule`).

## Rule-Struktur

Jede Regel enthält:

- `code`, `label`, `entryType`
- `startPolicy`, `endPolicy`, `breakPolicy`, `uiPolicy`
- optional `mode` und `shiftType` für Plan-Einträge

## Normalisierung

- `normalizeShiftCode` normalisiert Legacy/Anzeige-Codes (z. B. `FÖ -> FO`).
- Beim Laden werden unbekannte Codes in `app.js` als generische Schicht behandelt.
- Für unbekannte Codes wird einmalig eine Warnung in der Konsole ausgegeben.

## FÖ-Regel

- Start fix `08:55`.
- Endzeit über Registry auswählbar (`12:00` bis `19:00` in 15-Min-Schritten + `19:10`).
- Basispause fix `5` Minuten.
- Zusätzlich fließen für FÖ immer weitere `5` Minuten als additiver Zuschlag in die gesamte Tagespause ein (Start `08:55`), auch bei Pflichtpause/Late-Checkout-Sonderfall; der Zuschlag wirkt nicht nur als Mindestpause und wird je Tages-Eintrag genau einmal addiert.

## UI-Anbindung

- Dropdowns werden aus `getShiftSelectOptions()` erzeugt.
- Dialogpflicht wird über `isDialogShift(code)` entschieden.
- FÖ-Dialog nutzt Rule-Daten für Start/Ende (Start read-only).
