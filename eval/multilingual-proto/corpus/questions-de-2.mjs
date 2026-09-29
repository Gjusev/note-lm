/**
 * T3 questions — German queries, part 2 (eval/multilingual-proto).
 * de->en cross-lingual + unanswerable in German. Merged into questions.json
 * by generate-corpus.mjs. Fixed literals only.
 */
export const DE_QUESTIONS_2 = [
  // ---- cross-lingual: DE query -> EN evidence (de-en, 3) ----
  {
    id: "x-de-en-brightwater-baggerung",
    subset: "dev",
    type: "cross-lingual-fact",
    language: "de",
    pair: "de-en",
    question: "Wie viel Schlamm hat die Baggerkampagne im Sportboothafen 2024 entfernt?",
    docIds: ["en-brightwater-marina"],
    expectedEvidence: [
      { docId: "en-brightwater-marina", page: 4, section: "Figures", quoteSnippet: "11,200 cubic metres of silt" },
    ],
  },
  {
    id: "x-de-en-larkfield-akzessionen",
    subset: "eval",
    type: "cross-lingual-fact",
    language: "de",
    pair: "de-en",
    question: "Wie viele Akzessionen umfasst die Sammlung der Saatgutbank?",
    docIds: ["en-larkfield-seedbank"],
    expectedEvidence: [
      { docId: "en-larkfield-seedbank", page: 2, section: "Overview", quoteSnippet: "41,300 accessions" },
    ],
  },
  {
    id: "x-de-en-whitmore-bogen",
    language: "de",
    pair: "de-en",
    subset: "eval",
    type: "cross-lingual-fact",
    question: "Wie viele Bogen pro Stunde schafft die größte Druckmaschine der Buchdruckerei?",
    docIds: ["en-whitmore-printworks"],
    expectedEvidence: [
      { docId: "en-whitmore-printworks", page: 3, section: "Facilities", quoteSnippet: "12,000 sheets per hour" },
    ],
  },

  // ---- unanswerable (de, 3) ----
  {
    id: "ua-de-erfurt",
    subset: "dev",
    type: "unanswerable",
    language: "de",
    pair: "none",
    question: "Wie hoch fällt die Tariferhöhung der Straßenbahn in Erfurt 2027 aus?",
    docIds: [],
    expectedEvidence: [],
    probeTerm: "Erfurt",
  },
  {
    id: "ua-de-schwarm",
    subset: "eval",
    type: "unanswerable",
    language: "de",
    pair: "none",
    question: "Welches Startup baut Schwarmdrohnen in Rostock?",
    docIds: [],
    expectedEvidence: [],
    probeTerm: "Schwarmdrohnen",
  },
  {
    id: "ua-de-bitcoin",
    subset: "eval",
    type: "unanswerable",
    language: "de",
    pair: "none",
    question: "Wie viele Bitcoin-Miner stehen im Harz?",
    docIds: [],
    expectedEvidence: [],
    probeTerm: "Bitcoin",
  },
];
