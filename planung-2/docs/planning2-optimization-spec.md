# Planning 2 – fachliche Optimierungs-Spezifikation

Stand: 2026-08-30

Status: verbindliche fachliche Arbeitsgrundlage für die nächsten Planning-2-Ausbaustufen. Diese Datei beschreibt die gewünschte Planungslogik. Bestehende zentrale Arbeitszeit-, Pausen-, Status-, Öffner-/Schließer- und Carryover-Regeln sollen wiederverwendet und nicht parallel neu implementiert werden.

## 1. Zielbild

Planning 2 soll sich vom heutigen Einzelvorschlags-System zu einem nachvollziehbaren Monatsoptimierer entwickeln.

Der bestehende Plan ist der Ausgangspunkt, aber nicht unantastbar. Planning 2 darf Schichten verschieben, kürzen, verlängern, entfernen, neu anlegen und zwischen Mitarbeitern umverteilen, wenn dadurch der Gesamtplan fachlich besser wird.

Die Optimierung denkt auf Monatsebene. Die Woche bleibt Prüf- und Regel-Einheit. Harte Regeln dürfen niemals zugunsten eines besseren Scores verletzt werden.

Langfristiges UI-Ziel ist ein separater Optimierungsmodus / „Spielplatz“: Planning 2 arbeitet dort auf einer Kopie des Plans, erzeugt mehrere vollständige Alternativen und verändert den echten Plan erst nach ausdrücklicher Übernahme durch den Benutzer.

## 2. Grundprinzipien der Entscheidung

Reihenfolge:

1. Harte Constraints prüfen. Ungültige Kandidaten oder Pakete verwerfen.
2. Gültige Kandidaten/Pakete nach fachlichem Gesamtnutzen bewerten.
3. Gesamte Monatswirkung berücksichtigen, nicht nur die isolierte Lücke.
4. Mehrere gute Gesamtplan-Alternativen erzeugen.
5. Die beste Variante als „Empfohlen“ markieren; die Entscheidung bleibt beim Benutzer.

Planstabilität ist wichtig, aber nur nachrangig: Bei annähernd gleich guten Lösungen gewinnt die mit weniger Änderungen. Eine deutlich bessere Lösung darf mehr umbauen.

## 3. Zeitliche Veränderbarkeit

### 3.1 Vergangenheit

Vergangene einzelne Tage sind Fakten und dürfen nicht mehr verändert werden.

Eine abgeschlossene Montag–Samstag-Woche wird am folgenden Sonntag um 00:00 vollständig read-only.

Vergangene Zeiträume dürfen weiterhin analysiert und zur Erklärung von Monatsständen verwendet werden.

### 3.2 Heute und Zukunft

Noch nicht vergangene Tage einer laufenden Woche sowie zukünftige Wochen dürfen optimiert werden.

Live-Änderungen am laufenden Arbeitstag müssen nicht automatisch optimiert werden; diese werden operativ manuell behandelt.

Je näher eine geplante Schicht zeitlich liegt, desto höher ist ihre Änderungskosten-Wertung. Nahe Änderungen sind aber erlaubt, wenn ihr Nutzen klar größer ist.

## 4. Statuslogik und neuer Arbeitstag

### 4.1 Harte Sperren für Arbeit

Planning 2 darf in V1 keinen neuen Arbeitstag auf folgenden Status erzeugen:

- Urlaub
- Krank
- Feiertag
- AG-Frei

AG-Frei bleibt vorerst generell geschützt, weil damit sowohl planerisch gesetztes Frei als auch Mitarbeiterwunsch-Frei dargestellt wird.

### 4.2 Disponibler leerer Tag

Ein wirklich leerer Tag darf in Arbeit umgewandelt werden, sofern alle übrigen Regeln erfüllt bleiben.

Wenn Planning 2 einen bestehenden Arbeitstag vollständig entfernt, wird dieser Tag wirklich leer. Er wird nicht automatisch zu AG-Frei.

### 4.3 Keine Mischstatus-Tage

Ein Tag ist entweder Arbeit oder Urlaub/Krank/Feiertag/AG-Frei/leer. Gemischte Status-/Arbeitstage werden nicht erzeugt.

## 5. Wöchentlicher freier Tag

Prüfzeitraum ist Montag bis Samstag.

