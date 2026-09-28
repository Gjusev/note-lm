/**
 * German corpus documents (PI-0, document-trees-v1).
 * All strings are fixed literals — edit only with care, the PDFs must stay
 * byte-deterministic and questions.json quotes must keep matching.
 */
export const DE = [
  {
    id: "de-elbe-werft", file: "de-elbe-werft.pdf", language: "de",
    title: "Elbe Werft",
    subtitle: "Jahresbericht 2025",
    org: "Elbe Werft GmbH - Lauenburg an der Elbe",
    toc: true, notes: ["table"],
    sections: [
      {
        title: "Das Unternehmen", ps: [
          "Die Elbe Werft GmbH wurde 1919 in Lauenburg an der Elbe gegründet und baut heute Binnenschiffe und kleine Seeschiffe. Das Unternehmen beschäftigt 410 Mitarbeiter an zwei Helgen.",
          "Zur Werft gehören eine Maschinenhalle, eine Dockanlage und eine eigene Konstruktionsabteilung mit 32 Ingenieuren. Die Ausbildungswerkstatt bildet in vier Gewerken aus.",
        ],
      },
      {
        title: "Auftragsbestand 2025", ps: [
          "Zum 31. Dezember 2025 umfasste der Auftragsbestand sechs Neubauten mit einem Auftragswert von 41,2 Millionen EUR. Der Bestand lag damit 14 Prozent über dem Vorjahr.",
          "Im Jahr 2025 wurden vier Schiffe abgeliefert. Die durchschnittliche Bauzeit je Schiff betrug elf Monate, ein Monat weniger als im Vorjahr.",
        ],
      },
      {
        title: "Schiffbauprojekte", ps: [
          "Die Tabelle listet die im Jahr 2025 abgelieferten und laufenden Baunummern. Die Längenangabe bezieht sich auf das Schiff über alles.",
          "Baunummer 584 ist das erste Schiff der Werft mit einem gasbetriebenen Bordnetz für den Hafenaufenthalt. Die Ablieferung ist für April 2026 geplant.",
        ], table: {
          caption: "Tabelle 1: Bauprogramm 2025",
          columns: ["Baunr.", "Schiffstyp", "Länge", "Ablieferung"],
          widths: [0.14, 0.44, 0.18, 0.24],
          rows: [
            ["581", "Frachtmotorschiff", "110 m", "April 2025"],
            ["582", "Schubverband", "98 m", "Juni 2025"],
            ["583", "Passagierfähre", "72 m", "September 2025"],
            ["584", "Tankmotorschiff", "135 m", "April 2026"],
            ["585", "Frachtmotorschiff", "110 m", "Juli 2026"],
            ["586", "Baggerschiff", "54 m", "Oktober 2026"],
          ],
        },
      },
      {
        title: "Reparaturbetrieb", ps: [
          "Der Reparaturbetrieb führte 2025 insgesamt 96 Aufträge durch. Die mediane Standzeit im Dock betrug elf Tage, drei Tage weniger als im Jahr zuvor.",
          "Die Dockkapazität beträgt 3.000 Tonnen Tragfähigkeit. Der größte Einzelauftrag war die Generalüberholung eines 90-Meter-Gütermotorschiffs mit Überholung der Maschinenanlage.",
        ],
      },
      {
        title: "Finanzen", ps: [
          "Der Umsatz der Werft lag 2025 bei 68,7 Millionen EUR, der Exportanteil betrug 22 Prozent. Das Ergebnis vor Steuern betrug 1,9 Millionen EUR.",
          "Die Eigenkapitalquote stieg auf 31 Prozent. Die Investitionen umfassten vor allem einen neuen 60-Tonnen-Kran und die Erweiterung der Lackierhalle.",
        ],
      },
      {
        title: "Ausblick", ps: [
          "Gemeinsam mit zwei Partnern entwickelt die Werft ein Wasserstoff-Bordnetz für Binnenschiffe; ein Versuchsträger läuft ab Sommer 2026 auf der Elbe.",
          "Die Ausbildungsquote liegt bei 8 Prozent. Für 2027 ist der Bau einer zweiten Schiffbauhalle geplant, die beide Helgen ganzjährig überspannen soll.",
        ],
      },
    ],
  },

  {
    id: "de-alpen-bahnen", file: "de-alpen-bahnen.pdf", language: "de",
    title: "Alpen Bahnen AG",
    subtitle: "Geschäftsbericht 2025",
    org: "Alpen Bahnen AG - Steinbach im Tal",
    toc: true, notes: ["table"],
    sections: [
      {
        title: "Das Unternehmen", ps: [
          "Die Alpen Bahnen AG betreibt am Talort Steinbach vier Seilbahnanlagen und wurde 1949 von einer Genossenschaft gegründet. Das Unternehmen beschäftigt 96 Festangestellte und in der Wintersaison 140 Saisonkräfte.",
          "Die Aktienmehrheit hält seit 2011 die Gemeinde Steinbach. Der Vorstand besteht aus zwei Personen, der Aufsichtsrat aus sieben Mitgliedern.",
        ],
      },
      {
        title: "Bahnen und Anlagen", ps: [
          "Die Tabelle zeigt die vier Anlagen mit Bauart, Länge und Förderleistung je Stunde. Die Gipfelbahn wurde 1998 errichtet und 2019 modernisiert.",
          "Der Sessellift Rohrmoos wird nur im Winter betrieben. Die Sombreilienbahn erschliesst den Sommerwanderpark und fährt von Mai bis Oktober.",
        ], table: {
          caption: "Tabelle 1: Anlagenübersicht 2025",
          columns: ["Anlage", "Bauart", "Länge", "Personen/h"],
          widths: [0.30, 0.30, 0.18, 0.22],
          rows: [
            ["Gipfelbahn", "Luftseilbahn", "2.340 m", "1.800"],
            ["Rohrmoos", "Sessellift", "1.150 m", "1.200"],
            ["Sonnenhang", "Sessellift", "980 m", "1.000"],
            ["Sonnenbahn", "Gondelbahn", "1.720 m", "1.500"],
          ],
        },
      },
      {
        title: "Gäste und Fahrgäste", ps: [
          "In der Wintersaison 2024/25 beförderten die Anlagen 512.000 Fahrgäste, in der Sommersaison 2025 waren es 189.000. Der Tages-Skipass kostet im Winter 62 EUR.",
          "Der Sommerbetrieb erreichte einen Anteil von 27 Prozent am Gesamtumsatz. Die Berggastronomie mit zwei Restaurants verzeichnete 96.000 Bewirtungen.",
        ],
      },
      {
        title: "Beschneiung und Pisten", ps: [
          "Das Pistenangebot umfasst 38 Kilometer, davon sind 24 Kilometer beschneibar. Für die Beschneiung stehen 54 Schneekanonen und ein Wasserspeicher von 120.000 Kubikmetern zur Verfügung.",
          "Die Saison 2024/25 begann am 6. Dezember mit beschneiten Pisten und endete am 13. April. Die mittlere Schneehöhe in der Talstation lag bei 41 Zentimetern.",
        ],
      },
      {
        title: "Energiemanagement", ps: [
          "Der Jahresverbrauch der gesamten Anlagengruppe lag bei 9,8 Gigawattstunden, davon entfallen 7,1 Gigawattstunden auf den Winterbetrieb mit Beschneiung.",
          "Seit 2023 deckt eine Photovoltaikanlage mit 420 Kilowattspitze einen Teil des Sommerbedarfs. Die Beleuchtung aller Stationen wurde auf LED umgestellt.",
        ],
      },
      {
        title: "Projekte 2026", ps: [
          "Für den Sommer 2026 ist der Ersatz der Gipfelbahn durch eine 10er-Gondelbahn geplant. Die Investitionssumme beträgt 24 Millionen EUR, die Baugenehmigung liegt vor.",
          "Im Bereich Lawinenschutz werden 1,2 Kilometer Verbauungen oberhalb der Talabfahrt erneuert. Die Arbeiten erfolgen im Spätsommer mit mit Seilwinde und Kran.",
        ],
      },
    ],
  },

  {
    id: "de-rhein-muehlen", file: "de-rhein-muehlen.pdf", language: "de",
    title: "Rhein Mühlenwerke",
    subtitle: "Geschäftsbericht 2025",
    org: "Rhein Mühlenwerke GmbH - Worms",
    toc: true, notes: ["table"],
    sections: [
      {
        title: "Konzernüberblick", ps: [
          "Die Rhein Mühlenwerke GmbH wurden 1888 als Familienstiftung gegründet und betreiben heute drei Mühlenstandorte entlang des Rheins. Die Gruppe beschäftigt 180 Personen.",
          "Der Hauptsitz mit Verwaltung und Hauptmühle liegt in Worms. Zwei weitere Standorte in Karlsruhe und Mainz arbeiten als reine Produktionsmühlen.",
        ],
      },
      {
        title: "Mahlleistung und Produkte", ps: [
          "Die Tabelle zeigt die Mahlleistung 2025 je Standort und Produktgruppe sowie die vorhandene Silokapazität. Mehl der Type 550 bleibt das mengenstärkste Produkt.",
          "Die Gesamtvermahlung betrug 128.000 Tonnen. Der Ausbau des Vollkornbereichs führte zu einer Verschiebung von 4.000 Tonnen Weizenmehl auf Roggenvollkorn.",
        ], table: {
          caption: "Tabelle 1: Mahlleistung 2025",
          columns: ["Standort", "Produkt", "Tonnen", "Silo (t)"],
          widths: [0.20, 0.40, 0.18, 0.22],
          rows: [
            ["Worms", "Weizenmehl Type 550", "46.000", "12.000"],
            ["Worms", "Weizenvollkorn", "9.500", "3.000"],
            ["Karlsruhe", "Roggenmehl Type 997", "21.000", "6.500"],
            ["Karlsruhe", "Roggenvollkorn", "8.400", "2.800"],
            ["Mainz", "Dinkelmehl Type 630", "17.300", "5.200"],
            ["Mainz", "Backmischungen", "25.800", "4.000"],
          ],
        },
      },
      {
        title: "Rohstoffbeschaffung", ps: [
          "Rund 87 Prozent des Getreides stammen von 210 vertraglich gebundenen Landwirten der Region. Der Eiweißgehalt des eingekauften Weizens lag 2025 bei 12,5 Prozent.",
          "Die Lagerung im Silobereich ist auf maximal neun Monate ausgelegt. Eine Rückstandskontrolle je Partie ist vor der Vermahlung verpflichtend.",
        ],
      },
      {
        title: "Qualität", ps: [
          "Im Jahr 2025 wurden 1.900 Rückstandsprüfungen durchgeführt. Die Ausschussquote lag bei 0,4 Prozent und damit unter dem Branchenwert von 0,8 Prozent.",
          "Alle drei Standorte sind nach IFS Food auf dem höheren Level zertifiziert. Das Brottester-Team bewertet wöchentlich eine Backprobe aus der Kundenschulung.",
        ],
      },
      {
        title: "Logistik", ps: [
          "Die Auslieferung erfolgt zu 42 Prozent per Lkw, zu 33 Prozent per Bahn und zu 25 Prozent mit Binnenschiff. Die eigene Flotte umfasst 18 Silofahrzeuge.",
          "Der Bahnanschluss in Worms wurde 2024 erneuert und trägt seitdem drei Ganzzüge pro Woche. Die mittlere Distanz bis zum Kunden betrug 96 Kilometer.",
        ],
      },
      {
        title: "Energie und Klima", ps: [
          "Der Stromverbrauch lag 2025 bei 6,2 Gigawattstunden, wovon das Blockheizkraftwerk der Hauptmühle 1,9 Gigawattstunden beisteuerte.",
          "Die Treibhausgasemissionen je Tonne Mehl betrugen 78 Kilogramm CO2-Äquivalent. Ziel bis 2030 ist ein Wert von 60 Kilogramm durch Strom aus eigenen Anlagen.",
        ],
      },
    ],
  },

  {
    id: "de-ostsee-hafen", file: "de-ostsee-hafen.pdf", language: "de",
    title: "Ostsee Hafenverwaltung",
    subtitle: "Hafenbericht 2025",
    org: "Ostsee Hafenverwaltung GmbH",
    toc: false, notes: ["no-toc"],
    sections: [
      {
        title: "Hafenüberblick", ps: [
          "Die Ostsee Hafenverwaltung GmbH betreibt einen Seehafen mit vier Terminals und 22 Liegeplätzen. Der gesamte Güterumschlag betrug 2025 rund 8,4 Millionen Tonnen.",
          "Der Hafen beschäftigt 340 Festangestellte und schichtet im Hafenbetrieb in drei Wachen. Der Schwerpunkt des Umschlags liegt auf Schüttgut und Fähren.",
        ],
      },
      {
        title: "Umschlag nach Güterart", ps: [
          "Die Tabelle ordnet die Umschlagsmengen 2025 nach Güterart. Getreide bleibt mit deutlichem Abstand das wichtigste Massengut im Hafen.",
          "Der Stückgutumschlag entfällt fast vollständig auf Stahl und Forsterzeugnisse. Der Gesamtumschlag stieg gegenüber dem Vorjahr um 3 Prozent.",
        ], table: {
          caption: "Tabelle 1: Umschlag 2025 nach Güterart",
          columns: ["Güterart", "Tonnen", "Anteil"],
          widths: [0.44, 0.30, 0.26],
          rows: [
            ["Getreide", "2.100.000", "25%"],
            ["Dünger", "1.430.000", "17%"],
            ["Fahrgäste Fähre", "820.000", "10%"],
            ["Stahl und Bleche", "690.000", "8%"],
            ["Holz und Zellstoff", "560.000", "7%"],
            ["Lkw Fähre", "38.000", "5%"],
            ["Zementklinker", "410.000", "5%"],
            ["Torf", "260.000", "3%"],
            ["Container TEU", "84.000", "10%"],
            ["Sonstige", "920.000", "10%"],
          ],
        },
      },
      {
        title: "Reedereien und Linien", ps: [
          "Der Hafen bedient 14 feste Linienverbindungen. Die Fährverbindung nach Schweden verkehrt zweimal täglich mit einer Kapazität von 1.800 Passagieren je Abfahrt.",
          "Zwei Reedereien haben ihre Linien 2025 auf größere Einheiten umgestellt. Der Frachtfahrplan der Fähre berücksichtigt seit April die Sperrzeiten der Klappbrücke.",
        ],
      },
      {
        title: "Bahnanbindung", ps: [
          "Der Hafen verfügt über drei Gleisanschlüsse mit insgesamt 41 Kilometern Gleislänge. Rund 210 Güterzüge fahren wöchentlich in den Hafen ein oder aus ihm heraus.",
          "Der Rangierbetrieb wird mit einer Elektrolokomotive und einer dieselelektrischen Reserve bespannt. Die Ladegleise der Getreideterminals wurden auf 720 Meter verlängert.",
        ],
      },
      {
        title: "Umweltschutz", ps: [
          "Seit 2022 stehen an sechs Liegeplätzen Landstromanschlüsse für Seeschiffe bereit. Der Schadstoffausstoß der liegenden Schiffe sank dadurch um 40 Prozent.",
          "Das Hafenmuseum wird mit Abwärme des Verwaltungsgebäudes beheizt. Regenwasser von den Umschlagflächen der Düngeraufstellung wird über ein eigenes Becken gereinigt.",
        ],
      },
      {
        title: "Personal und Ausbildung", ps: [
          "Die Verwaltung bildet in zwölf Berufen aus und beschäftigt derzeit 12 Auszubildende. Die Übernahmequote nach der Ausbildung lag 2025 bei 92 Prozent.",
          "Für den Kranführerberuf wurde ein Eignungstest eingeführt. Der Krankenstand im Hafenbetrieb betrug 4,6 Prozent und liegt damit unter dem Wert des Vorjahres.",
        ],
      },
      {
        title: "Zukunft und Bauprojekte", ps: [
          "Für 2026 ist die Verlängerung des Kais 4 um 180 Meter geplant, damit größere Fähren festmachen können. Die Planfeststellung wurde im November 2025 abgeschlossen.",
          "Das zweite Großprojekt ist eine Umschlaghalle für Recyclingstoffe mit 12.000 Quadratmetern Grundfläche. Beide Projekte sind mit 74 Millionen EUR veranschlagt.",
        ],
      },
    ],
  },

  {
    id: "de-schwarzwald-kurhaus", file: "de-schwarzwald-kurhaus.pdf", language: "de",
    title: "Kurhaus Tannenfels",
    subtitle: "Rechenschaftsbericht 2025",
    org: "Kurhaus Tannenfels - Tannenfels im Schwarzwald",
    toc: true, notes: ["misleading-headings"],
    sections: [
      {
        title: "Das Haus", ps: [
          "Das Kurhaus Tannenfels eröffnete 1902 als Badehaus mit eigener Thermalquelle von 34 Grad Wassertemperatur. Es bietet heute 84 Zimmer und drei Tagungsräume.",
          "Das Gebäude steht unter Denkmalschutz. Die glasgedeckte Vorhalle von 1928 wurde 2024 denkmalgerecht saniert und ist wieder vollständig geöffnet.",
        ],
      },
      {
        title: "Investitionen und Liquidität", ps: [
          "Unter dieser Überschrift berichtet das Haus über Kräuteranwendungen und Wellness-Behandlungen, die 2025 aus dem Pflegefonds des Kurgartens mitfinanziert wurden.",
          "Das Anwendungsangebot umfasste 24 Behandlungen, darunter Heublumenbad, Algenpackung und Steinhofenmassage. Es wurden 9.100 Anwendungen gebucht, 18 Prozent mehr als 2024.",
        ],
      },
      {
        title: "Gäste und Belegung", ps: [
                    "2025 verzeichnete das Haus 41.600 Übernachtungen bei einer Auslastung von 63 Prozent. Die durchschnittliche Aufenthaltsdauer betrug 4,2 Nächte.",
          "Der Gästestamm ist geprägt von Stammgästen: 44 Prozent der Buchungen stammen von Wiederkehrern. Die Nebensaison wurde mit zwei Musikwochen stabilisiert.",
        ],
      },
      {
        title: "Personal und Dienstpläne", ps: [
          "Dieser Abschnitt behandelt den Kurpark und die Gartenarchitektur, deren Pflege aus dem Personalkreis der Gärtnerei mit drei festen Kräften sichergestellt wird.",
          "Der Kurpark umfasst 6,2 Hektar mit 180 alten Bäumen. Der Rundweg durch den Park ist 2,4 Kilometer lang und im Winter geräumt, zuletzt wurde der Rosengarten umgeplant.",
        ],
      },
      {
        title: "Gastronomie", ps: [
          "Das Restaurant servierte 2025 rund 58.000 Menüs, davon 71 Prozent als Halbpension für Hausgäste. Die Küche arbeitet mit regionalen Lieferanten aus einem Umkreis von 50 Kilometern.",
          "Die Schwarzwälder Spezialitätenkarte wurde im Herbst 2025 neu aufgelegt. Das Frühstücksservice öffnet seit März kontinuierlich ab 7 Uhr morgens.",
        ],
      },
      {
        title: "Nachhaltigkeit", ps: [
          "Das Haus wird über das Fernwärmenetz mit Holz aus dem Stadtwald beheizt. Auf dem Dach der Therme erzeugen 120 Solarmodule warmes Brauchwasser.",
          "Einwegplastik wurde in allen Bereichen ersetzt. Der Wasserverbrauch je übernachtetem Gast sank durch Perlatoren und Wäscheoptimierung auf 168 Liter.",
        ],
      },
    ],
  },

  {
    id: "de-mosel-weinberg", file: "de-mosel-weinberg.pdf", language: "de",
    title: "Weingut Moselhang",
    subtitle: "Jahresbericht 2025",
    org: "Weingut Moselhang - Kinheim-Brück an der Mosel",
    toc: true, notes: ["table"],
    sections: [
      {
        title: "Das Weingut", ps: [
          "Das Weingut Moselhang wird seit 1683 in Familienbesitz geführt und bewirtschaftet heute 11 Hektar Rebfläche in Steillage und Flachlage bei Kinheim-Brück.",
          "Das Gut arbeitet seit 2014 nach kontrolliert ökologischen Richtlinien und ist seit 2019 zertifiziert. Die Kelleranlage unter dem Gutshaus ist teils aus dem 18. Jahrhundert erhalten.",
        ],
      },
      {
        title: "Lagen und Rebsorten", ps: [
          "Der Sortenspiegel: Riesling 74 Prozent, Elbling 12 Prozent, Spätburgunder 9 Prozent und weitere Sorten 5 Prozent. Rund 55 Prozent der Fläche liegt in Steillage.",
          "Die Top-Lage ist der Sonnenuhr-Hang mit über 60 Jahren alten Reben. Dort werden die Spätlesen und der Große Gewächs geerntet, die übrige Fläche liefert die Gutsweine.",
        ],
      },
      {
        title: "Lese 2025", ps: [
          "Die Lese 2025 begann am 29. September und endete am 24. Oktober. Es wurden 58.000 Liter Most eingebracht bei einem mittleren Mostgewicht von 88 Grad Oechsle.",
          "Der Spätburgunder wurde am 6. Oktober geerntet und vergärte in offenen Eichenbottichen. Der gesunde Lesegang erlaubte erstmals seit 2021 wieder eine Spätlese trocken.",
        ],
      },
      {
        title: "Keller und Ausbau", ps: [
          "Der Ausbau erfolgt überwiegend im Stahlfass; für die Spätburgunder und einige Rieslingparzellen stehen 380 Stückfässer zu 1.000 Litern bereit. Die Gärtemperatur wird bei 16 Grad gehalten.",
          "Die Füllung der Weine erfolgt ohne Schönung mit leichter Filtration. Die Restzuckerwerte der trockenen Weine liegen unter sechs Gramm je Liter.",
        ],
      },
      {
        title: "Vermarktung", ps: [
          "Die Tabelle zeigt die Absatzmengen 2025 je Wein mit durchschnittlichem Ab-Hof-Preis. Rund 60 Prozent der Weine werden direkt ab Hof verkauft.",
          "Der Rest verteilt sich auf Fachhandel und Gastronomie in vier Bundesländern. Ein Auslandskunde in Dänemark bezieht seit 2024 eine feste Jahresmenge.",
        ], table: {
          caption: "Tabelle 1: Absatz 2025",
          columns: ["Wein", "Flaschen", "Preis EUR"],
          widths: [0.46, 0.28, 0.26],
          rows: [
            ["Riesling Gutswein trocken", "62.000", "9,80"],
            ["Riesling Sonnenuhr Kabinett", "8.400", "16,50"],
            ["Riesling Spätlese trocken", "3.100", "22,00"],
            ["Elbling spritzig", "14.500", "6,90"],
            ["Spätburgunder trocken", "5.200", "14,80"],
            ["Secco Riesling", "4.000", "8,50"],
          ],
        },
      },
      {
        title: "Veranstaltungen", ps: [
          "Das Gut veranstaltete zwei Hoffeste im Mai und August mit zusammen 1.600 Gästen. Die Weinseminare im Gewölbekeller zählten 340 Teilnehmer.",
          "Erstmals wurde eine Herbstwanderung mit Lesefrühstück angeboten; die 120 Plätze waren innerhalb einer Woche vergeben. Das nächste Hoffest ist für Mai 2026 terminiert.",
        ],
      },
    ],
  },

  {
    id: "de-brandenburg-observatorium", file: "de-brandenburg-observatorium.pdf", language: "de",
    title: "Brandenburg Observatorium",
    subtitle: "Tätigkeitsbericht 2025",
    org: "Brandenburg Observatorium Lindhorst e.V.",
    toc: false, notes: ["no-toc"],
    sections: [
      {
        title: "Das Observatorium", ps: [
          "Das Brandenburg Observatorium Lindhorst wurde 1976 als Volkssternwarte gegründet und liegt am Nordrand des Ortes Lindhorst. Hauptinstrument ist ein 70-Zentimeter-Spiegelteleskop.",
          "Der Verein betreibt die Sternwarte mit ehrenamtlichen Beobachtern. Die Kuppel steht auf dem Gelände einer ehemaligen Wasseraufbereitungsanlage.",
        ],
      },
      {
        title: "Instrumente", ps: [
          "Das 70-Zentimeter-Teleskop ist ein Newton-System mit Brennweite 3,2 Meter. Es verfügt über einen Spektrograf mit Auflösung R = 9.000 und eine monochrome Kamera für Photometrie.",
          "Eine Kleinwetterstation mit Bewölkungssensor steuert den Beobachtungsbetrieb automatisch. Seit 2023 läuft eine Allsky-Kamera für Meteorbestimmungen mit vier Fisheye-Kameras.",
        ],
      },
      {
        title: "Beobachtungsprogramm", ps: [
          "2025 waren 148 Nächte astronomisch nutzbar. Im Asteroidenprogramm wurden 96 neue Objekte vermessen und an die Kleinplanetenzentrale gemeldet.",
          "Im Programm Sternbedeckungen wurden 22 Ereignisse erfolgreich beobachtet. Die Messreihen zu veränderlichen Sternen umfassen 620 Einzelmessungen in vier Monaten.",
        ],
      },
      {
        title: "Nachwuchs und Schule", ps: [
          "An Führungen und Schulprogrammen nahmen 1.900 Schülerinnen und Schüler teil. Drei Arbeitsgemeinschaften von weiterführenden Schulen arbeiten regelmäßig in der Sternwarte.",
          "Der Teleskopführerschein wurde 2025 von 41 Teilnehmern erworben. Ein Praktikumsplatz für Ferienschüler wurde erstmals mit einer Firma aus der Region geteilt.",
        ],
      },
      {
        title: "Amateurkooperation", ps: [
          "Der Förderverein zählt 40 Mitglieder und organisiert sechs Beobachtungswochenenden im Jahr. Die Messreihen der Mitglieder speisen die Datenbank des Observatoriums.",
          "Im September 2025 veranstaltete der Verein eine Konferenz zu Kleinplaneten mit 90 Teilnehmern. Zwei Vorträge wurden als Aufzeichnung veröffentlicht.",
        ],
      },
      {
        title: "Technik und Instandhaltung", ps: [
          "Der Kuppelantrieb wurde im Februar 2025 erneuert, nachdem die alte Zahnstange verschlissen war. Die Nachführung läuft seither mit Schrittmotoren und Endschaltern.",
          "Das Rechnernetz besteht aus zwei Servern und vier Knotenpunkten. Die Spiegelaluminisierung des Hauptspiegels ist für das Frühjahr 2026 geplant.",
        ],
      },
      {
        title: "Finanzen und Förderung", ps: [
          "Die Einnahmen 2025 setzten sich aus Mitgliedsbeiträgen (9.200 EUR), Spenden (6.800 EUR) und einer kommunalen Förderung (14.000 EUR) zusammen.",
          "Größter Ausgabenposten war die Instandhaltung mit 12.400 EUR. Eine Stiftung fördert 2026 die Beschaffung eines neuen Spektrografen mit 8.500 EUR.",
        ],
      },
    ],
  },
];
