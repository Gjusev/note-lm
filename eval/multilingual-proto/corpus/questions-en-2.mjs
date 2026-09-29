/**
 * T3 questions — English queries, part 2 (eval/multilingual-proto).
 * en->de cross-lingual + unanswerable in English. Merged into questions.json
 * by generate-corpus.mjs. Fixed literals only.
 */
export const EN_QUESTIONS_2 = [
  // ---- cross-lingual: EN query -> DE evidence (en-de, 3) ----
  {
    id: "x-en-de-havel-hebekraft",
    subset: "dev",
    type: "cross-lingual-fact",
    language: "en",
    pair: "en-de",
    question: "What is the lifting capacity of the dry dock?",
    docIds: ["de-havel-trockendock"],
    expectedEvidence: [
      { docId: "de-havel-trockendock", page: 3, section: "Anlagen", quoteSnippet: "3.800 Tonnen" },
    ],
  },
  {
    id: "x-en-de-ruhr-rueckgewinnung",
    subset: "eval",
    type: "cross-lingual-fact",
    language: "en",
    pair: "en-de",
    question: "What is the water recovery rate at the drinking water plant?",
    docIds: ["de-ruhr-filterwerk"],
    expectedEvidence: [
      { docId: "de-ruhr-filterwerk", page: 4, section: "Zahlen und Kennzahlen", quoteSnippet: "96 Prozent" },
    ],
  },
  {
    id: "x-en-de-alpenstern-naechte",
    subset: "eval",
    type: "cross-lingual-fact",
    language: "en",
    pair: "en-de",
    question: "How many clear nights per year does the alpine observatory record?",
    docIds: ["de-alpenstern-warte"],
    expectedEvidence: [
      { docId: "de-alpenstern-warte", page: 4, section: "Zahlen und Kennzahlen", quoteSnippet: "210 klare Nächte" },
    ],
  },
  // ---- unanswerable (en, 2) ----
  {
    id: "ua-en-jorvik",
    subset: "eval",
    type: "unanswerable",
    language: "en",
    pair: "none",
    question: "What is the ticket price for the Jorvik Viking festival?",
    docIds: [],
    expectedEvidence: [],
    probeTerm: "Jorvik",
  },
  {
    id: "ua-en-reykjavik",
    subset: "eval",
    type: "unanswerable",
    language: "en",
    pair: "none",
    question: "Which airline flies direct from Leeds to Reykjavik?",
    docIds: [],
    expectedEvidence: [],
    probeTerm: "Reykjavik",
  },
];
