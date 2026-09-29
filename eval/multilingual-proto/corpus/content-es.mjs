/**
 * Spanish corpus documents (T3, eval/multilingual-proto).
 * All strings are fixed literals — the PDFs must stay byte-deterministic and
 * questions.json quote snippets must keep matching. One section = one page;
 * sections must stay short enough to fit a single A4 page (generator asserts).
 */
export const ES = [
  {
    id: "es-guadalquivir-azud", file: "es-guadalquivir-azud.pdf", language: "es",
    title: "Azud de Villanueva",
    subtitle: "Memoria técnica de la campaña 2024",
    org: "Confederación Hidrográfica del Guadalquivir - Sevilla, España",
    sections: [
      {
        title: "Resumen general", ps: [
          "La Confederación Hidrográfica del Guadalquivir opera el azud de Villanueva desde 1972. La presa móvil regula el nivel del río para el riego y abastece a las comunidades de regantes del valle medio.",
          "El azud regula el riego de 24.000 hectáreas repartidas entre cuatro comunidades de regantes. La infraestructura pertenece al dominio público hidráulico y se inspecciona dos veces al año.",
        ],
      },
      {
        title: "Instalaciones", ps: [
          "La cámara de aforos mide el caudal cada 15 minutos y envía los datos por telemetría al sistema SAIH. Tres sensores de calidad controlan la temperatura, la turbidez y el oxígeno disuelto.",
          "El cambio de las compuertas planas se ejecutó en 2020 con presupuesto propio. La casa de válvulas y la pasarela de servicio se repararon en la misma intervención.",
        ],
        bullets: [
          "Compuertas: 5 vanos planos de 8 metros",
          "Telemetría SAIH: cada 15 minutos",
          "Última intervención mayor: 2020",
        ],
      },
      {
        title: "Cifras de la campaña", ps: [
          "El caudal medio fue de 82 m³/s durante la campaña de aforos de 2024, un 11 por ciento por encima de la media plurianual. El periodo de estiaje se concentró entre julio y septiembre.",
          "La desembalse para riego alcanzó 145 hm³ en la campaña 2024. El presupuesto de explotación del azud fue de 6,3 millones de euros, financiado con el canon del agua.",
        ],
        bullets: [
          "Caudal medio 2024: 82 m³/s",
          "Desembalse de riego: 145 hm³",
          "Presupuesto de explotación: 6,3 M€",
        ],
      },
      {
        title: "Planificación", ps: [
          "Para 2028 está prevista una segunda compuerta de evacuación de avenidas junto al estribo izquierdo. El proyecto se someterá a evaluación ambiental en 2026.",
          "La Confederación ejecutará una reforestación de 90 hectáreas de ribera aguas abajo del azud, con especies autóctonas de sauco y fresno, financiada con fondos de recuperación.",
        ],
      },
    ],
  },

  {
    id: "es-montseny-reserva", file: "es-montseny-reserva.pdf", language: "es",
    title: "Reserva de la Biosfera del Montseny",
    subtitle: "Informe de gestión del territorio",
    org: "Diputación de Barcelona - Área de Espacios Naturales",
    sections: [
      {
        title: "Resumen general", ps: [
          "La Reserva de la Biosfera del Montseny fue declarada por la UNESCO en 1978 y abarca masas de hayedo, turberas y cumbres mediterráneas entre dos provincias catalanas.",
          "La gestión coordina propietarios privados, ayuntamientos y la administración forestal. El territorio combina explotación agraria tradicional con conservación de hábitats de alta montaña.",
        ],
      },
      {
        title: "Programa del tritón", ps: [
          "El tritón del Montseny es un anfibio endémico de los torrentes de la sierra. El programa de cría en cautividad ha logrado reintroducir 1.100 ejemplares desde 2007 en once torrentes recuperados.",
          "El vivero de fauna mantiene tres poblaciones de reserva genética. Los censos de primavera cuentan adultos con métodos estandarizados de rastreo nocturno.",
        ],
        bullets: [
          "Reintroducciones desde 2007: 1.100 ejemplares",
          "Torrentes con población estable: 11",
          "Poblaciones de reserva: 3",
        ],
      },
      {
        title: "Cifras del territorio", ps: [
          "El hayedo protegido cubre 1.900 hectáreas y la cota máxima es de 1.706 metros en el Turó de l'Home. La reserva recibió 240.000 visitantes durante 2024, con accesos regulados en temporada alta.",
          "Los servicios de mantenimiento gestionan senderos señalizados y aparcamientos disuasorios. El pasto extensivo se recupera con contratos de ganadería de montaña.",
        ],
        bullets: [
          "Hayedo protegido: 1.900 hectáreas",
          "Cota máxima: 1.706 metros",
          "Visitantes 2024: 240.000",
        ],
      },
      {
        title: "Planificación", ps: [
          "El plan plurianual instala cercados de regeneración en 14 parcelas de hayedo para favorecer la incorporación de arbolado joven frente a la sequía.",
          "El seguimiento climático se refuerza con 9 estaciones meteorológicas de alta resolución conectadas por radio, que transmiten cada hora a la red de investigación.",
        ],
      },
    ],
  },

  {
    id: "es-valdepeluca-cavas", file: "es-valdepeluca-cavas.pdf", language: "es",
    title: "Bodegas Valdepeluca",
    subtitle: "Memoria de vendimia y comercio",
    org: "Valdepeluca S.L. - Rioja Alta, España",
    sections: [
      {
        title: "Resumen general", ps: [
          "Bodegas Valdepeluca es una casa familiar fundada en 1968 y gestionada hoy por la tercera generación. La bodega elabora vinos de guarda y cavas de larga crianza.",
          "El viñedo propio suma 340 hectáreas en laderas de altitud media, con parcelas de tempranillo, garnacha y viura. Una parte se vende a otras casas de la denominación.",
        ],
      },
      {
        title: "Sala de barricas", ps: [
          "La sala de barricas alberga 4.200 barricas de roble, de las cuales el 60 por ciento son de roble francés y el resto americano y húngaro. Las barricas se someten a aforo trimestral para controlar la evaporación.",
          "La nave está climatizada a temperatura constante y la humedad se mantiene con suelo de grava humedecida. Las Series de guarda superan los 24 meses de crianza en madera.",
        ],
        bullets: [
          "Barricas totales: 4.200",
          "Roble francés: 60 por ciento",
          "Aforo: trimestral",
        ],
      },
      {
        title: "Cifras de la vendimia", ps: [
          "La vendimia de 2024 recogió 2.900 toneladas de uva con un rendimiento controlado de vendimiadores selectivos. La calidad sanitaria fue excelente y la acidez se mantuvo alta.",
          "La bodega embotelló 1,9 millones de botellas en la campaña y el 38 por ciento de las ventas fue exportación, principalmente a Estados Unidos y Alemania.",
        ],
        bullets: [
          "Vendimia 2024: 2.900 toneladas de uva",
          "Embotellado: 1,9 millones de botellas",
          "Exportación: 38 por ciento",
        ],
      },
      {
        title: "Planificación", ps: [
          "Para la próxima campaña se plantará una parcela experimental de 6 hectáreas con clones de bajo vigor y portainjertos resistentes a la sequía.",
          "La bodega incorporará enología de precisión con sondas de oxígeno disuelto en depósito y calibración por lotes del embotellado.",
        ],
      },
    ],
  },

  {
    id: "es-almeria-granos", file: "es-almeria-granos.pdf", language: "es",
    title: "Terminal de Granos del Puerto de Almería",
    subtitle: "Memoria operativa 2024",
    org: "Autoridad Portuaria de Almería - España",
    sections: [
      {
        title: "Resumen general", ps: [
          "La Terminal de Granos del Puerto de Almería opera desde 1991 y es la instalación de referencia para la importación de cereal en el litoral suroriental.",
          "La terminal sirve a fábricas de piensos y molinos de la provincia mediante camión y ferrocarril. Su silueta de silos blancos es un hito visual del muelle de levante.",
        ],
      },
      {
        title: "Instalaciones", ps: [
          "La cinta transportadora principal mueve 850 toneladas por hora desde el cargadero hasta la galería superior de los silos. El calado operativo del muelle es de 9,5 metros en pleamar.",
          "El parque consta de catorce silos con ventilación forzada y sondas de temperatura. Las tolvas de descarga disponen de captación de polvo y balanza de precinto.",
        ],
        bullets: [
          "Cinta principal: 850 toneladas por hora",
          "Calado del muelle: 9,5 metros",
          "Silos: 14 con ventilación forzada",
        ],
      },
      {
        title: "Cifras del ejercicio", ps: [
          "Durante 2024 la terminal importó 310.000 toneladas de cereal, sobre todo maíz y cebada de suministro forrajero. El grano llegó principalmente en graneleros pequeños del Mediterráneo.",
          "El tráfico del ejercicio atendió 46 buques con una rotación media de muelle de dos días. La actividad generó 74 empleos directos estables en muelle y oficina.",
        ],
        bullets: [
          "Importación 2024: 310.000 toneladas",
          "Buques atendidos: 46",
          "Empleos directos: 74",
        ],
      },
      {
        title: "Planificación", ps: [
          "La ampliación prevista añade 2 silos con capacidad adicional de 9.000 toneladas y una nueva toma de camión en la fachada sur del recinto.",
          "La cubierta fotovoltaica sobre la galería de cintas entrará en servicio en 2027 y cubrirá el consumo de la iluminación nocturna del muelle.",
        ],
      },
    ],
  },
];
