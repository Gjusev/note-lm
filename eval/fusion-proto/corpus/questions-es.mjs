/**
 * P3 questions — Spanish queries (eval/fusion-proto).
 * Merged into questions.json by generate-corpus.mjs. Fixed literals only.
 * Types: mono-fact (query lang == evidence lang), cross-fact (name-free,
 * no digits), cross-name (query carries the foreign org name — lexical
 * bridge), cross-number (query carries a digit token present in the
 * evidence), cross-distractor (name-free, query terms heavily present in
 * same-language distractor docs), unanswerable (probeTerm absent corpus-wide).
 */
export const ES_QUESTIONS = [
  // ---- monolingual controls (es-es) ----
  {
    id: "mono-es-faros-torre",
    subset: "dev",
    type: "mono-fact",
    language: "es",
    pair: "es-es",
    question: "¿Cuántos metros mide la torre del faro principal de la costa norte?",
    docIds: ["es-cantabrico-faros"],
    expectedEvidence: [
      { docId: "es-cantabrico-faros", page: 3, section: "Instalaciones", quoteSnippet: "62 metros de altura" },
    ],
  },
  {
    id: "mono-es-jarama-visitantes",
    subset: "eval",
    type: "mono-fact",
    language: "es",
    pair: "es-es",
    question: "¿Cuántos visitantes recibió el año pasado el tren histórico del valle?",
    docIds: ["es-jarama-ferrocarril"],
    expectedEvidence: [
      { docId: "es-jarama-ferrocarril", page: 4, section: "Cifras", quoteSnippet: "41.000 visitantes" },
    ],
  },
  {
    id: "mono-es-queseria-ovejas",
    subset: "eval",
    type: "mono-fact",
    language: "es",
    pair: "es-es",
    question: "¿Cuántas ovejas ordeña cada día la quesería artesanal?",
    docIds: ["es-betizu-queseria"],
    expectedEvidence: [
      { docId: "es-betizu-queseria", page: 2, section: "Resumen general", quoteSnippet: "320 ovejas" },
    ],
  },

  // ---- cross-lingual, name-free (es-de / es-en) ----
  {
    id: "x-es-de-schleusen-hub",
    subset: "dev",
    type: "cross-fact",
    language: "es",
    pair: "es-de",
    question: "¿Cuántos metros de desnivel salva la esclusa mayor del operador de vías de agua?",
    docIds: ["de-weser-schleusen"],
    expectedEvidence: [
      { docId: "de-weser-schleusen", page: 3, section: "Anlagen", quoteSnippet: "14 Meter Hub" },
    ],
  },
  {
    id: "x-es-en-quarry-toneladas",
    subset: "eval",
    type: "cross-fact",
    language: "es",
    pair: "es-en",
    question: "¿Cuántas toneladas de piedra extrae al año la gran cantera de caliza?",
    docIds: ["en-cotswold-quarry"],
    expectedEvidence: [
      { docId: "en-cotswold-quarry", page: 4, section: "Figures", quoteSnippet: "94,000 tonnes" },
    ],
  },
  {
    id: "x-es-de-odenwald-stollen",
    subset: "dev",
    type: "cross-distractor",
    language: "es",
    pair: "es-de",
    question: "¿A qué profundidad llega el túnel de la mina visitable?",
    docIds: ["de-odenwald-bergbau"],
    expectedEvidence: [
      { docId: "de-odenwald-bergbau", page: 3, section: "Anlagen", quoteSnippet: "4,8 Kilometer lang" },
    ],
  },
  {
    id: "x-es-de-porzellan-temperatura",
    subset: "eval",
    type: "cross-name",
    language: "es",
    pair: "es-de",
    question: "¿A qué temperatura cuece el horno la Porzellanmanufaktur Henneberg?",
    docIds: ["de-thueringen-porzellan"],
    expectedEvidence: [
      { docId: "de-thueringen-porzellan", page: 3, section: "Anlagen", quoteSnippet: "1.280 Grad" },
    ],
  },
  {
    id: "x-es-de-porzellan-2010",
    subset: "dev",
    type: "cross-number",
    language: "es",
    pair: "es-de",
    question: "¿Qué espacio abrió en 2010 la fábrica de porcelana?",
    docIds: ["de-thueringen-porzellan"],
    expectedEvidence: [
      { docId: "de-thueringen-porzellan", page: 3, section: "Anlagen", quoteSnippet: "2010 eröffnet" },
    ],
  },
  {
    id: "x-es-en-fal-buques",
    subset: "eval",
    type: "cross-name",
    language: "es",
    pair: "es-en",
    question: "¿Cuántos buques faro mantiene la Fal Lightvessel Trust?",
    docIds: ["en-fal-lightvessel"],
    expectedEvidence: [
      { docId: "en-fal-lightvessel", page: 2, section: "Overview", quoteSnippet: "three lightvessels" },
    ],
  },

  // ---- unanswerable (es, 2) ----
  {
    id: "ua-es-globo",
    subset: "dev",
    type: "unanswerable",
    language: "es",
    pair: "none",
    question: "¿Cuánto dura el paseo en globo sobre el valle?",
    docIds: [],
    expectedEvidence: [],
    probeTerm: "globo",
  },
  {
    id: "ua-es-futbol",
    subset: "eval",
    type: "unanswerable",
    language: "es",
    pair: "none",
    question: "¿Quién ganó la liga regional de fútbol?",
    docIds: [],
    expectedEvidence: [],
    probeTerm: "fútbol",
  },
];
