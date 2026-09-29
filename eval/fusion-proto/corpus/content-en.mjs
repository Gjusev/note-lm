/**
 * English corpus documents (P3, eval/fusion-proto).
 * All strings are fixed literals — the PDFs must stay byte-deterministic and
 * questions.json quote snippets must keep matching. One section = one page;
 * sections must stay short enough to fit a single A4 page (generator asserts).
 */
export const EN = [
  {
    id: "en-caledonia-woollen", file: "en-caledonia-woollen.pdf", language: "en",
    title: "Caledonia Woollen Mills",
    subtitle: "Company Review 2025",
    org: "Caledonia Woollen Mills - Peebles, Scotland",
    sections: [
      {
        title: "Overview", ps: [
          "Caledonia Woollen Mills has woven tweed and blankets since 1889 and remains family-held through four generations.",
          "The mill employs 112 staff across weaving, finishing, warehousing and the shop on the riverside.",
        ],
      },
      {
        title: "Facilities", ps: [
          "The weaving shed runs 74 looms driven by the original line shafting, and the finishing house handles 96 tonnes of yarn a year.",
          "The dye kitchen works with natural lichens from the hills, and the 1906 engine room houses the restored water turbine.",
        ],
        bullets: [
          "Looms in the shed: 74",
          "Yarn finished per year: 96 tonnes",
          "Water turbine: installed 1906",
        ],
      },
      {
        title: "Figures", ps: [
          "Revenue for 2025 was 5.6 million pounds, with exports to Japan taking 21 percent of finished cloth.",
          "Energy costs fell 14 percent after heat recovery was fitted to the tumble dryers and the hot-water circuit.",
        ],
      },
      {
        title: "Plans", ps: [
          "A visitor centre opens in 2027, powered by 2,400 solar panels on the mill roofs and a small battery in the engine room.",
          "The apprentice scheme will take six trainees a year for weaving and finishing from the local college.",
        ],
      },
    ],
  },

  {
    id: "en-kearsley-brewery", file: "en-kearsley-brewery.pdf", language: "en",
    title: "Kearsley Brewery",
    subtitle: "Trade Report 2025",
    org: "Kearsley Brewery - Manchester, United Kingdom",
    sections: [
      {
        title: "Overview", ps: [
          "Kearsley Brewery was founded in 1876 and brews cask ale for 68 tied pubs across the northwest.",
          "The brewery employs 44 staff between the brewhouse, cellars, drays and the office by the canal basin.",
        ],
      },
      {
        title: "Facilities", ps: [
          "The brewhouse was rebuilt in 2011 for 2.3 million pounds and doubled the mash capacity of the old copper.",
          "The steam engine of 1898 still drives the hoist on heritage open days, and the cellar block holds twelve fermentation vessels.",
        ],
        bullets: [
          "Brewhouse rebuild 2011: 2.3 million pounds",
          "Steam engine: 1898, working order",
          "Fermentation vessels: twelve",
        ],
      },
      {
        title: "Figures", ps: [
          "Output for 2025 was 38,000 hectolitres of cask and bottled ale, a five percent rise on the previous year.",
          "Pub throughput grew in 51 of the 68 houses, and the dray fleet logged 96,000 delivery miles.",
        ],
      },
      {
        title: "Plans", ps: [
          "A canning line arrives in 2026 in the former stable block, adding canned versions of the two best-selling bitters.",
          "The brewery will relaunch the 1876 recipe series with heritage barley from a single farm contract.",
        ],
      },
    ],
  },

  {
    id: "en-cotswold-quarry", file: "en-cotswold-quarry.pdf", language: "en",
    title: "Windrush Stone Quarry",
    subtitle: "Site Report 2025",
    org: "Windrush Stone Quarry - Burford, United Kingdom",
    sections: [
      {
        title: "Overview", ps: [
          "Windrush Stone Quarry has been worked since 1804 and covers 22 hectares of oolitic limestone above the river valley.",
          "The site employs 31 people and supplies dimension stone to builders and conservation projects across three counties.",
        ],
      },
      {
        title: "Facilities", ps: [
          "Working proceeds in three benches, and the 2019 crusher handles 240 tonnes per hour on the upper level.",
          "The working floor now lies 18 metres deep, so dewatering pumps run through the night into the settlement lagoons.",
        ],
        bullets: [
          "Crusher capacity: 240 tonnes per hour",
          "Working floor: 18 metres deep",
          "Benches in operation: three",
        ],
      },
      {
        title: "Figures", ps: [
          "Extraction reached 94,000 tonnes in 2025, of which 11,000 tonnes went to conservation repairs on listed buildings.",
          "Restoration levies added 190,000 pounds to the year's accounts under the county minerals plan.",
        ],
      },
      {
        title: "Plans", ps: [
          "Restoration will flood the north void as a lake in 2031, with a public footpath along the western rim.",
          "A new saw shed with two diamond wire frames is planned for the lower bench in 2027.",
        ],
      },
    ],
  },

  {
    id: "en-fal-lightvessel", file: "en-fal-lightvessel.pdf", language: "en",
    title: "Fal Lightvessel Trust",
    subtitle: "Station Report 2025",
    org: "Fal Lightvessel Trust - Falmouth, United Kingdom",
    sections: [
      {
        title: "Overview", ps: [
          "The Fal Lightvessel Trust maintains three lightvessels on the southwest approaches, continuing a service begun in 1902.",
          "Crews rotate every 28 days by tender, and the shore office in Falmouth keeps the station logs and chart corrections.",
        ],
      },
      {
        title: "Facilities", ps: [
          "Each mast rises 15 metres above deck and the main light reaches 19 nautical miles in clear weather.",
          "The 2020 LED refit replaced the old optics on all three hulls, and the fog signal now runs on compressed air only.",
        ],
        bullets: [
          "Mast height: 15 metres",
          "Light range: 19 nautical miles",
          "LED refit: completed 2020",
        ],
      },
      {
        title: "Figures", ps: [
          "The 2020 LED refit cost 780,000 pounds across the fleet and cut power use by a third per vessel.",
          "Station running costs reached 1.4 million pounds in 2025, mostly crew wages and dry-dock inspections.",
        ],
      },
      {
        title: "Plans", ps: [
          "Hybrid power for the two outer vessels is scheduled for 2028, pairing diesel generators with battery banks.",
          "The trust will open the retired inner vessel as a static museum ship at the marina pontoon.",
        ],
      },
    ],
  },
];