Jeder Mitarbeiter benötigt mindestens einen echten freien Tag in diesem Zeitraum.

Als echter freier Tag zählen:

- leerer Tag
- AG-Frei

Nicht als freier Tag zählen:

- Urlaub
- Krank
- Feiertag
- Arbeit

Sonntag zählt für diese Regel nicht.

Hat ein Mitarbeiter bereits zwei oder mehr echte freie Tage, darf einer davon als neuer Arbeitstag genutzt werden, sofern mindestens einer übrig bleibt.

Soll der letzte echte freie Tag zu Arbeit werden, muss Planning 2 dies nur als gültiges Mehrfachpaket zulassen, wenn gleichzeitig an einem anderen Montag–Samstag-Tag ein echter freier Tag entsteht.

## 6. Schicht-Erzeugung und Schichtform

### 6.1 Mindestlänge

Neu erzeugte oder verbleibende Arbeitsschichten müssen mindestens 3 Stunden lang sein.

Ist die eigentliche Bedarfslücke kürzer als 3 Stunden, darf die neue Schicht sinnvoll über die Lücke hinaus verlängert werden.

Beispiel: Bedarf 15:00–17:00 → mögliche Kandidaten 14:00–17:00 oder 15:00–18:00.

### 6.2 Zeitraster

Reguläres Raster: 15-Minuten-Schritte.

Sondergrenzen bleiben exakt zulässig und bevorzugt, wo fachlich relevant:

- 08:55
- 19:10

Keine beliebigen Minutenwerte erzeugen.

### 6.3 Öffnungs-/Planungszeit

Keine Arbeit außerhalb der zentral gültigen Öffnungs-/Planungszeiten.

### 6.4 Eine Schicht pro Tag

Keine Split Shifts. Pro Mitarbeiter und Datum höchstens eine zusammenhängende Arbeitsschicht.

### 6.5 Längere Schichten

Bevorzugt werden grundsätzlich kompakte Schichten bis ungefähr 6 Stunden.

7–8 Stunden sind erlaubt, sollen aber seltener gewinnen, wenn kürzere sinnvolle Verteilungen ähnlich gut sind.

Auch fast vollständige oder vollständige Tagesschichten sind erlaubt, wenn sie fachlich sinnvoll sind und bestehende Freigaben / Hard Constraints dies zulassen.

### 6.6 Pausen

Es gelten ausschließlich die bestehenden zentralen Pausen- und Arbeitszeitregeln.

Bei nahezu gleichwertigen Schichten soll die Variante mit weniger unbezahlter Pause beziehungsweise mehr nutzbarer Arbeitszeit bevorzugt werden.

Planning 2 implementiert keine eigene Pausenregel.

## 7. Veränderung bestehender Schichten

Planning 2 darf bestehende Schichten:

- am Start kürzen
- am Ende kürzen
- am Start verlängern
- am Ende verlängern
- innerhalb des Tages komplett verschieben
- auf mindestens 3 Stunden reduzieren
- vollständig entfernen

Beispiel: 09:00–15:00 darf zu 13:10–19:10 werden, wenn Verfügbarkeit und alle Regeln passen.

Die verbleibende Schicht muss nicht zwingend an einer ursprünglichen Kante hängen. Die fachlich beste Lage innerhalb der gültigen Verfügbarkeit ist erlaubt.

## 8. Mitarbeiterverfügbarkeit

Verfügbarkeit ist Hard Constraint.

### 8.1 Ebenen

Planning 2 soll folgende Ebenen unterstützen:

1. allgemeine Mitarbeiter-Verfügbarkeit
2. wochentagsspezifische Verfügbarkeit
3. datumsspezifische Verfügbarkeit

Priorität:

`konkretes Datum > Wochentag > allgemein > keine Einschränkung`

### 8.2 Felder

Mindestens:

- frühester Start
- spätestes Ende
- maximale Schichtdauer

Keine Einschränkung bedeutet normale Verfügbarkeit innerhalb der Filial-/Planungszeiten. Historische Schichten dürfen nicht als versteckte Verfügbarkeitsregel interpretiert werden.

## 9. Weiche Zeitpräferenz

Pro Mitarbeiter globale Präferenz:

- Früh
- Spät
- Egal

Richtwerte:

- Früh: bevorzugt ungefähr 09:00–14:00
- Spät: bevorzugt ungefähr 14:00–19:00/19:10

