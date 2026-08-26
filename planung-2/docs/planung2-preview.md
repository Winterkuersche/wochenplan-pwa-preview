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
`wochenplan-pwa-preview` schreiben. Deshalb wurde der bisherige Workflow aus
diesem Repository entfernt: Er setzte für den Cross-Repository-Push das manuell
gepflegte Secret `PREVIEW_REPOSITORY_TOKEN` voraus.

## Einfachste tokenfreie GitHub-Pages-Alternative

Die produktive Site bleibt unverändert. Das vorhandene öffentliche Repository
`wochenplan-pwa-preview` kann weiterhin die feste Testseite bereitstellen, aber
es holt den öffentlichen Branch selbst ab. Der folgende Workflow gehört **in
das Preview-Repository**. Dort darf sein normales `GITHUB_TOKEN` in dasselbe
Repository schreiben; ein Personal Access Token ist nicht erforderlich.

```yaml
name: Planung 2 Preview

on:
  schedule:
    - cron: "*/5 * * * *"
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: planung-2-preview
  cancel-in-progress: true

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout preview repository
        uses: actions/checkout@v4

      - name: Checkout Planung 2
        uses: actions/checkout@v4
        with:
          repository: Winterkuersche/wochenplan-pwa
          ref: planung-2-interaktiv
          path: source

      - name: Update fixed preview
        run: |
          mkdir -p planung-2
          rsync --archive --delete \
            --exclude='.git' \
            --exclude='.github/' \
            source/ planung-2/
          cp planung-2/planung2-preview.html planung-2/index.html
          rm -rf source

          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add planung-2
          git diff --cached --quiet && exit 0
          git commit -m "Update Planung 2 preview"
          git push
```

GitHub plant zeitgesteuerte Actions nicht sekundengenau. Der Teststand wird mit
dieser tokenfreien Variante spätestens beim nächsten erfolgreichen
Fünf-Minuten-Lauf übernommen. Über `workflow_dispatch` kann der Lauf zusätzlich
sofort manuell gestartet werden. Ein exakter Push-Trigger über zwei Repositories
würde dagegen wieder eine repository-übergreifende Zugangsdaten- oder
GitHub-App-Konfiguration erfordern.

Die feste Testadresse bleibt:

<https://winterkuersche.github.io/wochenplan-pwa-preview/planung-2/>

Im Preview-Repository muss GitHub Pages weiterhin aus dem Branch veröffentlichen,
in den der Workflow pusht. Unter **Settings → Actions → General → Workflow
permissions** muss außerdem **Read and write permissions** erlaubt sein. Es ist
kein Repository-Secret und kein Personal Access Token nötig.
