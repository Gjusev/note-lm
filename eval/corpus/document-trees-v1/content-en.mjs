/**
 * English corpus documents (PI-0, document-trees-v1).
 * All strings are fixed literals — edit only with care, the PDFs must stay
 * byte-deterministic and questions.json quotes must keep matching.
 */
export const EN = [
  {
    id: "en-atlas-bicycles", file: "en-atlas-bicycles.pdf", language: "en",
    title: "Riverdale Bicycle Works",
    subtitle: "Annual Technical Review 2025",
    org: "Riverdale Bicycle Works - Leeds, United Kingdom",
    toc: true, notes: [],
    sections: [
      {
        title: "Company Overview", ps: [
          "Riverdale Bicycle Works was founded in 1998 by Elena Marsh in a former textile mill in Leeds. The company designs and assembles bicycle frames in aluminium and carbon fibre and sells through 240 independent dealers in the United Kingdom and Ireland.",
          "At the end of 2025 the company employed 214 people, of whom 68 worked in production, 41 in assembly and finishing, and the remainder in administration, quality control and sales. A second production site in Porto, Portugal, was acquired in 2019 to serve continental customers.",
        ],
      },
      {
        title: "Manufacturing Sites", ps: [
          "The Leeds plant operates two welding lines, line A for aluminium city frames and line B for gravel and touring frames. Planned capacity is 38,000 frames per year, and 2025 output reached 35,900 frames.",
          "The Porto plant, bought in 2019, specialises in carbon lay-up and paint. Its planned capacity is 26,000 frames per year with a current utilisation of 71 percent. Both sites share a single quality laboratory established in 2022 that performs fatigue tests on 40 samples per month.",
        ],
      },
      {
        title: "Model Lineup 2025", ps: [
          "Five models were offered in the 2025 season. The road model Kestrel 700 weighs 8.2 kg in size 54 and is priced at 2,499 EUR. The gravel model Harrier ST weighs 9.6 kg and costs 1,899 EUR.",
          "The children model Owl 26 ships in one colour scheme and costs 449 EUR. The electric model Peregrine E carries a 540 Wh battery, reaches 25 km/h under motor assistance and costs 3,299 EUR. The city model Swift 3 completes the range at 799 EUR.",
        ], bullets: [
          "Kestrel 700: road, 8.2 kg, 2,499 EUR",
          "Harrier ST: gravel, 9.6 kg, 1,899 EUR",
          "Owl 26: children, one colour, 449 EUR",
          "Peregrine E: electric, 540 Wh battery, 3,299 EUR",
          "Swift 3: city, 799 EUR",
        ],
      },
      {
        title: "Quality and Recalls", ps: [
          "One product recall was issued in 2025. On 11 March 2025 the company announced a recall of 4,200 Harrier ST front forks from batch H-2417, after a weld seam defect was found in three customer complaints. No injuries were reported.",
          "Dealers replaced the affected forks free of charge within six weeks. The supplier of the forged fork crowns was changed in May 2025, and incoming inspection now includes X-ray testing of every fork crown batch.",
        ],
      },
      {
        title: "Financial Summary", ps: [
          "Revenue for 2025 was 12.4 million EUR, an increase of 9 percent over 2024. Export sales accounted for 31 percent of revenue, with Germany, the Netherlands and Ireland as the largest export markets.",
          "The gross margin reached 27 percent, one point higher than the previous year, mainly due to the lower aluminium spot price. Operating expenses rose by 4 percent, and the company closed the year with a small operating profit of 0.4 million EUR.",
        ],
      },
      {
        title: "Research and Outlook", ps: [
          "The carbon laboratory started a cooperation with Trent University on flax fibre composites in February 2025. Three test frames were built and are being ridden by employees on a daily commute programme.",
          "For 2026 the company plans a prototype electric cargo bike under the working name Mule 1, with a target payload of 180 kg. Series production is not planned before 2027.",
        ],
      },
    ],
  },

  {
    id: "en-orion-observatory", file: "en-orion-observatory.pdf", language: "en",
    title: "Orion Hills Observatory",
    subtitle: "Research Report 2025",
    org: "Orion Hills Observatory - Eastern Oregon, United States",
    toc: true, notes: [],
    sections: [
      {
        title: "Institution Overview", ps: [
          "Orion Hills Observatory was founded in 1963 on a ridge in eastern Oregon at an altitude of 2,140 metres. The site was selected for its number of clear nights, which averaged 212 per year during the last decade.",
          "The main instrument is the Pioneer telescope, a 1.8 metre Cassegrain reflector commissioned in 1979 and modernised in 2014. The observatory is operated by a nonprofit research consortium together with two state universities.",
        ],
      },
      {
        title: "Instrumentation", ps: [
          "Besides the Pioneer telescope, the observatory operates the Vesper echelle spectrograph with a resolving power of R = 42,000, fed by an optical fibre from the Cassegrain focus.",
          "The wide-field camera Lattice uses a mosaic of twelve CCD chips and covers a field of 1.7 square degrees. A robotic 0.4 metre patrol telescope installed in 2021 screens nearby star fields for transient events every clear night.",
        ],
      },
      {
        title: "Survey Programs", ps: [
          "The asteroid survey discovered 1,342 new minor planets in 2025, of which 87 received permanent numbers during the year. Follow-up astrometry is shared with four amateur stations.",
          "The exoplanet transit program observed 3,100 target stars and registered 17 transit candidates. Four candidates were confirmed as planets by radial velocity measurements with the Vesper spectrograph.",
        ],
      },
      {
        title: "Variable Star Monitoring", ps: [
          "A long term monitoring catalogue covers 386 RR Lyrae stars in the northern sky. Observations are taken with the Lattice camera in two filters, and light curves reach a period precision of 0.4 percent.",
          "In 2025 the program added 44 newly discovered eclipsing binaries with periods between 0.9 and 42 days. All light curves are published within one year of observation.",
        ],
      },
      {
        title: "Publications and Funding", ps: [
          "Staff and visiting astronomers published 21 peer reviewed papers in 2025, twelve of them in journals of the American Astronomical Society family.",
          "The annual budget was 3.8 million USD. The largest single item is a federal grant of 1.2 million USD for the survey programs, followed by university contributions of 1.5 million USD and private donations of 1.1 million USD.",
        ],
      },
      {
        title: "Education and Outreach", ps: [
          "The visitor programme counted 9,400 guests in 2025. Sixty-two school classes took part in guided daytime visits, and monthly public star parties were held from April to October.",
          "A summer academy for 30 undergraduate students ran for eight weeks in July and August. Participants reduced real survey data and contributed 14 asteroids measurements to the minor planet center pipeline.",
        ],
      },
    ],
  },

  {
    id: "en-bluefin-fisheries", file: "en-bluefin-fisheries.pdf", language: "en",
    title: "Bluefin Sound Fisheries Cooperative",
    subtitle: "Quota and Harvest Report 2025",
    org: "Bluefin Sound Fisheries Cooperative - Nova Scotia, Canada",
    toc: true, notes: ["table"],
    sections: [
      {
        title: "Cooperative Overview", ps: [
          "The cooperative was founded in 1957 by 22 fishing families and is headquartered in the port of Bluefin Sound, Nova Scotia. Membership grew to 118 member vessels by the end of 2025.",
          "The cooperative manages quotas, operates the fuel dock and runs the processing plant on the east quay. A board of seven elected skippers meets every second Thursday.",
        ],
      },
      {
        title: "Fleet Composition", ps: [
          "The member fleet consists of 41 longliners, 33 trawlers, 28 gillnetters and 16 coastal handliners. The average vessel age is 19 years.",
          "Nine vessels were replaced in 2025 under the fleet renewal agreement signed in 2023. All new vessels are equipped with electronic logbooks and net sensors.",
        ],
      },
      {
        title: "Catch Quotas 2025", ps: [
          "The table below compares the allocated quotas with the actual landings of the 2025 season. Quotas are set annually by the regional fisheries authority in consultation with the cooperative.",
          "Herring was fully utilised, while pollock remained below quota because the fleet shifted effort to haddock in the second half of the year. No quota was exceeded.",
        ], table: {
          caption: "Table 1: 2025 quotas and landings by species",
          columns: ["Species", "Quota (t)", "Landed (t)", "Utilisation"],
          widths: [0.34, 0.22, 0.22, 0.22],
          rows: [
            ["Atlantic cod", "3,600", "3,412", "95%"],
            ["Haddock", "2,100", "2,088", "99%"],
            ["Pollock", "1,750", "1,301", "74%"],
            ["Herring", "5,200", "5,200", "100%"],
            ["Halibut", "640", "612", "96%"],
          ],
        },
      },
      {
        title: "Sustainability Measures", ps: [
          "Since 2021 two areas of 40 and 55 square nautical miles are closed to bottom trawling to protect juvenile cod. Mesh size in the trawl fishery was raised to 120 millimetres in 2024.",
          "Independent observers covered 18 percent of all fishing trips in 2025. The cooperative runs a discard monitoring programme in which skippers photograph every haul with a deck camera.",
        ],
      },
      {
        title: "Processing and Markets", ps: [
          "The processing plant on the east quay handles up to 90 tonnes per day. In 2025 the plant processed 11,900 tonnes of fish, of which 62 percent was exported to the United States.",
          "The average ex-vessel price for cod was 4.30 USD per kilogram, 6 percent above 2024. Herring is mostly sold to roe processors in Asia under a fixed annual contract.",
        ],
      },
      {
        title: "Outlook 2026", ps: [
          "For the 2026 season the authority has proposed a 3 percent reduction of the cod quota and an unchanged herring quota. The cooperative has asked for a review of the pollock assessment.",
          "The fleet renewal programme continues with nine further vessels ordered for delivery in 2026 and 2027. Heat recovery from the plant refrigeration system will be connected to the fuel dock building in spring 2026.",
        ],
      },
    ],
  },

  {
    id: "en-harbor-registry", file: "en-harbor-registry.pdf", language: "en",
    title: "Port of Grey Harbor",
    subtitle: "Vessel Registry Digest 2025",
    org: "Port of Grey Harbor Authority - Grey Harbor, Oregon",
    toc: false, notes: ["no-toc"],
    sections: [
      {
        title: "Registry Overview", ps: [
          "The vessel registry of the Port of Grey Harbor was opened in 1904 and lists 3,812 registered vessels at the end of 2025. Registration is renewed annually for a flat fee of 240 USD.",
          "The registry covers commercial vessels, fishing vessels and pleasure craft above 12 metres hull length. Smaller pleasure craft are registered by the county instead.",
        ],
      },
      {
        title: "Commercial Fleet Register", ps: [
          "The ten largest commercial vessels registered in 2025 are listed in the table below. Deadweight tonnage is the registered carrying capacity of each ship.",
          "Three of the largest vessels are bulk carriers serving the grain terminal, two are product tankers calling at the fuel berth, and the remainder are container feeders and general cargo ships.",
        ], table: {
          caption: "Table 1: Largest registered commercial vessels, 2025",
          columns: ["Vessel", "Flag", "DWT (t)", "Built"],
          widths: [0.37, 0.21, 0.21, 0.21],
          rows: [
            ["Meridian Star", "Panama", "52,000", "2011"],
            ["Corva Breeze", "Liberia", "38,400", "2016"],
            ["Northern Gannet", "Canada", "12,750", "2008"],
            ["Silver Fir", "Marshall Is.", "11,900", "2014"],
            ["Cape Duchess", "Panama", "10,300", "2019"],
            ["Aster Bay", "Liberia", "9,850", "2021"],
            ["Dunlin Trader", "Canada", "8,120", "2010"],
            ["Fjord Rose", "Norway", "7,640", "2018"],
            ["Kestrel Arrow", "Singapore", "7,010", "2022"],
            ["Heron Point", "Panama", "6,480", "2013"],
          ],
        },
      },
      {
        title: "Berth Allocation", ps: [
          "The port offers 14 berths along two piers. The deepest berth accommodates vessels with 16.5 metres draught, and two mobile harbour cranes lift up to 100 tonnes each.",
          "Berth occupancy averaged 74 percent in 2025. Grain exports occupy berth 3 to 5 during the October to January season, and the fuel berth is reserved for tankers every Tuesday and Friday.",
        ],
      },
      {
        title: "Pilotage and Towage", ps: [
          "Seven licensed pilots handled 2,214 pilotage movements in 2025. Pilotage is compulsory for vessels above 90 metres length or 6,000 gross tonnage.",
          "Three tugs are stationed at the harbour mouth, of which two are tractor tugs with 55 tonnes bollard pull. Tug assistance was used on 611 movements during the year.",
        ],
      },
      {
        title: "Environmental Program", ps: [
          "Since 2023 five berths provide shore power for container feeders and tugs. Total port emissions fell by 11 percent compared with the 2019 baseline year.",
          "A barge collects oily water and garbage from calling vessels free of charge. The authority plants one native tree for every 1,000 tonnes of cargo handled, adding 8,400 trees in 2025.",
        ],
      },
      {
        title: "Incidents and Safety", ps: [
          "Three reportable incidents occurred in 2025: a mooring line failure in March, a minor contact between a feeder and a fender in August, and a crane cable fault in November. Nobody was injured and no spill exceeded one tonne.",
          "The safety office completed 46 lockout-tagout audits and 12 emergency drills. Average response time of the harbour fire unit was 7 minutes.",
        ],
      },
      {
        title: "Future Projects", ps: [
          "The authority plans to extend the breakwater by 240 metres to reduce swell at berths 12 to 14. Planning approval is expected in 2026 and construction would start in 2027.",
          "A second shore power substation is designed and will double shore power capacity from five to nine berths. The investment volume of both projects is estimated at 61 million USD.",
        ],
      },
    ],
  },

  {
    id: "en-quarry-heritage", file: "en-quarry-heritage.pdf", language: "en",
    title: "Caldstone Quarry Heritage Trust",
    subtitle: "Annual Review 2025",
    org: "Caldstone Quarry Heritage Trust - Caldstone, England",
    toc: true, notes: ["misleading-headings"],
    sections: [
      {
        title: "Trust and Mission", ps: [
          "The trust was founded in 1987 to preserve the Caldstone limestone quarry and its industrial heritage. The site closed as a working quarry in 1962 and has been open to visitors since 1991.",
          "At the end of 2025 the trust had 2,300 members. Its mission combines conservation of the quarry landscape, the kiln complex and the archive of the former quarry company.",
        ],
      },
      {
        title: "Financial Outlook", ps: [
          "Under this heading the trust reports on its volunteer training programme, which in 2025 was funded from the designated training reserve rather than the general budget.",
          "In 2025, 84 volunteers completed the accredited course in archive handling and guided tour practice. The course ran over nine weekends, and 61 volunteers qualified as site guides for the 2026 season.",
        ],
      },
      {
        title: "Archive and Collections", ps: [
          "The archive holds 12,400 photographic negatives of quarry operations between 1904 and 1961 and 480 oral history recordings of former quarry workers and their families.",
          "In 2025 the digitisation team scanned 2,150 negatives and transcribed 66 oral histories. A reading room with twelve seats opened in the old weighbridge office.",
        ],
      },
      {
        title: "Membership Benefits", ps: [
          "This section describes the restoration of the kiln complex, which was financed largely by membership funds and external grants rather than by membership fees alone.",
          "Restoration of the three draw kilns was completed in June 2025 at a cost of 214,000 GBP, of which 130,000 GBP came from an industrial heritage grant. Scaffolding protected the original brick linings during the works.",
        ],
      },
      {
        title: "Site Interpretation", ps: [
          "The visitor trail around the quarry floor and kiln bank is 2.6 kilometres long and marked with 18 interpretation panels describing the stone extraction process.",
          "A new audio guide in three languages was launched in May 2025. Average visitor dwell time rose from 48 to 71 minutes after the trail was extended to the upper bench.",
        ],
      },
      {
        title: "Governance", ps: [
          "The trust is governed by a board of nine trustees who meet quarterly. The audited accounts for the year ending 31 March 2025 were filed on 30 April 2025.",
          "A members assembly takes place each October. In 2025 the assembly approved a change of the trust objects to include the adjacent lime woodland, and elected two new trustees.",
        ],
      },
    ],
  },

  {
    id: "en-maple-transit", file: "en-maple-transit.pdf", language: "en",
    title: "Maple Ridge Transit Authority",
    subtitle: "Service Report 2025",
    org: "Maple Ridge Transit Authority - Maple Ridge, Canada",
    toc: true, notes: ["table"],
    sections: [
      {
        title: "Authority Overview", ps: [
          "The transit authority operates the local bus network of the city of Maple Ridge with 210 buses on 34 routes. It was established in 1994 as a joint body of the city and two neighbouring municipalities.",
          "The main depot and control centre are located at Ironworks Yard. A second, smaller depot for 60 vehicles opened at Eastgate in 2022.",
        ],
      },
      {
        title: "Route Network", ps: [
          "The core network consists of twelve high frequency routes and 22 local routes. The table shows the busiest routes in 2025 with their average weekday ridership and scheduled headway at midday.",
          "Route 3 crosses the river and connects the university campus with the central station. Its bridge span limits vehicle length to 12 metres, which caps its capacity despite high demand.",
        ], table: {
          caption: "Table 1: Busiest routes 2025",
          columns: ["Route", "Terminus", "Riders/day", "Headway"],
          widths: [0.18, 0.42, 0.22, 0.18],
          rows: [
            ["3", "University - Central Station", "9,100", "6 min"],
            ["7", "Harbour - Eastgate", "7,400", "8 min"],
            ["11", "North Market - Central Station", "6,850", "8 min"],
            ["14", "Riverdale Loop", "5,200", "10 min"],
            ["19", "Ironworks - South Ridge", "4,980", "10 min"],
            ["22", "Hospital - Central Station", "4,310", "12 min"],
            ["27", "Airport Road - Harbour", "3,660", "15 min"],
            ["34", "Westfield Express", "3,050", "20 min"],
          ],
        },
      },
      {
        title: "Ridership and Fares", ps: [
          "Total ridership in 2025 was 41.2 million rides, an increase of 4 percent over 2024. Weekday boardings peaked between 7:30 and 8:30 in the morning.",
          "The single fare is 2.75 CAD and the monthly pass costs 96 CAD. Children under 12 travel free, and the employer partnership programme covers 34,000 pass holders.",
        ],
      },
      {
        title: "Fleet Electrification", ps: [
          "By December 2025 the fleet included 48 battery electric buses. The Ironworks Yard depot operates 26 fast chargers, and Eastgate has six.",
          "The authority targets a fully zero emission fleet by 2035. Winter range loss reduced the effective duty of electric buses on route 34, so the express route keeps diesel buses as reserve.",
        ],
      },
      {
        title: "Accessibility", ps: [
          "92 percent of all stops are wheelchair accessible with level boarding or a raised pad. All buses in the fleet have ramps or kneeling suspension.",
          "The ramp failure rate in daily service was 0.7 percent in 2025. Audio-visual next stop announcements are installed in 84 percent of the fleet and are mandatory for all new vehicles.",
        ],
      },
      {
        title: "On-Time Performance", ps: [
          "System wide on-time performance reached 87.3 percent in 2025, measured as departure within one minute of schedule at time points.",
          "Congestion caused 54 percent of delays and traffic incidents 21 percent. The worst corridor is the bridge approach of route 3, where OTP dropped to 71 percent during the afternoon peak.",
        ],
      },
    ],
  },

  {
    id: "en-meridian-clinic", file: "en-meridian-clinic.pdf", language: "en",
    title: "Meridian Community Clinic",
    subtitle: "Quality and Activity Report 2025",
    org: "Meridian Community Clinic - Farncombe, United Kingdom",
    toc: false, notes: ["no-toc"],
    sections: [
      {
        title: "Clinic Overview", ps: [
          "Meridian Community Clinic opened in 2009 in the suburb of Farncombe and provides primary care for about 24,000 registered patients. The building offers 11 examination rooms and one minor procedure room.",
          "The clinic employed 38 staff at the end of 2025: nine general practitioners, fourteen nurses, six administrative staff, four health care assistants and five allied professionals.",
        ],
      },
      {
        title: "Patient Volumes", ps: [
          "In 2025 the clinic recorded 52,800 consultations. Of these, 63 percent were offered as same-day appointments, reflecting the walk-in capacity held open each morning.",
          "Telephone and video consultations accounted for 11 percent of all contacts. The average consultation length was 12.4 minutes, slightly above the regional average of 11.1 minutes.",
        ],
      },
      {
        title: "Chronic Disease Program", ps: [
          "The diabetes register included 1,940 patients in 2025. The median HbA1c value of the register was 7.1 percent, and 68 percent of hypertensive patients reached the blood pressure target.",
          "Patients with two or more chronic conditions are offered a quarterly review call by the nursing team. In 2025 the team completed 6,100 such calls with a completion rate of 82 percent.",
        ],
      },
      {
        title: "Vaccination Campaigns", ps: [
          "The autumn influenza campaign delivered 14,700 vaccine doses, reaching 71 percent of registered patients over 65 years of age.",
          "A COVID-19 booster round in spring 2025 delivered 5,320 doses. The HPV catch-up programme vaccinated 910 adolescents, using school sessions at four secondary schools in the catchment area.",
        ],
      },
      {
        title: "Referrals and Diagnostics", ps: [
          "The clinic made 4,120 specialist referrals in 2025. The median waiting time from referral to first specialist appointment was 26 days.",
          "In-house ultrasound is available two days per week and performed 940 examinations. Point-of-care blood testing covers full blood count, CRP and HbA1c with results within ten minutes.",
        ],
      },
      {
        title: "Staffing and Training", ps: [
          "Staff turnover was 8 percent in 2025, with three retirements and no involuntary departures. Two GP registrars completed their training year at the clinic.",
          "The team logged 380 hours of protected training time. Mandatory resuscitation training was completed by 100 percent of clinical staff, and two nurses qualified as prescribers.",
        ],
      },
      {
        title: "Digital Systems", ps: [
          "The clinic uses a cloud hosted patient record system with two factor authentication for all users. Online appointment booking was used for 22 percent of booked appointments in 2025.",
          "A patient messaging pilot reached 4,300 enrolled patients. The average first response time of the administrative inbox was 1.4 working days during the pilot period.",
        ],
      },
    ],
  },
];