Dies ist ausschließlich Ranking, kein Hard Constraint.

Die Bewertung erfolgt über den Monat. Einzelne untypische Schichten sind erlaubt.

„Egal“ erhält keine feste Früh-/Spät-Verteilung, darf aber grundsätzlich variabel eingesetzt werden.

Präferenzhistorie startet pro Monat neu.

## 10. Monats-Soll, Plus und Minus

### 10.1 Ziel

Grundziel: Jeder Mitarbeiter soll sein Monats-Soll möglichst erreichen.

Persönliche Ursachen wie Krankheit oder gewünschtes Frei können trotzdem zu Minus führen. Das Minus wird weiterhin berechnet und sichtbar gehalten.

### 10.2 Altes Minus

Minus aus dem Vormonat wird in den neuen Monat übernommen und priorisiert abgebaut.

Beispiel: Monats-Soll 160 h, altes Minus 6 h → effektives Ziel 166 h.

### 10.3 Plus

Plus wird nicht in den Folgemonat übertragen.

Im laufenden Monat beeinflusst Plus das Ranking: Je größer das Plus, desto geringer die Priorität für zusätzliche Stunden, sofern andere passende Mitarbeiter Stunden benötigen.

Plus darf bewusst bestehen oder weiter wachsen, wenn die Besetzung dies sinnvoll erfordert und kein guter Ersatz verfügbar ist.

### 10.4 Projektion statt Momentaufnahme

Planning 2 bewertet den prognostizierten Monatsendstand inklusive bereits geplanter zukünftiger Schichten.

Ein aktuell größeres Minus kann niedriger priorisiert werden, wenn es durch die restliche Monatsplanung ohnehin fast vollständig verschwindet.

Planning 2 darf Stunden früh im Monat vorziehen, wenn spätere bekannte Sperren die Möglichkeiten reduzieren.

### 10.5 Warnung

Wenn ein Monats-Soll mit den verbleibenden sinnvollen Möglichkeiten voraussichtlich nicht erreichbar ist, soll Planning 2 früh warnen und den prognostizierten Rest sowie wesentliche Ursachen zeigen.

### 10.6 Stunden-Gutschrift für Status

Urlaub, Krank und Feiertag schreiben pro Tag die individuellen Wochenstunden geteilt durch 6 gut. Dies gilt für alle Beschäftigungsarten einschließlich GFB.

Diese Gutschrift ändert nicht die freie-Tage-Regel.

## 11. Verteilung der Arbeitstage und Wochenstunden

Bei vergleichbarer Gesamtqualität werden mehrere sinnvolle kürzere Einsätze gegenüber einer einzelnen sehr langen Schicht bevorzugt.

Beispiel: 2 × 3 Stunden kann besser ranken als 1 × 6 Stunden, wenn beide Tage zusätzliche Hände sinnvoll nutzen.

Die Anzahl der Arbeitstage pro Woche ist ein weiches Ranking-Merkmal. Extrem einseitige Verteilung soll vermieden werden.

Längere Serien von 5–6 Arbeitstagen werden gegenüber ähnlich guten Alternativen mit weniger aufeinanderfolgenden Arbeitstagen schlechter bewertet. 6 Arbeitstage bleiben erlaubt.

## 12. Flexible Wochenverteilung

Neues/zu nutzendes Mitarbeitermerkmal:

`Flexible Wochenverteilung: Ja/Nein`

### Nein

Planning 2 versucht zunächst, einzelne Wochen ungefähr am individuellen Wochen-Soll zu halten. Dies ist Ranking, kein Hard Constraint.

Falls Tests später zu starke Ausschläge zeigen, kann als nachgelagerte Schutzgrenze ungefähr ±25 % des Wochen-Solls eingeführt werden.

### Ja

Starke Wochenunterschiede sind erlaubt, wenn der Monatsplan dadurch besser wird.

Bei sonst ähnlich guten Gesamtplänen wird auch hier eine gleichmäßigere Verteilung nicht künstlich benachteiligt.

## 13. Umverteilung zwischen Mitarbeitern

Planning 2 darf Stunden aktiv zwischen Mitarbeitern verschieben.

Erlaubt sind unter anderem:

