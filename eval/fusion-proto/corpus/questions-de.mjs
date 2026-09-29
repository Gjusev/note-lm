/**
 * P3 questions — German queries (eval/fusion-proto).
 * Merged into questions.json by generate-corpus.mjs. Fixed literals only.
 * See questions-es.mjs for the type definitions.
 */
export const DE_QUESTIONS = [
  // ---- monolingual controls (de-de) ----
  {
    id: "mono-de-schleusen-schiffe",
    subset: "dev",
    type: "mono-fact",
    language: "de",
    pair: "de-de",
    question: "Wie viele Schiffe haben die Schleusen im letzten Jahr passiert?",
    docIds: ["de-weser-schleusen"],
    expectedEvidence: [
      { docId: "de-weser-schleusen", page: 4, section: "Zahlen", quoteSnippet: "11.400 Schiffe" },
    ],
  },
  {
    id: "mono-de-porzellan-mitarbeiter",
    subset: "eval",
    type: "mono-fact",
    language: "de",
    pair: "de-de",
    question: "Wie viele Mitarbeiter beschäftigt die Porzellanmanufaktur heute?",
    docIds: ["de-thueringen-porzellan"],
    expectedEvidence: [
      { docId: "de-thueringen-porzellan", page: 2, section: "Überblick", quoteSnippet: "86 Mitarbeiter" },
    ],
  },
  {
    id: "mono-de-vogelwarte-arten",
    subset: "eval",
    type: "mono-fact",
    language: "de",
    pair: "de-de",
    question: "Wie viele Vogelarten hat die Station seit ihrer Gründung dokumentiert?",
    docIds: ["de-helgoland-vogelwarte"],
    expectedEvidence: [
      { docId: "de-helgoland-vogelwarte", page: 2, section: "Überblick", quoteSnippet: "340 Arten" },
    ],
  },

  // ---- cross-lingual (de-es / de-en) ----
  {
    id: "x-de-es-faros-alcance",
    subset: "eval",
    type: "cross-fact",
    language: "de",
    pair: "de-es",
    question: "Wie viele Seemeilen weit reicht das Licht der wichtigsten Leuchtfeuer?",
    docIds: ["es-cantabrico-faros"],
    expectedEvidence: [
      { docId: "es-cantabrico-faros", page: 3, section: "Instalaciones", quoteSnippet: "24 millas" },
    ],
  },
  {
    id: "x-de-es-jarama-kilometros",
    subset: "dev",
    type: "cross-name",
    language: "de",
    pair: "de-es",
    question: "Wie viele Kilometer Strecke betreibt die Fundación Ferrocarril del Jarama?",
    docIds: ["es-jarama-ferrocarril"],
    expectedEvidence: [
      { docId: "es-jarama-ferrocarril", page: 2, section: "Resumen general", quoteSnippet: "22 kilómetros" },
    ],
  },
  {
    id: "x-de-en-kearsley-dampfmaschine",
    subset: "eval",
    type: "cross-number",
    language: "de",
    pair: "de-en",
    question: "Wo kann die Dampfmaschine von 1898 besichtigt werden?",
    docIds: ["en-kearsley-brewery"],
    expectedEvidence: [
      { docId: "en-kearsley-brewery", page: 3, section: "Facilities", quoteSnippet: "steam engine of 1898" },
    ],
  },
  {
    id: "x-de-es-faros-turm",
    subset: "dev",
    type: "cross-distractor",
    language: "de",
    pair: "de-es",
    question: "Wie hoch ist der Turm des wichtigsten Leuchtturms?",
    docIds: ["es-cantabrico-faros"],
    expectedEvidence: [
      { docId: "es-cantabrico-faros", page: 3, section: "Instalaciones", quoteSnippet: "62 metros de altura" },
    ],
  },

  // ---- unanswerable (de, 2) ----
  {
    id: "ua-de-orchester",
    subset: "dev",
    type: "unanswerable",
    language: "de",
    pair: "none",
    question: "Wie viele Musiker zählt das Kammerorchester der Stadt?",
    docIds: [],
    expectedEvidence: [],
    probeTerm: "Kammerorchester",
  },
  {
    id: "ua-de-gletscher",
    subset: "eval",
    type: "unanswerable",
    language: "de",
    pair: "none",
    question: "Wie schnell bewegt sich der Gletscher jedes Jahr?",
    docIds: [],
    expectedEvidence: [],
    probeTerm: "Gletscher",
  },
];
