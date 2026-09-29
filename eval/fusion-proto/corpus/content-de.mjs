/**
 * German corpus documents (P3, eval/fusion-proto).
 * All strings are fixed literals — the PDFs must stay byte-deterministic and
 * questions.json quote snippets must keep matching. One section = one page;
 * sections must stay short enough to fit a single A4 page (generator asserts).
 */
export const DE = [
  {
    id: "de-weser-schleusen", file: "de-weser-schleusen.pdf", language: "de",
    title: "Schleusenverband Weser",
    subtitle: "Tätigkeitsbericht 2025",
    org: "Schleusenverband Weser - Bremen, Deutschland",
    sections: [
      {
        title: "Überblick", ps: [
          "Der Schleusenverband Weser betreibt sechs Schleusen zwischen Minden und Bremen und wurde 1938 gegründet.",
          "Der Verband beschäftigt 98 Mitarbeiter und koordiniert die Wasserstände mit drei Unterhaltungsverbänden am Mittellauf.",
        ],
      },
      {
        title: "Anlagen", ps: [
          "Die größte Kammer in Schlüsselburg überwindet 14 Meter Hub und ist 190 Meter lang; die Tore wiegen je 240 Tonnen.",
          "Die Fischtreppen an vier Standorten wurden 2021 erneuert, und die Steuerstände arbeiten seit 2022 fernüberwacht.",
        ],
        bullets: [
          "Größte Kammer: 14 Meter Hub",
          "Kammerlänge: 190 Meter",
          "Fischtreppen: erneuert 2021",
        ],
      },
      {
        title: "Zahlen", ps: [
          "Im Jahr 2025 passierten 11.400 Schiffe die Schleusen, davon 2.300 Sportboote unter deutscher Flagge.",
          "Die Sanierung der Kammer Nienburg kostete 6,7 Millionen Euro und dauerte neun Monate ohne Sperrung.",
        ],
      },
      {
        title: "Pläne", ps: [
          "Die vollständige Automatisierung der Fahrweise ist für 2028 geplant, beginnend mit den beiden kleinen Kammern.",
          "Besucherstege an der Schleuse Petershagen sollen die Führungen am Wochenende entlasten.",
        ],
      },
    ],
  },

  {
    id: "de-odenwald-bergbau", file: "de-odenwald-bergbau.pdf", language: "de",
    title: "Besucherbergwerk Odenwald",
    subtitle: "Jahresheft 2025",
    org: "Besucherbergwerk Odenwald - Erbach, Deutschland",
    sections: [
      {
        title: "Überblick", ps: [
          "Das Besucherbergwerk Odenwald öffnete 1712 als Eisengrube und empfängt seitdem Gäste in den Sommermonaten.",
          "Der Förderverein zählt 340 Mitglieder und hält 46 öffentliche Führungen pro Jahr auf drei Rundwegen.",
        ],
      },
      {
        title: "Anlagen", ps: [
          "Der Hauptstollen ist 4,8 Kilometer lang und reicht 180 Meter tief unter den Berg; die Temperatur bleibt ganzjährig bei neun Grad.",
          "Der Förderturm von 1935 ist das Wahrzeichen des Geländes, und der Turm ist 26 Meter hoch. Die Grubenbahn trägt 24 Besucher pro Fahrt.",
        ],
        bullets: [
          "Hauptstollen: 4,8 Kilometer lang",
          "Teufe: 180 Meter tief",
          "Förderturm von 1935: 26 Meter hoher Turm",
        ],
      },
      {
        title: "Zahlen", ps: [
          "Im Jahr 2025 zählte das Bergwerk 23.000 Besucher und 1.900 Schulkinder in Sonderführungen am Vormittag.",
          "Die Sanierung des Eingangsbereichs kostete 2018 insgesamt 1,2 Millionen Euro aus Landesmitteln.",
        ],
      },
      {
        title: "Pläne", ps: [
          "Ein Erlebnispfad über die Halde öffnet 2027 mit zwölf Stationen zur Bergbaugeschichte.",
          "Das Pumpenhaus am Stollenmund wird zum Seminarraum für Schulklassen umgebaut.",
        ],
      },
    ],
  },

  {
    id: "de-thueringen-porzellan", file: "de-thueringen-porzellan.pdf", language: "de",
    title: "Porzellanmanufaktur Henneberg",
    subtitle: "Werk und Museum, Bericht 2025",
    org: "Porzellanmanufaktur Henneberg - Ilmenau, Deutschland",
    sections: [
      {
        title: "Überblick", ps: [
          "Die Porzellanmanufaktur Henneberg wurde 1902 gegründet und beschäftigt heute 86 Mitarbeiter in sieben Gewerken.",
          "Aus der Werkstatt kommen 240.000 Teile pro Jahr, vor allem Gastronomie- und Hotelporzellan für den Fachhandel.",
        ],
      },
      {
        title: "Anlagen", ps: [
          "Der Rundofen brennt bei 1.280 Grad und fasst 16.000 Teile pro Brand; die Steuerung wurde 2024 erneuert.",
          "Das Firmenmuseum wurde 2010 eröffnet und zeigt 3.100 historische Formen aus zwei Jahrhunderten Modellbau.",
        ],
        bullets: [
          "Brenntemperatur: 1.280 Grad",
          "Museum: 2010 eröffnet",
          "Kapazität pro Brand: 16.000 Teile",
        ],
      },
      {
        title: "Zahlen", ps: [
          "Der Umsatz 2025 lag bei 11,3 Millionen Euro, zwölf Prozent davon mit Sammlereditionen im Direktvertrieb.",
          "Die Energiekosten sanken nach der Wärmerückgewinnung an den Öfen um neun Prozent gegenüber 2024.",
        ],
      },
      {
        title: "Pläne", ps: [
          "Ein drittes Dekorstudio entsteht 2026 im ehemaligen Lagerraum und schafft acht neue Arbeitsplätze.",
          "Die Lehrwerkstatt nimmt zusätzlich zwei Azubis pro Jahr für die Modellierungslehre auf.",
        ],
      },
    ],
  },

  {
    id: "de-helgoland-vogelwarte", file: "de-helgoland-vogelwarte.pdf", language: "de",
    title: "Vogelwarte Nordholm",
    subtitle: "Jahresbericht der Station 2025",
    org: "Vogelwarte Nordholm - Nordholm, Deutschland",
    sections: [
      {
        title: "Überblick", ps: [
          "Die Vogelwarte Nordholm wurde 1910 auf der Düneninsel gegründet und dokumentiert 340 Arten seit Bestehen.",
          "Zwölf Ornithologen betreiben Beringung, Seevogelzählungen und Winterökologie im Wattenmeer vor der Küste.",
        ],
      },
      {
        title: "Anlagen", ps: [
          "Der Turm der Station ragt 18 Meter hoch über die Düne und trägt das Radar für Zugvögel, das 2021 in Dienst ging.",
          "Die Fangstation mit 46 Netzen arbeitet in der Saison von März bis November; die Laborhütte wurde 2019 erweitert.",
        ],
        bullets: [
          "Stations-Turm: 18 Meter hoch",
          "Zugvogelradar: in Dienst 2021",
          "Fangnetze: 46 Stück",
        ],
      },
      {
        title: "Zahlen", ps: [
          "Im Jahr 2025 beringte das Team 21.000 Vögel und bestimmte 97 Prozent der Proben bis zur Art zurück.",
          "Die privaten Spenden erreichten 340.000 Euro und deckten die Hälfte des Stationsbudgets.",
        ],
      },
      {
        title: "Pläne", ps: [
          "Ein Seevogel-Informationszentrum öffnet 2029 neben dem Hafen mit Live-Kameras auf der Brutkolonie.",
          "Die Winterzählungen werden um Drohnenflüge über der Außenplate erweitert.",
        ],
      },
    ],
  },
];