- A kürzen, B verlängern
- A-Arbeitstag entfernen, B-Arbeitstag hinzufügen
- Mitarbeiter tauschen
- nach einem Tausch neue, passende Uhrzeiten für beide erzeugen
- Stunden zwischen Wochen verschieben

Wenn A voraussichtlich deutlich über Soll liegt und B Minus hat, darf A gekürzt oder entfernt und B eingesetzt werden, selbst wenn am ursprünglichen Tag grundsätzlich Arbeit für A vorhanden wäre.

Bedarf und tatsächliche zeitliche Eignung gehen jedoch vor reinem Stunden-Ausgleich.

## 14. GFB / Minijobber

### 14.1 Monatsbudget

Das GFB-Monatsbudget ist harte Obergrenze und gleichzeitig Planungsziel.

Planning 2 soll verfügbare GFB-Stunden möglichst vollständig und sinnvoll nutzen, aber niemals das Budget überschreiten.

Ein nicht sinnvoll nutzbarer Rest darf ungenutzt bleiben.

Beispiel: 2 Reststunden bei 3 Stunden Mindestschicht → Rest bleibt offen; keine Regelverbiegung.

### 14.2 Verteilung

Bei 6 sinnvoll nutzbaren Reststunden kann 2 × 3 Stunden gegenüber 1 × 6 Stunden bevorzugt werden, wenn beide Einsätze helfen.

Keine künstliche Gleichverteilung zwischen mehreren GFB-Mitarbeitern. Individuelle Verfügbarkeiten und Planbedarf entscheiden zuerst.

Sind mehrere GFB fachlich ähnlich geeignet, kann der noch sinnvoll zu verplanende Budgetrest als Rankingfaktor dienen.

### 14.3 Bestehende GFB-Schichten

Auch vollständig verplante GFB-Stunden dürfen zwischen Tagen verschoben werden.

Bestehende längere GFB-Schichten dürfen verkürzt werden, um die frei werdenden Budgetstunden an anderen sinnvollen Tagen in neuen mindestens 3-stündigen Einsätzen zu nutzen.

### 14.4 Mehr Köpfe

GFB zählen vollständig in den positiven „mehr Köpfe“-Effekt hinein.

Wenn ein zusätzlicher GFB-Einsatz von 3 Stunden sinnvoller ist als eine ohnehin lange Schicht eines anderen Mitarbeiters um 3 Stunden zu verlängern, darf der GFB-Einsatz bevorzugt werden.

## 15. Konkrete GFB-Verfügbarkeit

Spezielle Mitarbeiterrestriktionen werden nicht als GFB-Sonderlogik implementiert, sondern über die normale Hard-Availability.

Beispiel einer aktuell bekannten Konstellation:

- nur Montag und Dienstag disponibel
- Zeitfenster etwa 16:00–19:00/19:10
- zunächst höchstens zwei Einsätze pro Woche

Die möglichen Tage sind Chancen, keine Pflicht. Wenn nur einer der beiden Tage fachlichen Nutzen hat, muss der zweite Einsatz nicht erzwungen werden.

## 16. Rollen, Öffner, Schließer und Carryover

Keine generische laufende TL-/SV-Coverage optimieren.

Rollen fließen nur dort hart ein, wo eine konkrete bestehende Fachregel dies verlangt.

Öffner- und Schließerschichten dürfen verändert oder entfernt werden, sofern danach die komplette Sequenz weiterhin gültig ist.

Insbesondere:

- 19:10-Schließung muss gültig bleiben
- 19:10 → 08:55 Carryover muss gültig bleiben
- erforderliche Folgemutationen sind Teil des Gesamtpakets

Die bereits bestehende read-only Carryover-/Follow-up-Pipeline ist hierfür weiterzuverwenden.

## 17. Samstag-Fairness

Samstag nutzt dieselben Schichtlängenregeln wie andere Tage.

Samstagsarbeit soll über den Monat möglichst fair verteilt werden.

Ranking berücksichtigt:

- Anzahl gearbeiteter Samstage im Monat
- möglichst keine dauerhafte Bevorzugung derselben Person
- ungefähr zwei aufeinanderfolgende Samstage sind normal
- drei aufeinanderfolgende Samstage noch möglich
- mehr als drei aufeinanderfolgende Samstage stark vermeiden, aber nicht hart verbieten

