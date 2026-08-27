# Feste Testseite für Planung 2

## Warum sie nicht parallel über diese Pages-Site veröffentlicht wird

GitHub Pages stellt pro Repository genau eine Site bereit. Diese Site hat genau
eine Veröffentlichungsquelle: entweder einen Branch mit einem festen Ordner
oder einen GitHub-Actions-Deployment-Workflow. Ein zweiter Branch kann deshalb
nicht unabhängig unter einem Unterpfad derselben Site veröffentlicht werden.

Eine kombinierte Action könnte zwar `main` an die Wurzel und
`planung-2-interaktiv` nach `/planung-2/` kopieren. Damit würde diese Action aber
auch Eigentümerin der produktiven Pages-Veröffentlichung. Jeder Test-Deploy
würde die komplette produktive Site neu veröffentlichen und die bisherige
Pages-Quelle müsste in den Repository-Einstellungen ersetzt werden. Das erfüllt
die Vorgabe nicht, die produktive Veröffentlichung aus `main` unverändert zu
lassen.

Das automatische `GITHUB_TOKEN` ist außerdem nur für das Repository gültig, in
dem der Workflow läuft. Ein Workflow in `wochenplan-pwa` kann damit nicht in
`wochenplan-pwa-preview` schreiben. Der bisherige Workflow prüfte deshalb nur
Dateien und Tests und endete anschließend, ohne die Preview-Dateien zu
veröffentlichen. Für den Cross-Repository-Push ist das gezielt berechtigte Secret
`PREVIEW_REPOSITORY_TOKEN` erforderlich.

## Automatische Veröffentlichung nach einem Push

Die produktive Site bleibt unverändert. Der Workflow
`.github/workflows/planung-2-preview.yml` verwendet den bereits für Previews
eingeführten Mechanismus: Nach einem Push auf `planung-2-interaktiv` laufen
zuerst die Planung-2-Tests. Nur wenn sie erfolgreich sind, wird der Stand in den
Ordner `planung-2/` des separaten Pages-Repositorys
`Winterkuersche/wochenplan-pwa-preview` kopiert. Dort wird
`planung2-preview.html` als `index.html` bereitgestellt.

Für den repository-übergreifenden Checkout und Push wird das vorhandene Secret
`PREVIEW_REPOSITORY_TOKEN` benötigt. Es muss Schreibzugriff ausschließlich auf
`wochenplan-pwa-preview` besitzen. Das normale `GITHUB_TOKEN` dieses Repositorys
bleibt auf Lesezugriff beschränkt. Weder `main` noch die Pages-Konfiguration oder
Inhalte der normalen App werden durch den Workflow verändert.

Die feste Testadresse bleibt:

<https://winterkuersche.github.io/wochenplan-pwa-preview/planung-2/>

Im Preview-Repository muss GitHub Pages weiterhin aus dessen Standard-Branch
veröffentlichen. Die Preview wird nach einem erfolgreichen Workflow-Lauf unter
der festen Adresse aktualisiert; der manuelle Start über `workflow_dispatch`
bleibt ebenfalls möglich.
