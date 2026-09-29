/**
 * T3 questions — German queries, part 1 (eval/multilingual-proto).
 * mono-de controls + de->es cross-lingual. Merged into questions.json by
 * generate-corpus.mjs. Fixed literals only.
 */
export const DE_QUESTIONS_1 = [
  // ---- monolingual controls (de-de) ----
  {
    id: "mono-de-havel-dock",
    subset: "dev",
    type: "exact-fact",
    language: "de",
    pair: "de-de",
    question: "Wie lang ist das Trockendock der Havelwerft?",
    docIds: ["de-havel-trockendock"],
    expectedEvidence: [
      { docId: "de-havel-trockendock", page: 3, section: "Anlagen", quoteSnippet: "145 Meter lang" },
    ],
  },
  {
    id: "mono-de-erzgebirge-saege",
    subset: "eval",
    type: "exact-fact",
    language: "de",
    pair: "de-de",
    question: "Wie viel Kubikmeter Fichtenholz verarbeitet das Sägewerk der Erzgebirge Holzmanufaktur pro Jahr?",
    docIds: ["de-erzgebirge-holzmanufaktur"],
    expectedEvidence: [
      { docId: "de-erzgebirge-holzmanufaktur", page: 3, section: "Anlagen", quoteSnippet: "12.500 Kubikmeter" },
    ],
  },
  {
    id: "mono-de-ruhr-abgabe",
    subset: "eval",
    type: "exact-fact",
    language: "de",
    pair: "de-de",
    question: "Wie viel Trinkwasser liefert das Ruhr-Filterwerk täglich ins Netz?",
    docIds: ["de-ruhr-filterwerk"],
    expectedEvidence: [
      { docId: "de-ruhr-filterwerk", page: 4, section: "Zahlen und Kennzahlen", quoteSnippet: "140.000 Kubikmeter Trinkwasser" },
    ],
  },
  {
    id: "mono-de-alpenstern-spiegel",
    subset: "dev",
    type: "exact-fact",
    language: "de",
    pair: "de-de",
    question: "Welchen Durchmesser hat der Hauptspiegel der Alpenstern-Warte?",
    docIds: ["de-alpenstern-warte"],
    expectedEvidence: [
      { docId: "de-alpenstern-warte", page: 3, section: "Anlagen", quoteSnippet: "2,4 Meter Durchmesser" },
    ],
  },

  // ---- cross-lingual: DE query -> ES evidence (de-es) ----
  {
    id: "x-de-es-azud-caudal",
    subset: "dev",
    type: "cross-lingual-fact",
    language: "de",
    pair: "de-es",
    question: "Wie hoch war der mittlere Abfluss am Wehr während der Messkampagne 2024?",
    docIds: ["es-guadalquivir-azud"],
    expectedEvidence: [
      { docId: "es-guadalquivir-azud", page: 4, section: "Cifras de la campaña", quoteSnippet: "82 m³/s" },
    ],
  },
  {
    id: "x-de-es-montseny-gipfel",
    subset: "dev",
    type: "cross-lingual-fact",
    language: "de",
    pair: "de-es",
    question: "Wie hoch ist der höchste Gipfel des Naturschutzgebiets?",
    docIds: ["es-montseny-reserva"],
    expectedEvidence: [
      { docId: "es-montseny-reserva", page: 4, section: "Cifras del territorio", quoteSnippet: "1.706 metros" },
    ],
  },
  {
    id: "x-de-es-almeria-schiffe",
    subset: "eval",
    type: "cross-lingual-fact",
    language: "de",
    pair: "de-es",
    question: "Wie viele Schiffe hat der Getreidehafen im Jahr 2024 abgefertigt?",
    docIds: ["es-almeria-granos"],
    expectedEvidence: [
      { docId: "es-almeria-granos", page: 4, section: "Cifras del ejercicio", quoteSnippet: "46 buques" },
    ],
  },
  {
    id: "x-de-es-azud-reforestacion",
    subset: "eval",
    type: "cross-lingual-fact",
    language: "de",
    pair: "de-es",
    question: "Wie viele Hektar Auwald sollen am Flusswehr aufgeforstet werden?",
    docIds: ["es-guadalquivir-azud"],
    expectedEvidence: [
      { docId: "es-guadalquivir-azud", page: 5, section: "Planificación", quoteSnippet: "90 hectáreas de ribera" },
    ],
  },
];