Bei sonst ähnlicher Eignung soll z. B. eine Person mit 1 bisher gearbeitetem Samstag klar vor einer Person mit 3 Samstagen ranken.

## 18. Bedarf, Unterbesetzung und Teilverbesserung

Primärziel ist, Unterbesetzung möglichst vollständig zu beseitigen.

Eine Teilverbesserung ist ausdrücklich gültig und besser als keine Verbesserung.

Beispiel: Lücke 15:00–19:00, intern nur 16:00–19:00 lösbar → interne Teilverbesserung übernehmen können und Restlücke 15:00–16:00 transparent ausweisen.

Keine schlechte interne Lösung erzwingen, nur um rechnerisch Null Unterbesetzung zu zeigen.

## 19. Tagesbedarf und Puffer

Die bestehenden Tagesbedarfs-/Demand-Kennzeichnungen bilden die Grundlage für wichtige Tage. Kein neues allgemeines Importance-Feld einführen.

Auch wenn die Mindestbesetzung erfüllt ist, darf Planning 2 zusätzliche interne Besetzung positiv bewerten, besonders an wichtigen Tagen.

Ruhige Tage sollen nicht automatisch bis auf die nackte Mindestgrenze ausgedünnt werden.

Puffer sollen als konfigurierbare Zeitfenster gedacht werden, beispielsweise:

- 09:00–12:00 +3 Mitarbeiterstunden
- 16:00–19:10 +3 Mitarbeiterstunden

Puffer sind Soft Targets und keine Obergrenzen.

Teilüberlappungen werden proportional bewertet.

## 20. Mehr Köpfe

Zusätzlich zu reinen Mitarbeiterstunden kann eine höhere Anzahl gleichzeitig beziehungsweise im relevanten Zeitfenster eingesetzter unterschiedlicher Mitarbeiter positiv bewertet werden.

Beispiel: Bei vergleichbaren 18 Arbeitsstunden können 6 kürzere Einsätze gegenüber 4 langen Schichten fachlich vorteilhaft sein.

Für diesen Vorteil wird vorerst keine feste harte Obergrenze definiert.

Er darf niemals Hard Constraints, sinnvolle Monatsstunden oder echte Coverage verschlechtern.

## 21. Externe Hilfe

Eine gute rein interne Lösung wird grundsätzlich gegenüber einer Lösung mit externer Hilfe bevorzugt, selbst wenn die interne Lösung mehr bestehende Schichten verändern muss.

Wenn intern keine ausreichend gute Voll-Lösung existiert, darf Planning 2 externe Hilfe als Planvariable ausweisen.

Darstellung konkret:

- Datum
- Uhrzeit von/bis
- Anzahl externer Personen

Restlücken nach interner Teilverbesserung sollen unmittelbar in den konkreten externen Restbedarf übersetzt werden.

Externe Einsätze möglichst bündeln. Bei ähnlich guten Varianten lieber ein längerer externer Einsatz als mehrere kleine Einsätze an unterschiedlichen Tagen.

Der Optimierer darf die interne Planung um eine angenommene externe Hilfe herum neu verteilen.

Externe Mitarbeiter benötigen zunächst keine Rollen-/Skillklassifikation.

## 22. Zielkonflikte / Ranking-Prioritäten

Die genaue numerische Gewichtung ist Implementierungs- und Testgegenstand. Die fachliche relative Richtung ist jedoch festgelegt.

### Harte Ebene

Ungültig bei Verletzung von unter anderem:

- geschützten Status-Tagen
- Mitarbeiterverfügbarkeit
- Mindestschichtlänge
- Öffnungs-/Planungszeit
- einer Schicht pro Tag
- GFB-Maxbudget
- echtem freien Tag Mo–Sa
- bestehenden zentralen Arbeitszeitregeln
- Öffner-/Schließer-/Carryover-Regeln
- vergangenen/read-only Zeiträumen

### Weiche Ebene

Wichtige Nutzenfaktoren:

- Unterbesetzung reduzieren
- vollständige interne Lösung
- wichtige Demand-Zeiten / Puffer stärken
- prognostiziertes Monats-Soll erreichen
- altes Minus abbauen
- unnötiges aktuelles Plus reduzieren
- GFB-Budget sinnvoll ausschöpfen
- mehr Köpfe
- sinnvolle Schichtlänge / Pauseneffizienz
- Wochenverteilung
- Anzahl / Serien von Arbeitstagen
- Samstag-Fairness
- Früh-/Spätpräferenz
- Planstabilität
- zeitliche Nähe der Änderung

