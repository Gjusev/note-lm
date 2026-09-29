/**
 * P3 questions — English queries (eval/fusion-proto).
 * Merged into questions.json by generate-corpus.mjs. Fixed literals only.
 * See questions-es.mjs for the type definitions.
 */
export const EN_QUESTIONS = [
  // ---- monolingual controls (en-en) ----
  {
    id: "mono-en-woollen-looms",
    subset: "eval",
    type: "mono-fact",
    language: "en",
    pair: "en-en",
    question: "How many looms run in the weaving shed of the tweed mill?",
    docIds: ["en-caledonia-woollen"],
    expectedEvidence: [
      { docId: "en-caledonia-woollen", page: 3, section: "Facilities", quoteSnippet: "74 looms" },
    ],
  },
  {
    id: "mono-en-brewery-rebuild",
    subset: "eval",
    type: "mono-fact",
    language: "en",
    pair: "en-en",
    question: "How much did the 2011 brewhouse rebuild cost the brewery?",
    docIds: ["en-kearsley-brewery"],
    expectedEvidence: [
      { docId: "en-kearsley-brewery", page: 3, section: "Facilities", quoteSnippet: "2.3 million pounds" },
    ],
  },

  // ---- cross-lingual (en-es / en-de) ----
  {
    id: "x-en-es-solar-paneles",
    subset: "dev",
    type: "cross-fact",
    language: "en",
    pair: "en-es",
    question: "How many photovoltaic panels does the large inland solar plant operate?",
    docIds: ["es-tajo-central-solar"],
    expectedEvidence: [
      { docId: "es-tajo-central-solar", page: 3, section: "Instalaciones", quoteSnippet: "148.000 paneles" },
    ],
  },
  {
    id: "x-en-de-bergbau-tiefe",
    subset: "eval",
    type: "cross-fact",
    language: "en",
    pair: "en-de",
    question: "How deep does the show mine's gallery go?",
    docIds: ["de-odenwald-bergbau"],
    expectedEvidence: [
      { docId: "de-odenwald-bergbau", page: 3, section: "Anlagen", quoteSnippet: "180 Meter tief" },
    ],
  },
  {
    id: "x-en-de-weser-schleusen",
    subset: "dev",
    type: "cross-name",
    language: "en",
    pair: "en-de",
    question: "How many locks does the Schleusenverband Weser operate?",
    docIds: ["de-weser-schleusen"],
    expectedEvidence: [
      { docId: "de-weser-schleusen", page: 2, section: "Überblick", quoteSnippet: "sechs Schleusen" },
    ],
  },
  {
    id: "x-en-es-betizu-2016",
    subset: "dev",
    type: "cross-number",
    language: "en",
    pair: "en-es",
    question: "What did the mountain dairy complete in 2016?",
    docIds: ["es-betizu-queseria"],
    expectedEvidence: [
      { docId: "es-betizu-queseria", page: 3, section: "Instalaciones", quoteSnippet: "cava excavada en 2016" },
    ],
  },
  {
    id: "x-en-de-odenwald-1935",
    subset: "eval",
    type: "cross-number",
    language: "en",
    pair: "en-de",
    question: "Which structure at the mine dates from 1935?",
    docIds: ["de-odenwald-bergbau"],
    expectedEvidence: [
      { docId: "de-odenwald-bergbau", page: 3, section: "Anlagen", quoteSnippet: "Förderturm von 1935" },
    ],
  },
  {
    id: "x-en-es-tajo-robot",
    subset: "eval",
    type: "cross-distractor",
    language: "en",
    pair: "en-es",
    question: "Which robotic system keeps the panels of the large solar site clean?",
    docIds: ["es-tajo-central-solar"],
    expectedEvidence: [
      { docId: "es-tajo-central-solar", page: 3, section: "Instalaciones", quoteSnippet: "robots de limpieza" },
    ],
  },

  // ---- unanswerable (en, 2) ----
  {
    id: "ua-en-submarine",
    subset: "eval",
    type: "unanswerable",
    language: "en",
    pair: "none",
    question: "How deep can the research submarine dive?",
    docIds: [],
    expectedEvidence: [],
    probeTerm: "submarine",
  },
  {
    id: "ua-en-panda",
    subset: "eval",
    type: "unanswerable",
    language: "en",
    pair: "none",
    question: "When were the pandas introduced at the city zoo?",
    docIds: [],
    expectedEvidence: [],
    probeTerm: "pandas",
  },
];
