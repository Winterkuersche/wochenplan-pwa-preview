# Mobile Top-Toolbar (<= 640px)

Auf kleinen Screens (max-width: 640px) ist die Top-Toolbar vereinfacht:

- **Direkt sichtbar** bleiben die wichtigsten Aktionen:
  - Ansicht wechseln
  - Wochennavigation
  - **Stammdaten speichern**
- **Sekundäre Aktionen** sind im Button **„Mehr ▾“** gebündelt:
  - Team ein-/ausblenden
  - Aktuelle Woche leeren
  - Sicherung exportieren/importieren
  - Dark Mode wechseln
  - Drucken / PDF
  - MEP-Modus umschalten (wenn MEP-Ansicht aktiv)

## Verhalten & Accessibility

- Das Mehr-Menü öffnet als Popover direkt unter dem Button.
- Menüeinträge lösen weiterhin dieselben bestehenden Button-Handler aus (keine Business-Logik verändert).
- **Escape** schließt das Menü.
- Klick außerhalb schließt das Menü.
- Beim Öffnen wird der erste sichtbare Menüeintrag fokussiert.
- Beim Schließen per Escape/Action springt der Fokus zurück auf „Mehr“.
- Defensive Guard im Click-Handler: `event.target` muss ein `Element` sein, bevor `closest()` genutzt wird.

## Mobile UX Hardening (Abschluss Sprint)

- Fokus-Rückgabe bei Dialogen ist für Shift-, Manual-Month- und Month-Fallback-Overlays aktiv (inkl. Escape/Overlay/Cancel).
- Month-Fallback speichert den vorherigen Fokus nur noch bei gültigem `HTMLElement`.
- Dark-Mode-Styles für mobile/sticky Dialogflächen und Mehr-Menü ergänzt:
  - Dialog-Overlay/-Box
  - Sticky Dialog-Actions im Mobile-Layout
  - Month-Fallback-Optionen
  - Mobile-Mehr-Menü
