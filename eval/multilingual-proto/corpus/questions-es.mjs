/**
 * T3 questions — Spanish queries (eval/multilingual-proto).
 * Merged into questions.json by generate-corpus.mjs. Fixed literals only.
 * mono = query language == evidence language; x- = cross-lingual pair
 * (query language != evidence language); ua = unanswerable (probeTerm absent
 * from the whole corpus).
 */
export const ES_QUESTIONS = [
  // ---- monolingual controls (es-es) ----
  {
    id: "mono-es-azud-desde",
    subset: "dev",
    type: "exact-fact",
    language: "es",
    pair: "es-es",
    question: "¿Desde qué año opera la Confederación el azud de Villanueva?",
    docIds: ["es-guadalquivir-azud"],
    expectedEvidence: [
      { docId: "es-guadalquivir-azud", page: 2, section: "Resumen general", quoteSnippet: "desde 1972" },
    ],
  },
  {
    id: "mono-es-azud-caudal",
    subset: "eval",
    type: "exact-fact",
    language: "es",
    pair: "es-es",
    question: "¿Cuál fue el caudal medio durante la campaña de aforos de 2024?",
    docIds: ["es-guadalquivir-azud"],
    expectedEvidence: [
      { docId: "es-guadalquivir-azud", page: 4, section: "Cifras de la campaña", quoteSnippet: "82 m³/s" },
    ],
  },
  {
    id: "mono-es-valdepeluca-barricas",
    subset: "dev",
    type: "exact-fact",
    language: "es",
    pair: "es-es",
    question: "¿Cuántas barricas de roble alberga la sala de barricas de Valdepeluca?",
    docIds: ["es-valdepeluca-cavas"],
    expectedEvidence: [
      { docId: "es-valdepeluca-cavas", page: 3, section: "Sala de barricas", quoteSnippet: "4.200 barricas" },
    ],
  },
  {
    id: "mono-es-almeria-cinta",
    subset: "eval",
    type: "exact-fact",
    language: "es",
    pair: "es-es",
    question: "¿Cuál es la capacidad de la cinta transportadora principal de la terminal de granos de Almería?",
    docIds: ["es-almeria-granos"],
    expectedEvidence: [
      { docId: "es-almeria-granos", page: 3, section: "Instalaciones", quoteSnippet: "850 toneladas por hora" },
    ],
  },

  // ---- cross-lingual: ES query -> DE evidence (es-de, 4) ----
  {
    id: "x-es-de-alpenstern-altitude",
    subset: "dev",
    type: "cross-lingual-fact",
    language: "es",
    pair: "es-de",
    question: "¿A qué altitud sobre el nivel del mar está situado el observatorio astronómico alpino?",
    docIds: ["de-alpenstern-warte"],
    expectedEvidence: [
      { docId: "de-alpenstern-warte", page: 2, section: "Überblick", quoteSnippet: "2.120 Metern Seehöhe" },
    ],
  },
  {
    id: "x-es-de-erzgebirge-fundacion",
    subset: "dev",
    type: "cross-lingual-fact",
    language: "es",
    pair: "es-de",
    question: "¿En qué año se fundó el aserradero histórico de las montañas?",
    docIds: ["de-erzgebirge-holzmanufaktur"],
    expectedEvidence: [
      { docId: "de-erzgebirge-holzmanufaktur", page: 2, section: "Überblick", quoteSnippet: "1908 als Sägemühle gegründet" },
    ],
  },
  {
    id: "x-es-de-ruhr-poros",
    subset: "eval",
    type: "cross-lingual-fact",
    language: "es",
    pair: "es-de",
    question: "¿De qué tamaño son los poros de los filtros de la planta de agua potable?",
    docIds: ["de-ruhr-filterwerk"],
    expectedEvidence: [
      { docId: "de-ruhr-filterwerk", page: 3, section: "Anlagen", quoteSnippet: "0,02 Mikrometer" },
    ],
  },
  {
    id: "x-es-de-havel-barcos",
    subset: "eval",
    type: "cross-lingual-fact",
    language: "es",
    pair: "es-de",
    question: "¿Cuántos buques recibe al año el dique seco de la zona Este?",
    docIds: ["de-havel-trockendock"],
    expectedEvidence: [
      { docId: "de-havel-trockendock", page: 4, section: "Zahlen und Kennzahlen", quoteSnippet: "90 Schiffe pro Jahr" },
    ],
  },

  // ---- cross-lingual: ES query -> EN evidence (es-en, 3) ----
  {
    id: "x-es-en-brightwater-atraques",
    subset: "dev",
    type: "cross-lingual-fact",
    language: "es",
    pair: "es-en",
    question: "¿Cuántos atraques tiene el puerto deportivo del suroeste?",
    docIds: ["en-brightwater-marina"],
    expectedEvidence: [
      { docId: "en-brightwater-marina", page: 2, section: "Overview", quoteSnippet: "385 berths" },
    ],
  },
  {
    id: "x-es-en-harrow-horno",
    subset: "eval",
    type: "cross-lingual-fact",
    language: "es",
    pair: "es-en",
    question: "¿Cuánto costó la reconstrucción del segundo horno de la fábrica de vidrio?",
    docIds: ["en-harrow-glassworks"],
    expectedEvidence: [
      { docId: "en-harrow-glassworks", page: 3, section: "Facilities", quoteSnippet: "1.8 million pounds" },
    ],
  },
  {
    id: "x-es-en-whitmore-empleados",
    subset: "eval",
    type: "cross-lingual-fact",
    language: "es",
    pair: "es-en",
    question: "¿Cuántas personas trabajan en la imprenta familiar?",
    docIds: ["en-whitmore-printworks"],
    expectedEvidence: [
      { docId: "en-whitmore-printworks", page: 2, section: "Overview", quoteSnippet: "63 people" },
    ],
  },

  // ---- unanswerable (es, 3) ----
  {
    id: "ua-es-acuario",
    subset: "dev",
    type: "unanswerable",
    language: "es",
    pair: "none",
    question: "¿Cuánto cuesta la entrada al acuario de Sevilla?",
    docIds: [],
    expectedEvidence: [],
    probeTerm: "acuario de Sevilla",
  },
  {
    id: "ua-es-zarza",
    subset: "eval",
    type: "unanswerable",
    language: "es",
    pair: "none",
    question: "¿Qué coche eléctrico presenta la marca Zarza en 2027?",
    docIds: [],
    expectedEvidence: [],
    probeTerm: "Zarza",
  },
  {
    id: "ua-es-apnea",
    subset: "eval",
    type: "unanswerable",
    language: "es",
    pair: "none",
    question: "¿Cuál es el récord mundial de apnea estática en piscina?",
    docIds: [],
    expectedEvidence: [],
    probeTerm: "apnea estática",
  },
];
