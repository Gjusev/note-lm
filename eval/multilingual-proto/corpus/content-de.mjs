/**
 * German corpus documents (T3, eval/multilingual-proto).
 * All strings are fixed literals — the PDFs must stay byte-deterministic and
 * questions.json quote snippets must keep matching. One section = one page;
 * sections must stay short enough to fit a single A4 page (generator asserts).
 */
export const DE = [
  {
    id: "de-havel-trockendock", file: "de-havel-trockendock.pdf", language: "de",
    title: "Havelwerft Trockendock GmbH",
    subtitle: "Geschäftsbericht Werftbetrieb",
    org: "Havelwerft Trockendock GmbH - Brandenburg an der Havel, Deutschland",
    sections: [
      {
        title: "Überblick", ps: [
          "Die Havelwerft Trockendock GmbH betreibt seit 1964 ein Schwimmdock am Stadthafen. Das Dock dient der Inspektion, dem Anstrich und dem Umbau von Binnenschiffen des Fahrwassers Ost.",
          "Zur Werft gehört eine Kaimauer mit zwei Arbeitsgruben und einer energiesparenden Docksohlenbeleuchtung. Die Werft ist zertifizierter Fachbetrieb für Schiffsanstriche und Prüfungen.",
        ],
      },
      {
        title: "Anlagen", ps: [
          "Das Trockendock ist 145 Meter lang und hat eine Hebekraft von 3.800 Tonnen. Ein Portalkran mit 80 Tonnen Tragkraft bedient beide Dockkanten und die Vorfertigungshalle.",
          "Die Ausrüstung umfasst Druckluft-, Schweiß- und Absauganlagen mit ortsfester Stromversorgung an den Dockkanten. Das Pumpenhaus entleert das Dock in vier Stunden.",
        ],
        bullets: [
          "Docklänge: 145 Meter",
          "Hebekraft: 3.800 Tonnen",
          "Portalkran: 80 Tonnen",
        ],
      },
      {
        title: "Zahlen und Kennzahlen", ps: [
          "Die Werft dockt 90 Schiffe pro Jahr an Dock IV an und arbeitet im Sommerhalbjahr mit zwei Vollbelegungen. Im Winterhalbjahr stehen Umbauten und Stahlreparaturen im Vordergrund.",
          "Der Umsatz des Jahres 2025 lag bei 18,4 Millionen Euro, die Belegschaft umfasst 210 Beschäftigte in drei Schichten. Die Auftragsbücher sind bis ins kommende Frühjahr gefüllt.",
        ],
        bullets: [
          "Dockungen: 90 Schiffe pro Jahr",
          "Umsatz 2025: 18,4 Millionen Euro",
          "Beschäftigte: 210",
        ],
      },
      {
        title: "Ausblick", ps: [
          "Für 2027 ist die Erweiterung der Halle für Schiffsgondeln um zwei Großrahmen geplant, damit Gondeln künftig im Haus zusammengebaut werden können.",
          "Die Werft elektrifiziert Kräne und Prüfstände und prüft eine Wärmepumpenheizung für die Sozialräume am Nordabschnitt der Kaimauer.",
        ],
      },
    ],
  },

  {
    id: "de-erzgebirge-holzmanufaktur", file: "de-erzgebirge-holzmanufaktur.pdf", language: "de",
    title: "Erzgebirge Holzmanufaktur",
    subtitle: "Jahresbericht der Manufaktur",
    org: "Erzgebirge Holzmanufaktur GmbH - Annaberg-Buchholz, Deutschland",
    sections: [
      {
        title: "Überblick", ps: [
          "Die Erzgebirge Holzmanufaktur wurde 1908 als Sägemühle gegründet und wird in vierter Generation geführt. Sie verarbeitet Holz aus Wäldern des mittleren Erzgebirges.",
          "Zur Manufaktur gehören ein Sägewerk, sechs Trockenkammern und eine Hobelei. Die Belegschaft umfasst 74 Beschäftigte, darunter 12 Auszubildende.",
        ],
      },
      {
        title: "Anlagen", ps: [
          "Das Sägewerk verarbeitet 12.500 Kubikmeter Fichtenholz pro Jahr zu Bauholz, Dielen und Leimbindern. Resthölzer werden zu Pellets und Hackschnitzeln aufbereitet.",
          "Die sechs Trockenkammern trocknen Schnittholz auf 8 bis 12 Prozent Holzfeuchte. Ein Rechenzentrum überwacht Feuchte und Temperatur jeder Kammer in 30-Minuten-Zyklen.",
        ],
        bullets: [
          "Sägeleistung: 12.500 Kubikmeter Fichtenholz pro Jahr",
          "Trockenkammern: sechs Kammern",
          "Holzfeuchte-Ziel: 8 bis 12 Prozent",
        ],
      },
      {
        title: "Zahlen und Kennzahlen", ps: [
          "Der Umsatz des Jahres 2025 lag bei 9,8 Millionen Euro. 31 Prozent des Absatzes gehen an Möbelmanufakturen, der Rest an Bauunternehmen und den Handel.",
          "Die Manufaktur ist seit 2011 PEFC-zertifiziert und bezieht das Stammholz ausschließlich aus 60 Kilometern Umkreis. Die Beschaffung läuft über Forstvereine.",
        ],
        bullets: [
          "Umsatz 2025: 9,8 Millionen Euro",
          "Absatz an Möbelmanufakturen: 31 Prozent",
          "PEFC-zertifiziert seit 2011",
        ],
      },
      {
        title: "Ausblick", ps: [
          "Für 2026 ist eine neue Hobelstraße mit automatischer Sortierung geplant, die auch kleine Partien wirtschaftlich bearbeiten soll.",
          "Eine Photovoltaikanlage auf dem Lagerhof soll 30 Prozent des Strombedarfs decken, ein Batteriespeicher puffert Spitzen der Sägegatter.",
        ],
      },
    ],
  },

  {
    id: "de-ruhr-filterwerk", file: "de-ruhr-filterwerk.pdf", language: "de",
    title: "Ruhr-Filterwerk Wasserwerke",
    subtitle: "Technischer Jahresbericht Trinkwasser",
    org: "Ruhr-Filterwerk Wasserwerke GmbH - Essen, Deutschland",
    sections: [
      {
        title: "Überblick", ps: [
          "Das Ruhr-Filterwerk speist seit 2011 aufbereitetes Trinkwasser in das Verbundnetz der Zentralruhr. Es versorgt Haushalte, Schulen und lebensverarbeitende Betriebe.",
          "Die Wassergewinnung erfolgt aus Uferfiltrat und Grundwasseranreicherung. Ein hydrogeologisches Monitoring begleitet die Fördermengen und die Grundwasserstände.",
        ],
      },
      {
        title: "Anlagen", ps: [
          "Die Ultrafiltration arbeitet mit Hohlfasermodulen mit Poren von 0,02 Mikrometer und trennt Keime, Partikel und Trübstoffe zuverlässig aus dem Rohwasser.",
          "Acht Filterstraßen laufen parallel; die Rückspülung jeder Straße erfolgt alle 40 Minuten ohne chemische Zusätze. Das Rückspülwasser wird im Kreislauf geführt.",
        ],
        bullets: [
          "Porenweite der Ultrafiltration: 0,02 Mikrometer",
          "Filterstraßen: acht parallel",
          "Rückspülung: alle 40 Minuten",
        ],
      },
      {
        title: "Zahlen und Kennzahlen", ps: [
          "Das Werk liefert durchschnittlich 140.000 Kubikmeter Trinkwasser pro Tag ins Netz und hält die Wiederfindungsquote bei 96 Prozent. Verluste durch Rückspülung werden recycelt.",
          "Der spezifische Energieverbrauch liegt bei 0,11 Kilowattstunden je Kubikmeter, gemessen über alle Stufen von der Förderung bis zur Netzeinspeisung.",
        ],
        bullets: [
          "Abgabe: 140.000 Kubikmeter Trinkwasser pro Tag",
          "Wiederfindungsquote: 96 Prozent",
          "Energieverbrauch: 0,11 kWh je Kubikmeter",
        ],
      },
      {
        title: "Ausblick", ps: [
          "Für 2027 ist eine Aktivkohlestufe gegen Spurenstoffe geplant, die nach der Ultrafiltration geschaltet wird und Pestizidmetabolite reduziert.",
          "Ein digitaler Zwilling der Filterstraßen soll Rückspülstrategien simulieren und den Einsatz der Pumpen optimieren, bevor er in der Leitstelle freigeschaltet wird.",
        ],
      },
    ],
  },

  {
    id: "de-alpenstern-warte", file: "de-alpenstern-warte.pdf", language: "de",
    title: "Alpenstern-Warte",
    subtitle: "Tätigkeitsbericht der Sternwarte",
    org: "Alpenstern-Warte - Ötztal, Österreich",
    sections: [
      {
        title: "Überblick", ps: [
          "Die Alpenstern-Warte steht auf 2.120 Metern Seehöhe am Rand des Ötztals und wurde 1984 errichtet. Die Lage über der Inversionsgrenze garantiert trockene Bergluft.",
          "Träger der Sternwarte ist ein Forschungsverein; Universitäten nutzen die Teleskopzeit über ein Antragsverfahren. Die Anlage ist im Winter nur per Pistenraupe erreichbar.",
        ],
      },
      {
        title: "Anlagen", ps: [
          "Der Hauptspiegel hat einen Durchmesser von 2,4 Meter und wurde 1987 montiert. Die Kuppel misst 9 Meter im Durchmesser und öffnet mit zwei Schmetterlingsklappen.",
          "Das Nachführsystem korrigiert die Abdrehung über ein Encoder-Netz; ein Adaptive-Optik-Modul korrigiert Turbulenzen in der unteren Atmosphäre.",
        ],
        bullets: [
          "Hauptspiegel: 2,4 Meter Durchmesser",
          "Kuppeldurchmesser: 9 Meter",
          "Montage des Spiegels: 1987",
        ],
      },
      {
        title: "Zahlen und Kennzahlen", ps: [
          "Die Warte zählt 210 klare Nächte pro Jahr mit brauchbaren Beobachtungsbedingungen, verteilt auf Sommer- und Wintertrilateration der Beobachtungspläne.",
          "Das Team besteht aus 34 Mitarbeitenden, darunter Nachtwächter, Ingenieure und zwei Instrumentenentwickler. Das Jahresbudget beträgt 4,8 Millionen Euro.",
        ],
        bullets: [
          "Klare Nächte: 210 klare Nächte pro Jahr",
          "Mitarbeitende: 34",
          "Jahresbudget: 4,8 Millionen Euro",
        ],
      },
      {
        title: "Ausblick", ps: [
          "Ein Stellitenspektrograf geht 2027 in Betrieb und erweitert die Warte um radialgeschwindigkeitsbasierte Suchverfahren nach fernen Planetensystemen.",
          "Das Schülerprogramm vermittelt jährlich 1.500 Teilnehmende in Beobachtungswochen; beteiligte Schulen stammen aus Tirol, Südtirol und Bayern.",
        ],
      },
    ],
  },
];