Explizite Konfliktentscheidungen:

- Besetzung ist wichtiger als Plusstunden zu vermeiden.
- Weniger Unterbesetzung darf etwas mehr Plus rechtfertigen.
- Wenn zwei vollständig interne Lösungen alle Lücken schließen, ist weniger unnötiges Plus wichtiger als einige zusätzliche Planänderungen.
- Bei nahezu gleich guten Lösungen gewinnt die planstabilere Lösung.
- Bei nahezu gleich guten Lösungen wird die gleichmäßigere Wochenverteilung bevorzugt, außer starke Schwankung ist beim Mitarbeiter explizit erlaubt und fachlich besser.
- Mehr Köpfe an wichtigen Tagen darf bei ähnlicher Gesamtqualität etwas mehr Planänderungen rechtfertigen.

## 23. Multi-Mutation-Pakete

Abhängige Änderungen werden als ein atomisches Paket behandelt.

Beispiele:

- A erhält neuen Arbeitstag, B wird frei
- B verliert 19:10, C übernimmt Schließung
- neue 19:10-Schicht erzeugt erforderliche 08:55-Folgemutation
- A wird gekürzt, B übernimmt frei gewordene Stunden an anderem Tag

Constraints und Follow-up-Regeln müssen auf dem gesamten simulierten Paket laufen, nicht nur auf Einzelmutationen.

Ein Paket wird komplett übernommen oder gar nicht.

Undo stellt das komplette Paket zurück.

Keine versteckten Autofix-Mutationen außerhalb der dargestellten Paketwirkung.

## 24. Gesamtplan-Alternativen / Spielplatz

Langfristig soll der Optimierungsmodus auf einer Working Copy des kompletten Monats arbeiten.

Der echte Plan bleibt unverändert, bis der Benutzer eine Alternative übernimmt.

Planning 2 erzeugt mehrere bestbewertete gültige Gesamtplan-Varianten.

Keine künstlich erzeugte Diversität: Varianten müssen nicht absichtlich verschiedene Strategien verfolgen. Wenn die besten Lösungen ähnlich strukturiert sind, ist das korrekt.

Praktisch identische Varianten sollen dedupliziert werden.

Eine Variante wird anhand des Gesamtrankings als `Empfohlen` markiert.

## 25. Variantenvergleich in der UI

Für jede komplette Variante kompakt anzeigen:

- verbleibende Unterbesetzung
- prognostizierte Plus-/Minusstunden bzw. Soll-Erreichung
- GFB-Restbudget
- Anzahl Planänderungen
- benötigte externe Hilfe
- wichtige Warnungen, z. B. nicht erreichbares Monats-Soll

Pakete / Änderungen können zunächst kompakt zusammengefasst und bei Bedarf aufgeklappt werden.

Beispiel kompakt:

`3 Änderungen · löst Unterbesetzung 16–19:10`

Aufgeklappt: jede Mutation mit Grund und Wirkung.

## 26. Erklärbarkeit

Planning 2 soll keine undurchsichtige Score-Zahl allein präsentieren.

Für Kandidaten, Pakete und Gesamtvarianten sollen maschinenlesbare Fakten vorhanden sein, aus denen kurze Erklärungen erzeugt werden können.

Typische Fragen, die die Daten beantworten sollen:

- Warum wurde Mitarbeiter B statt A gewählt?
- Warum bleibt Mitarbeiter C im Minus?
- Warum wurde eine Schicht verschoben?
- Welche Lücke wird nur teilweise gelöst?
- Warum wird externe Hilfe vorgeschlagen?
- Welche Carryover-Folgemutation ist erforderlich?
- Warum ist eine Variante trotz mehr Änderungen empfohlen?

## 27. Technische Architektur-Leitlinie

Bestehende Architektur weiterführen:

`Problem → Kandidaten erzeugen → auf Kopie simulieren → Hard Constraints → Follow-up-Regeln → Feature/Faktenprofil → Ranking → Paket/Variante`

Wichtig:

