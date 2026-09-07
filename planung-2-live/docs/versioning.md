# Versionierung & Cache-Busting

Diese App nutzt drei getrennte Versionsarten in `version.js`:

- `APP_META.version` → sichtbare App-Version (UI / Browser-Tab).
- `APP_META.assetVersion` → Query-Parameter `?v=` für lokale Script-Tags in `index.html`.
- `APP_META.cacheName` → Service-Worker-Cache-Name.

## Was muss wann angepasst werden?

### 1) Nur sichtbare Release-Version ändern
Beispiel: „V9.3“ → „V9.4“ ohne Cache-Strategieänderung.

- In `version.js` nur `APP_META.version` erhöhen.

### 2) Neue JS-Auslieferung sicher erzwingen (Script-Cache-Busting)
Beispiel: geänderte lokale JS-Dateien sollen sicher neu geladen werden.

1. In `version.js` `APP_META.assetVersion` erhöhen (z. B. Datums-/Build-String).
2. Script ausführen:

```bash
node tools/sync-index-script-version.js
```

Dadurch werden alle lokalen `<script src="./*.js">` in `index.html` auf denselben `?v=`-Wert gesetzt.

### 3) Service-Worker-Cache komplett rotieren
Beispiel: Precache-Inhalte/Cache-Schema haben sich geändert oder Alt-Cache muss verworfen werden.

- In `version.js` `APP_META.cacheName` auf neuen Wert setzen (z. B. `wochenplan-cache-v46`).

## npm Scripts

- `npm run check:all` führt alle relevanten lokalen/CI-Prüfungen in einem Befehl aus.
- `npm run sync:asset-version` synchronisiert die `?v=`-Parameter in `index.html` anhand von `APP_META.assetVersion`.

Diese Scripts orchestrieren ausschließlich lokale/CI-Checks bzw. Wartungsschritte und ändern keine Browser-Laufzeitlogik.

## Inventar: Stellen mit Versionsbezug

- Sichtbare Version: `version.js` (`APP_META.version`) und Nutzung in `app.js` (`document.title`).
- SW-Cache-Version: `version.js` (`APP_META.cacheName`), gelesen in `sw.js`.
- Script-Cache-Buster: lokale Script-Tags mit `?v=` in `index.html` (automatisch synchronisierbar über `tools/sync-index-script-version.js`).
- Test-Fixwerte für Query-Beispiele: `tests/sw-cache-behavior.test.js`.

## Hinweis

`index.html` hält im `<title>` bewusst nur den neutralen Basiswert `Wochenplan`. Die sichtbare Version wird ausschließlich zur Laufzeit über `APP_META.version` in `app.js` gesetzt.
