# Planning 2: nächste Candidate-Ausbaustufen

## Frei/leer → Arbeit

Ein eigener Generator sollte aus einem Unterbesetzungsproblem zulässige Schichtfenster ableiten und daraus zunächst **eine primäre Mutation** erzeugen. Er darf weder `schedule` noch Abwesenheiten ändern. Der bestehende Monats-/Wochen-Kontext liefert Basisplan, GFB-Monatsstatus, Sollstunden, Ganztagsfreigabe und Änderungsvorlauf. Dieselbe Constraint- und Follow-up-Pipeline prüft danach Coverage, freien Tag, Arbeitszeitgrenzen, 08:55/19:10 und Carryover. Ein hinzugefügter Arbeitstag wird als neutrales Baseline-Faktum (`workdayAdded`) erfasst; erst Apply materialisiert ihn.

Offen ist die fachliche Entscheidung, welche Nicht-Arbeitstypen grundsätzlich disponibel sind: Ein explizites AG-Frei, Urlaub, Krankheit, Feiertag und externe Hilfe dürfen nicht pauschal gleich behandelt werden. Ebenso müssen Mindestschichtlänge, erlaubte Start-/Endraster und Änderungsvorlauf vor der Implementierung festgelegt werden.

## Kombinationskandidaten

Danach sollte ein begrenzter Paket-Generator zwei bereits einzeln simulierte Boundary-Mutationen für dasselbe Problem kombinieren. Er bildet nur Paare mit komplementären Coverage-Beiträgen, dedupliziert sie über eine kanonisch sortierte Mutation-ID und simuliert das gesamte Paket genau einmal. Constraints und Folgeregeln arbeiten auf dem Paket, nicht auf den Einzelteilen; `requiredFollowUpMutations` bleiben eine getrennte, maschinenlesbare Ebene, bis Multi-Mutation-Apply unterstützt wird.

Zur Begrenzung der Laufzeit werden je Lückenkante nur fachlich relevante Einzelmutationen vorselektiert. Paare werden verworfen, wenn sie dieselbe Mitarbeiter-/Datumszelle widersprüchlich ändern oder zusammen die Ziel-Lücke nicht verbessern. Ranking bleibt nachgelagert: Das Feature-Profil beschreibt betroffene Mitarbeiter, Tage, Boundary-Minuten, neue Arbeitstage, Basisplanabweichung und Carryover-Folgen ohne Score.