- Generatoren mutieren den echten Plan nicht.
- Simulationen arbeiten auf Kopien.
- Hard Constraints liefern explizite Violations.
- Follow-up-Mutationen bleiben maschinenlesbar.
- Ranking verwendet Features/Fakten und ist von der Candidate-Erzeugung getrennt.
- zentrale bestehende Helpers wiederverwenden.
- Apply geschieht erst nach Nutzerentscheidung.

## 28. Nächste Implementierungsstufen

### Stufe A – fachliche Constraint-/Masterdaten-Grundlage

Vor dem breiten neuen Candidate-Generator die noch fehlenden universellen Mitarbeiterdaten und Validatoren sauber ergänzen:

- allgemeine Verfügbarkeit
- Wochentag-Overrides
- Datum-Overrides
- maximale Schichtdauer
- Früh/Spät/Egal
- Flexible Wochenverteilung Ja/Nein

Mit reinen, DOM-unabhängigen Resolve-/Validate-Helpern und Tests.

### Stufe B – leer → Arbeit Candidate Generator

Erster neuer Mutationstyp:

- nur wirklich leere Tage
- Mindestschicht 3 h
- 15-Minuten-Raster plus 08:55/19:10
- aus Unterbesetzungsfenstern mehrere sinnvolle Fenster ableiten
- auch längere Fenster erzeugen, wenn Monatsdefizit / Demand dies rechtfertigt
- Availability, GFB, freier Tag, Coverage, Carryover etc. über bestehende Pipeline prüfen

Noch kein direkter Plan-Apply außerhalb des bestehenden kontrollierten Mechanismus.

### Stufe C – vollständige bestehende Schicht-Mutationen

Candidate-Typen ergänzen:

- verkürzen
- verlängern
- verschieben
- entfernen
- Arbeitstag eines anderen Mitarbeiters nutzen

Featureprofil um Monatsprojektion, Workday Count, Wochenverteilung, Samstag, Präferenz, Pausenwirkung, Demand/Puffer, Planänderung erweitern.

### Stufe D – Multi-Mutation-Pakete

Begrenzten Paket-Generator bauen:

- komplementäre Einzelmutationen kombinieren
- Follow-up-Mutationen einbeziehen
- Konflikte auf derselben Mitarbeiter-/Datumszelle ausschließen
- Paket genau einmal komplett simulieren
- atomisches Apply + Undo
- Paket-Erklärung

### Stufe E – Monatsoptimierer / Spielplatz

Auf Working Copy mehrere Paketfolgen zu vollständigen Monatsvarianten zusammensetzen.

Laufzeit kontrollieren durch:

- Problempriorisierung
- Candidate-Vorauswahl
- Beam-/Top-N-Weiterverfolgung statt vollständiger kombinatorischer Suche
- kanonische Plan-/Mutations-IDs zur Deduplizierung

Am Ende Top-Varianten vergleichen, `Empfohlen` markieren, erst danach optional in echten Plan übernehmen.

## 29. Empfohlener unmittelbarer nächster PR

Der nächste produktive PR sollte **nicht sofort den vollständigen Monatsoptimierer bauen**.

Empfohlen ist zuerst die gemeinsame Availability-/Preference-Grundlage aus Stufe A, weil nahezu alle danach gewünschten Candidate-Typen davon abhängen und die Regeln sonst mehrfach in Generatoren landen würden.

Akzeptanzkriterien für diesen PR:

1. Mitarbeiter können allgemeine früheste/späteste Zeit und maximale Schichtdauer besitzen.
2. Wochentag-Overrides können diese Werte überschreiben.
3. Datum-Overrides haben höchste Priorität.
4. Fehlende Einschränkung bedeutet volle reguläre Planungsverfügbarkeit.
5. Resolver ist pure/read-only und DOM-unabhängig.
6. Validator kann ein vorgeschlagenes Shift-Fenster gegen die aufgelöste Verfügbarkeit prüfen.
7. Früh/Spät/Egal und Flexible-Wochenverteilung werden als Masterdaten persistiert, aber zunächst nur als strukturierte Fakten bereitgestellt.
8. Backup/Import/Planning-2-Transfer erhalten die neuen Felder.
9. Tests decken Priorität Datum > Wochentag > allgemein, keine Einschränkung, Max-Dauer und Persistenz ab.
10. Bestehende Planning-2-Tests bleiben grün.

Danach folgt direkt der `leer → Arbeit`-Generator aus Stufe B.
