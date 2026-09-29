/**
 * English corpus documents (T3, eval/multilingual-proto).
 * All strings are fixed literals — the PDFs must stay byte-deterministic and
 * questions.json quote snippets must keep matching. One section = one page;
 * sections must stay short enough to fit a single A4 page (generator asserts).
 */
export const EN = [
  {
    id: "en-brightwater-marina", file: "en-brightwater-marina.pdf", language: "en",
    title: "Brightwater Marina Trust",
    subtitle: "Annual Report 2025",
    org: "Brightwater Marina Trust - Plymouth, United Kingdom",
    sections: [
      {
        title: "Overview", ps: [
          "The Brightwater Marina Trust has managed the harbour since 1987 and operates the marina as a self-funded public trust. It is the only trust-run marina on this stretch of the south-west coast.",
          "The trust manages 385 berths for vessels up to 22 metres and employs 26 staff across the harbour office, dockyard and pontoon crews. Winter lay-up ashore is supervised by the dockyard team.",
        ],
      },
      {
        title: "Facilities", ps: [
          "The fuel dock serves petrol and diesel between 07:00 and 19:00, and the 50-tonne travel hoist handles vessels up to 16 metres for scrubbing and survey work.",
          "Hard standing takes 130 boats over the winter, and the pump-out station installed in 2021 serves the north pontoon. The chandlery leases units to two local traders.",
        ],
        bullets: [
          "Travel hoist: 50 tonnes",
          "Winter hard standing: 130 boats",
          "Pump-out station: installed 2021",
        ],
      },
      {
        title: "Figures", ps: [
          "Revenue for 2025 was 2.9 million pounds, up six percent on the previous year, with berth occupancy at 87 percent across the season.",
          "The 2024 dredging campaign removed 11,200 cubic metres of silt from the fairway at a cost of 410,000 pounds, financed from the reserve fund.",
        ],
        bullets: [
          "Revenue 2025: 2.9 million pounds",
          "Dredging 2024: 11,200 cubic metres of silt",
          "Berth occupancy: 87 percent",
        ],
      },
      {
        title: "Plans", ps: [
          "A breakwater extension is planned for 2027 with a budget of 1.2 million pounds, following the wave study completed in autumn 2025.",
          "Shore power will be rolled out to 60 berths by 2028, starting with the visitor pontoons, funded jointly by the trust and a coastal community grant.",
        ],
      },
    ],
  },

  {
    id: "en-harrow-glassworks", file: "en-harrow-glassworks.pdf", language: "en",
    title: "Harrow Glassworks",
    subtitle: "Production and Trade Review",
    org: "Harrow Glassworks Ltd - Sheffield, United Kingdom",
    sections: [
      {
        title: "Overview", ps: [
          "Harrow Glassworks was founded in 1951 and runs two furnaces producing container glass for food and pharmaceutical packaging.",
          "The works employs 118 people across melting, forming, inspection and the depot. The visitor centre explains the tank furnace process to school parties.",
        ],
      },
      {
        title: "Facilities", ps: [
          "Furnace 2 was rebuilt in 2023 for 1.8 million pounds with oxy-fuel burners that cut gas consumption by 19 percent. The rebuild allowed a wider choice of amber and flint glass.",
          "The batch house mixes sand, soda ash and cullet and delivers 14,000 tonnes of container glass per year to the forming lines.",
        ],
        bullets: [
          "Furnace 2 rebuild: 1.8 million pounds",
          "Gas saving from oxy-fuel: 19 percent",
          "Output: 14,000 tonnes of container glass per year",
        ],
      },
      {
        title: "Figures", ps: [
          "Revenue for 2025 was 21.4 million pounds, and export sales to Ireland and the Netherlands accounted for 22 percent of turnover.",
          "Energy costs represented 28 percent of revenue, which is why the oxy-fuel rebuild and heat recovery on the lehr were prioritised.",
        ],
        bullets: [
          "Revenue 2025: 21.4 million pounds",
          "Export share: 22 percent",
          "Energy share of revenue: 28 percent",
        ],
      },
      {
        title: "Plans", ps: [
          "A pilot electric melting campaign runs in 2026 on furnace 1, testing electrode layout and batch foaming behaviour over six months.",
          "The works will recruit 15 trainee glassmakers with the regional college and extend the apprenticeship scheme to forming and annealing.",
        ],
      },
    ],
  },

  {
    id: "en-larkfield-seedbank", file: "en-larkfield-seedbank.pdf", language: "en",
    title: "Larkfield Seed Bank",
    subtitle: "Conservation and Collections Report",
    org: "Larkfield Seed Bank - Norfolk, United Kingdom",
    sections: [
      {
        title: "Overview", ps: [
          "The Larkfield Seed Bank was established in 1996 to conserve crop wild relatives and heritage varieties for plant breeding and restoration.",
          "The collection holds 41,300 accessions of vegetables, forage legumes and rare arable weeds, documented with collection-site coordinates.",
        ],
      },
      {
        title: "Facilities", ps: [
          "The main vault is held at -18 °C with dew point control, and a backup vault commissioned in 2019 mirrors the most threatened collections.",
          "Two dormancy laboratories run germination trials and moisture studies; the drying room operates at 15 percent relative humidity.",
        ],
        bullets: [
          "Main vault temperature: -18 °C",
          "Backup vault: commissioned 2019",
          "Drying room humidity: 15 percent RH",
        ],
      },
      {
        title: "Figures", ps: [
          "Germination testing follows an eight-year cycle per accession, and the 2025 retests showed an average germination rate of 94 percent across the collection.",
          "The annual budget of 740,000 pounds covers vault running costs, field multiplication and the volunteer collection programme.",
        ],
        bullets: [
          "Testing cycle: eight-year cycle",
          "Average germination 2025: 94 percent",
          "Annual budget: 740,000 pounds",
        ],
      },
      {
        title: "Plans", ps: [
          "By 2027 the bank will digitise 9,000 accession records, including hand-written collection sheets from the founding decade.",
          "A seed exchange with 12 partner institutes continues, prioritising landraces threatened in their regions of origin.",
        ],
      },
    ],
  },

  {
    id: "en-whitmore-printworks", file: "en-whitmore-printworks.pdf", language: "en",
    title: "Whitmore Printworks",
    subtitle: "Trade and Archive Report",
    org: "Whitmore Printworks - Bristol, United Kingdom",
    sections: [
      {
        title: "Overview", ps: [
          "Whitmore Printworks was founded in 1954 by Arthur Whitmore and remains family-owned, printing art books and maps for publishers and museums.",
          "The works employs 63 people across prepress, press hall and bindery. A small museum room keeps the founding hand press in working order.",
        ],
      },
      {
        title: "Facilities", ps: [
          "Four sheet-fed presses run two shifts; the largest press prints 12,000 sheets per hour on coated art paper with automatic register control.",
          "The bindery folds, sews and jackets in-house, and a dedicated map line applies fold-and-varnish lines for hiking and street maps.",
        ],
        bullets: [
          "Sheet-fed presses: four",
          "Largest press: 12,000 sheets per hour",
          "Bindery: folding, sewing, jackets",
        ],
      },
      {
        title: "Figures", ps: [
          "The works consumed 1,900 tonnes of paper in 2025, of which 41 percent was FSC-certified stock for trade editions.",
          "Revenue for 2025 was 8.7 million pounds, with reprints of museum catalogues the fastest-growing segment of the order book.",
        ],
        bullets: [
          "Paper 2025: 1,900 tonnes of paper",
          "FSC share: 41 percent",
          "Revenue 2025: 8.7 million pounds",
        ],
      },
      {
        title: "Plans", ps: [
          "A letterpress workshop will reprint museum posters from original wood type, with proofing sessions open to design schools.",
          "The archive of 70,000 ledger volumes is being catalogued for deposit with the county records office over three years.",
        ],
      },
    ],
  },
];
