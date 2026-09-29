/**
 * Spanish corpus documents (P3, eval/fusion-proto).
 * All strings are fixed literals — the PDFs must stay byte-deterministic and
 * questions.json quote snippets must keep matching. One section = one page;
 * sections must stay short enough to fit a single A4 page (generator asserts).
 */
export const ES = [
  {
    id: "es-cantabrico-faros", file: "es-cantabrico-faros.pdf", language: "es",
    title: "Autoridad de Faros del Cantábrico",
    subtitle: "Memoria anual 2025",
    org: "Autoridad de Faros del Cantábrico - Santander, España",
    sections: [
      {
        title: "Resumen general", ps: [
          "La Autoridad de Faros del Cantábrico mantiene nueve faros en la costa norte desde 1921 y se financia con tarifas de practicaje y fondos europeos.",
          "La plantilla cuenta con 54 trabajadores y el buque de apoyo realiza dos campañas de mantenimiento al año, una por semestre.",
        ],
      },
      {
        title: "Instalaciones", ps: [
          "La torre del faro de Cabo Mayor se eleva 62 metros de altura sobre el risco y su linterna emite un destello cada diez segundos con un alcance luminoso de 24 millas.",
          "El faro de Cabo Menor monta una óptica de 500 milímetros reformada en 2023, y la subestación de Pilares alimenta los nueve enclaves mediante una línea subterránea.",
        ],
        bullets: [
          "Torre de Cabo Mayor: 62 metros de altura",
          "Alcance luminoso: 24 millas",
          "Línea subterránea: 38 kilómetros",
        ],
      },
      {
        title: "Cifras", ps: [
          "El presupuesto de 2025 alcanzó 3,1 millones de euros y las horas de indisponibilidad sumaron 214 en todo el año.",
          "El buque de apoyo navegó 6.400 millas durante las campañas de primavera y otoño, revisando 141 balizas del sistema.",
        ],
      },
      {
        title: "Planes", ps: [
          "En 2027 arranca la inspección con drones y la sustitución de los generadores diésel de los cuatro enclaves sin red.",
          "El plan de accesibilidad abrirá dos torres al público con escaleras seguras y visitas guiadas en horario de verano.",
        ],
      },
    ],
  },

  {
    id: "es-jarama-ferrocarril", file: "es-jarama-ferrocarril.pdf", language: "es",
    title: "Fundación Ferrocarril del Jarama",
    subtitle: "Boletín de actividades 2025",
    org: "Fundación Ferrocarril del Jarama - Rivas-Vaciamadrid, España",
    sections: [
      {
        title: "Resumen general", ps: [
          "La Fundación Ferrocarril del Jarama conserva 22 kilómetros de vía entre Rivas y Arganda y opera trenes históricos desde 1984.",
          "La colección reúne 14 locomotoras, tres de ellas de vapor fabricadas antes de 1930, además de un taller de restauración propio.",
        ],
      },
      {
        title: "Instalaciones", ps: [
          "El taller de Rivas restauró en 2015 la locomotora de vapor de 1917 por 480.000 euros y prolongó la nave para albergar dos vehículos más.",
          "El túnel de Ventosa, de 310 metros, atraviesa el espolón calizo y cuenta con iluminación de bajo consumo renovada en 2022.",
        ],
        bullets: [
          "Restauración de la vapor de 1917: 480.000 euros",
          "Túnel de Ventosa: 310 metros",
          "Longitud conservada: 22 kilómetros",
        ],
      },
      {
        title: "Cifras", ps: [
          "El tren histórico recibió 41.000 visitantes en 2025 y la tienda vendió 9.700 billetes combinados de tren y museo.",
          "El coste de mantenimiento de la vía sumó 210.000 euros, financiado en parte por socios y administraciones locales.",
        ],
      },
      {
        title: "Planes", ps: [
          "La ampliación de seis kilómetros hasta la presa vieja está prevista para 2028, con el estudio geotécnico ya licitado.",
          "El museo del ferrocarril doblará su superficie con una nueva nave expositiva para material de vía y señalización.",
        ],
      },
    ],
  },

  {
    id: "es-tajo-central-solar", file: "es-tajo-central-solar.pdf", language: "es",
    title: "Central Solar Valle del Tajo",
    subtitle: "Informe de operación 2025",
    org: "Central Solar Valle del Tajo - Toledo, España",
    sections: [
      {
        title: "Resumen general", ps: [
          "La central entró en servicio en 2019 y cubre 210 hectáreas de erial en la vega del Tajo, al sur de la provincia.",
          "Produjo 61 gigavatios-hora en 2025, un cuatro por ciento más que el año anterior, con treinta y un empleados permanentes.",
        ],
      },
      {
        title: "Instalaciones", ps: [
          "El campo fotovoltaico reúne 148.000 paneles sobre seguidores de un eje, y robots de limpieza instalados en 2024 recorren las filas de noche sin consumir agua potable.",
          "Doce transformadores elevan la tensión a 66 kilovoltios y la línea de evacuación mide 14 kilómetros hasta la subestación de Villaseca.",
        ],
        bullets: [
          "Paneles instalados: 148.000",
          "Línea de evacuación: 14 kilómetros",
          "Robots de limpieza: instalados en 2024",
        ],
      },
      {
        title: "Cifras", ps: [
          "La disponibilidad alcanzó el 99,2 por ciento y el equipo de operaciones registró 3.140 horas de producción equivalente.",
          "El coste de operación fue de 1,9 millones de euros, repartido entre mantenimiento, vigilancia y arrendamiento rústico.",
        ],
      },
      {
        title: "Planes", ps: [
          "Una batería de 40 megavatios-hora se instalará en 2029 junto al edificio de control, sujeta a permiso ambiental.",
          "El plan de paisaje sembrará setos autóctonos en el perímetro para atenuar el reflejo desde la carretera comarcal.",
        ],
      },
    ],
  },

  {
    id: "es-betizu-queseria", file: "es-betizu-queseria.pdf", language: "es",
    title: "Quesería Betizu",
    subtitle: "Memoria artesanal 2025",
    org: "Quesería Betizu - Cabrales, España",
    sections: [
      {
        title: "Resumen general", ps: [
          "La Quesería Betizu elabora queso de oveja desde 1963 y ordeña 320 ovejas de raza lacha en dos turnos diarios.",
          "Veintisiete empleados cuidan el rebaño, la sala de elaboración y la tienda de la aldea, abierta todo el año.",
        ],
      },
      {
        title: "Instalaciones", ps: [
          "La cava excavada en 2016 almacena 12.000 piezas a una profundidad de doce metros, con paredes de piedra natural que mantienen la humedad.",
          "La sala de maduración suma nueve meses de cura para la gama reserva y el ahumado se hace con leña de haya del valle.",
        ],
        bullets: [
          "Cava de 2016: 12.000 piezas",
          "Profundidad de la cava: doce metros",
          "Cura reserva: nueve meses",
        ],
      },
      {
        title: "Cifras", ps: [
          "La producción de 2025 cerró en 74 toneladas de queso y la exportación representó el 18 por ciento de las ventas.",
          "El rebaño creció con 61 corderos y la facturación subió un siete por ciento respecto al ejercicio anterior.",
        ],
      },
      {
        title: "Planes", ps: [
          "Una línea de yogur artesano se pondrá en marcha en 2027 con leche del propio rebaño, en envases de vidrio retornable.",
          "La quesería abrirá un aula didáctica para escuelas con visita al ordeño de la tarde.",
        ],
      },
    ],
  },
];
