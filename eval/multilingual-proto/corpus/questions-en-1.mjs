/**
 * T3 questions — English queries, part 1 (eval/multilingual-proto).
 * mono-en controls + en->es cross-lingual. Merged into questions.json by
 * generate-corpus.mjs. Fixed literals only.
 */
export const EN_QUESTIONS_1 = [
  // ---- monolingual controls (en-en) ----
  {
    id: "mono-en-brightwater-berths",
    subset: "dev",
    type: "exact-fact",
    language: "en",
    pair: "en-en",
    question: "How many berths does the Brightwater Marina Trust manage?",
    docIds: ["en-brightwater-marina"],
    expectedEvidence: [
      { docId: "en-brightwater-marina", page: 2, section: "Overview", quoteSnippet: "385 berths" },
    ],
  },
  {
    id: "mono-en-larkfield-temperature",
    subset: "dev",
    type: "exact-fact",
    language: "en",
    pair: "en-en",
    question: "At what temperature is the main vault of the Larkfield Seed Bank held?",
    docIds: ["en-larkfield-seedbank"],
    expectedEvidence: [
      { docId: "en-larkfield-seedbank", page: 3, section: "Facilities", quoteSnippet: "-18 °C" },
    ],
  },
  {
    id: "mono-en-harrow-output",
    subset: "eval",
    type: "exact-fact",
    language: "en",
    pair: "en-en",
    question: "How much container glass does Harrow Glassworks deliver per year?",
    docIds: ["en-harrow-glassworks"],
    expectedEvidence: [
      { docId: "en-harrow-glassworks", page: 3, section: "Facilities", quoteSnippet: "14,000 tonnes of container glass" },
    ],
  },
  {
    id: "mono-en-whitmore-paper",
    subset: "eval",
    type: "exact-fact",
    language: "en",
    pair: "en-en",
    question: "How much paper did Whitmore Printworks consume in 2025?",
    docIds: ["en-whitmore-printworks"],
    expectedEvidence: [
      { docId: "en-whitmore-printworks", page: 4, section: "Figures", quoteSnippet: "1,900 tonnes of paper" },
    ],
  },
  // ---- cross-lingual: EN query -> ES evidence (en-es, 3) ----
  {
    id: "x-en-es-montseny-declaracion",
    subset: "dev",
    type: "cross-lingual-fact",
    language: "en",
    pair: "en-es",
    question: "In which year was the biosphere reserve designated?",
    docIds: ["es-montseny-reserva"],
    expectedEvidence: [
      { docId: "es-montseny-reserva", page: 2, section: "Resumen general", quoteSnippet: "en 1978" },
    ],
  },
  {
    id: "x-en-es-valdepeluca-vendimia",
    subset: "eval",
    type: "cross-lingual-fact",
    language: "en",
    pair: "en-es",
    question: "How many tonnes of grapes were harvested at the Rioja winery in 2024?",
    docIds: ["es-valdepeluca-cavas"],
    expectedEvidence: [
      { docId: "es-valdepeluca-cavas", page: 4, section: "Cifras de la vendimia", quoteSnippet: "2.900 toneladas de uva" },
    ],
  },
  {
    id: "x-en-es-almeria-calado",
    subset: "eval",
    type: "cross-lingual-fact",
    language: "en",
    pair: "en-es",
    question: "How deep is the berth at the grain terminal?",
    docIds: ["es-almeria-granos"],
    expectedEvidence: [
      { docId: "es-almeria-granos", page: 3, section: "Instalaciones", quoteSnippet: "9,5 metros" },
    ],
  },
];
