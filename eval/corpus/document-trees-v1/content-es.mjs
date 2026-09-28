/**
 * Spanish corpus documents (PI-0, document-trees-v1).
 * All strings are fixed literals — edit only with care, the PDFs must stay
 * byte-deterministic and questions.json quotes must keep matching.
 */
export const ES = [
  {
    id: "es-ribera-vinedos", file: "es-ribera-vinedos.pdf", language: "es",
    title: "Bodegas Ribera del Alba",
    subtitle: "Memoria Anual 2025",
    org: "Bodegas Ribera del Alba - Tobalina, España",
    toc: true, notes: [],
    sections: [
      {
        title: "Presentación de la bodega", ps: [
          "Bodegas Ribera del Alba fue fundada en 1972 por Álvaro Sainz y sigue siendo una empresa familiar de segunda generación. La bodega dispone de 148 hectáreas de viñedo propio en el término de Tobalina.",
          "La plantilla está formada por 34 personas fijas, a las que se suman 60 temporeros durante la vendimia. La sala de barricas y la sala de embotellado se rehabilitaron por completo en 2019.",
        ],
      },
      {
        title: "Viñedos y variedades", ps: [
          "La composición varietal del viñedo es la siguiente: tempranillo 62 por ciento, garnacha 21 por ciento, verdejo 12 por ciento y otras variedades el 5 por ciento restante.",
          "Las parcelas se sitúan entre 720 y 860 metros de altitud, con una media de 780 metros. El viñedo se conduce en vaso en las parcelas más antiguas, plantadas entre 1974 y 1988, y en espaldera en las más recientes.",
        ],
      },
      {
        title: "Vendimia 2025", ps: [
          "La vendimia de 2025 comenzó el 22 de septiembre y finalizó el 18 de octubre. Se recogieron 912.000 kilogramos de uva con un rendimiento medio de 6.100 kilogramos por hectárea.",
          "La uva entró sana y con una acidez superior a la de 2024. La noche de octubre más fría registró 2 grados, lo que retrasó la recogida del verdejo una semana respecto al plan inicial.",
        ],
      },
      {
        title: "Elaboración y crianza", ps: [
          "La bodega trabajó en 2025 con 420 barricas de roble, de las cuales el 60 por ciento son de roble americano y el resto de roble francés. La crianza media de los tintos es de 14 meses.",
          "Los blancos fermentan en depósitos de acero a temperatura controlada de 15 grados. Una pequeña partida de garnacha se elabora en ánforas desde 2023.",
        ],
      },
      {
        title: "Ventas y mercados", ps: [
          "En 2025 se vendieron 340.000 botellas, de las cuales el 44 por ciento se exportaron. Alemania es el principal mercado exterior con el 18 por ciento de las ventas, seguido de Estados Unidos con el 11 por ciento.",
          "La facturación alcanzó 4,8 millones de euros, un 6 por ciento más que en 2024. El precio medio de salida de la gama de crianza se situó en 13,50 euros por botella.",
        ],
      },
      {
        title: "Proyectos 2026", ps: [
          "Para 2026 está prevista la construcción de una nueva sala de embotellado con etiquetado automático, que duplicará la capacidad actual de 2.000 botellas por hora.",
          "La finca Valdemoras, con 30 hectáreas, iniciará en marzo de 2026 el período de conversión a agricultura ecológica, que dura tres campañas hasta la certificación.",
        ],
      },
    ],
  },

  {
    id: "es-delta-citricos", file: "es-delta-citricos.pdf", language: "es",
    title: "Citrícola del Delta",
    subtitle: "Informe de Exportación 2025",
    org: "Citrícola del Delta S.A. - Amposta, España",
    toc: true, notes: ["table-split"],
    sections: [
      {
        title: "La empresa", ps: [
          "Citrícola del Delta S.A. fue fundada en 1998 en Amposta por un grupo de doce productores de la comarca. La sociedad opera tres plantas de selección y envasado en la carretera del delta.",
          "Durante la campaña de 2025 la plantilla alcanzó 640 personas en picos de temporada. El consejo de administración está formado por cinco productores elegidos cada cuatro años.",
        ],
      },
      {
        title: "Producción de campaña", ps: [
          "La campaña 2025 cerró con una producción de 41.000 toneladas de naranja, 18.500 toneladas de mandarina y 7.200 toneladas de limón.",
          "El 90 por ciento de la superficie se riega por goteo. La campaña estuvo marcada por una ola de calor en julio que redujo el calibre de la mandarina en las parcelas sin malla antigranizo.",
        ],
      },
      {
        title: "Exportaciones por destino", ps: [
          "La tabla siguiente detalla los principales mercados de exportación de la campaña 2025 por orden de volumen. Las cifras corresponden a toneladas cursadas desde las tres plantas.",
          "Alemania encabeza el ranking con mandarina de calibre 2 y 3. El total exportado fue de 65.100 toneladas, el 97 por ciento de la producción; el resto se destinó al mercado interior.",
        ], table: {
          caption: "Tabla 1: Exportaciones por país, campaña 2025",
          columns: ["País", "Toneladas", "Porcentaje", "Producto principal"],
          widths: [0.30, 0.18, 0.20, 0.32],
          rows: [
            ["Alemania", "12.400", "21%", "Mandarina"],
            ["Francia", "9.800", "17%", "Naranja"],
            ["Reino Unido", "7.300", "12%", "Naranja"],
            ["Países Bajos", "6.100", "10%", "Mandarina"],
            ["Italia", "5.600", "10%", "Limón"],
            ["Portugal", "5.100", "9%", "Naranja"],
          ],
          splitAfter: 6,
          contCaption: "Tabla 1 (continuación): Exportaciones por país, campaña 2025",
          contRows: [
            ["Polonia", "4.900", "8%", "Naranja"],
            ["Canadá", "4.200", "7%", "Limón"],
            ["Emiratos Árabes", "3.100", "5%", "Limón"],
            ["Suecia", "2.700", "5%", "Naranja"],
            ["Irlanda", "2.100", "4%", "Mandarina"],
            ["Suiza", "1.800", "3%", "Mandarina"],
          ],
        },
      },
      {
        title: "Logística y cadena de frío", ps: [
          "La empresa dispone de 21 camiones frigoríficos propios y completa los picos de campaña con transporte concertado. Las cámaras de conservación trabajan entre 0 y 2 grados.",
          "El tránsito terrestre hasta Alemania es de 4 días y hasta Polonia de 5 días. Cada palé se registra con etiqueta RFID desde el envasado hasta la entrega.",
        ],
      },
      {
        title: "Certificaciones", ps: [
          "Las tres plantas están certificadas con GLOBALG.A.P. desde 2015 y mantienen el grado A de la norma BRC. En 2025 se realizaron dos auditorías externas sin hallazgos mayores.",
          "El protocolo de residuos incluye 1.400 análisis por campaña. Dos parcelas quedaron fuera de certificación durante 90 días por un tratamiento no autorizado detectado en agosto.",
        ],
      },
      {
        title: "Previsión 2026", ps: [
          "La previsión de volumen para la campaña 2026 es de 63.000 toneladas, un 8 por ciento más que en 2025, apoyada en las nuevas plantaciones de mandarina de la partida dels Comellars.",
          "La inversión más relevante es una línea de pelado y gajos que entrará en pruebas en octubre de 2026 con una capacidad inicial de 2 toneladas por hora.",
        ],
      },
    ],
  },

  {
    id: "es-cordillera-ferrocarril", file: "es-cordillera-ferrocarril.pdf", language: "es",
    title: "Ferrocarril de la Cordillera",
    subtitle: "Memoria de Explotación 2025",
    org: "Ferrocarril de la Cordillera - Estación de Puente Alto",
    toc: true, notes: [],
    sections: [
      {
        title: "Historia y concesión", ps: [
          "La línea se inauguró en 1913 como ferrocarril minero y se transformó en ferrocarril turístico de montaña en 1988. La concesión administrativa se extiende hasta el año 2058.",
          "La red tiene 96 kilómetros de vía de ancho métrico, con estaciones principales en Puente Alto, Valdemoros y Cima. La empresa es pública y depende de la comunidad de montaña.",
        ],
      },
      {
        title: "Infraestructura", ps: [
          "La línea atraviesa 23 túneles, el mayor de ellos de 1.940 metros. El viaducto del Cóndor, con 284 metros de longitud y 92 metros de altura, es la obra más destacada del trazado.",
          "El tramo de Cima incluye 7,2 kilómetros de cremallera con pendiente máxima de 92 por mil. Los deslizamientos de ladera se vigilan con 34 sensores instalados entre 2021 y 2024.",
        ],
      },
      {
        title: "Tráfico de viajeros", ps: [
          "En 2025 la red transportó 1,84 millones de viajeros, un 12 por ciento más que en 2024. El verano concentra el 47 por ciento del tráfico anual.",
          "El billete sencillo de Puente Alto a Cima cuesta 18,50 euros. Los trenes circulares con locomotora de vapor circularon 84 días durante la temporada.",
        ],
      },
      {
        title: "Tráfico de mercancías", ps: [
          "El tráfico de mercancías alcanzó 210.000 toneladas en 2025. La mercancía principal es el concentrado de cobre de la mina de Valdemoros, con tres trenes semanales.",
          "El tráfico de mercancías se realiza de noche para no interferir con los servicios de viajeros. La mercancía se trasborda a ancho normalizado en la estación de Puente Alto.",
        ],
      },
      {
        title: "Ingresos y subvención", ps: [
          "Los ingresos de explotación sumaron 26,4 millones de euros en 2025, de los cuales el 91 por ciento procede de viajeros y mercancías y el 9 por ciento restante de subvenciones para el mantenimiento de la vía.",
          "El coste por kilómetro circulado es de 19,80 euros en los servicios ordinarios. El gasto de conservación de infraestructura alcanzó 6,1 millones de euros.",
        ],
      },
      {
        title: "Seguridad y mantenimiento", ps: [
          "Se registraron 4 descarrilamientos leves en maniobras de depot, sin heridos. La renovación de vía alcanzó 11 kilómetros en el tramo Valdemoros-Cima.",
          "El sistema de enclavamientos electrónicos cubre ya el 80 por ciento de la red. Las 34 estaciones disponen de comunicación digital y registro de circulaciones.",
        ],
      },
    ],
  },

  {
    id: "es-valle-museo", file: "es-valle-museo.pdf", language: "es",
    title: "Museo del Valle",
    subtitle: "Memoria de Actividades 2025",
    org: "Museo del Valle - Casa del Molino",
    toc: false, notes: ["no-toc"],
    sections: [
      {
        title: "El museo", ps: [
          "El Museo del Valle se fundó en 1985 y ocupa el antiguo molino harinero de la Casa del Molino, rehabilitado entre 1983 y 1985. Dispone de cuatro salas permanentes y una sala de exposiciones temporales.",
          "El museo es de titularidad municipal y se gestiona mediante un convenio con la fundación cultural provincial. El equipo consta de 14 personas entre gestión, sala y conservación.",
        ],
      },
      {
        title: "Colección", ps: [
          "La colección reúne 3.240 obras y objetos registrados. El núcleo más numeroso es la cerámica popular, con 1.100 piezas, seguida de los útiles del molino y de la vida rural.",
          "La pinacoteca incluye 62 lienzos del siglo XIX, con paisajes del valle y retratos de familias locales. La joya de la colección es el retablo procesional de 1748.",
        ],
      },
      {
        title: "Exposiciones temporales", ps: [
          "En 2025 se celebraron cinco exposiciones temporales. La más visitada fue Hilos del Sur, sobre tejeduría tradicional, con 21.400 visitantes entre marzo y junio.",
          "La exposición de fotografía de montaña alcanzó 12.100 visitantes y la muestra de cerámica contemporánea 9.800. Todas las exposiciones se acompañaron de catálogo editado en dos idiomas.",
        ],
      },
      {
        title: "Público y educación", ps: [
          "El museo recibió 68.900 visitantes en 2025, un 9 por ciento más que el año anterior. La entrada general cuesta 6 euros y la reducida 3 euros.",
          "El departamento educativo impartió 340 talleres escolares con 8.900 participantes. Las visitas guiadas de grupo requieren reserva con una semana de antelación.",
        ],
      },
      {
        title: "Restauración", ps: [
          "El taller propio restauró 92 obras en 2025, entre ellas 18 piezas de cerámica del siglo XVI y el conjunto de hierros del antiguo mecanismo del molino.",
          "Cada intervención se documenta con un informe técnico de 12 páginas como media. El taller colabora con la escuela de restauración provincial en dos prácticas formativas al año.",
        ],
      },
      {
        title: "Amigos del museo", ps: [
          "La asociación de Amigos del Museo contaba con 820 socios a finales de 2025. La cuota anual es de 35 euros y da acceso gratuito a todas las salas.",
          "La asociación organizó 14 visitas guiadas exclusivas a almacenes y monumentos de la comarca. Sus aportaciones financian la compra anual de una pieza para la colección.",
        ],
      },
      {
        title: "Difusión y comunicación", ps: [
          "El boletín trimestral del museo se envía a 5.600 suscriptores. La cuenta de la institución en redes sociales superó los 31.000 seguidores en diciembre de 2025.",
          "La radiotelevisión regional dedicó cuatro programas al retablo procesional tras su restauración. La tienda del museo facturó 84.000 euros en publicaciones y reproducciones.",
        ],
      },
    ],
  },

  {
    id: "es-sierra-senderismo", file: "es-sierra-senderismo.pdf", language: "es",
    title: "Red de Senderos de la Sierra Blanca",
    subtitle: "Informe Anual 2025",
    org: "Consorcio de la Sierra Blanca",
    toc: true, notes: ["misleading-headings"],
    sections: [
      {
        title: "Presentación de la red", ps: [
          "La red de senderos de la Sierra Blanca comprende 412 kilómetros señalizados distribuidos en 27 rutas homologadas. El consorcio gestiona el mantenimiento desde 2004.",
          "Las rutas se clasifican en 8 grandes recorridos de más de 20 kilómetros, 12 travesías medias y 7 senderos locales. La ruta más frecuentada es la subida al pico Almirante.",
        ],
      },
      {
        title: "Presupuesto y cuentas", ps: [
          "Bajo este epígrafe se informa del señalamiento y balizamiento de rutas, que en 2025 se financió con cargo a la línea de conservación y no con cargo al capítulo de cuentas corrientes.",
          "Durante 2025 se repintaron 1.240 paneles de madera y se colocaron 380 hitos de piedra en los tramos de crestería. La revisión del balizamiento cubrió 178 kilómetros de senda.",
        ],
      },
      {
        title: "Voluntariado ambiental", ps: [
          "Este epígrafe recoge la economía del senderismo en la comarca, elaborada con las encuestas a caminantes y los convenios con alojamientos firmados por el consorcio.",
          "El consorcio mantiene convenios con 45 refugios y casas rurales de la tarjeta Sendero Amigo. El gasto medio del caminante se situó en 31 euros por día según la encuesta de 2025.",
        ],
      },
      {
        title: "Seguridad en rutas", ps: [
          "Los equipos de rescate intervinieron 18 veces en 2025, la mayoría por esguinces y deshidratación en los meses de julio y agosto. Ninguna intervención fue mortal.",
          "Se cartografiaron con dron 60 kilómetros de los tramos más expuestos. La fuente natural Fuente del Roble se analizó cuatro veces al año y resultó potable en todas las muestras.",
        ],
      },
      {
        title: "Biodiversidad", ps: [
          "El censo de cabra montés estimó 640 ejemplares en la sierra, con una ligera expansión hacia el valle del río Frío. El águila real mantiene 9 parejas reproductoras.",
          "Las cumbres albergan la mayor población de ajedrea de sierra de la región. Las parcelas de seguimiento florístico se miden dos veces al año en 26 puntos fijos.",
        ],
      },
      {
        title: "Colaboraciones", ps: [
          "El consorcio agrupa a 12 ayuntamientos y colabora con la universidad regional en el seguimiento de fauna. La aplicación móvil de la red superó las 38.000 descargas.",
          "Tres empresas de turismo activo trabajan bajo autorización anual. El convenio con la asociación de vecinos de Valdemoros permitió recuperar el camino empedrado del Puerto Viejo.",
        ],
      },
    ],
  },

  {
    id: "es-altiplano-energia", file: "es-altiplano-energia.pdf", language: "es",
    title: "Parque Solar Altiplano",
    subtitle: "Informe Técnico y Financiero 2025",
    org: "Parque Solar Altiplano - Llanura de Zújar",
    toc: true, notes: ["table"],
    sections: [
      {
        title: "El proyecto", ps: [
          "El parque solar Altiplano tiene una potencia instalada de 120 megavatios distribuidos en 312.000 paneles sobre una superficie de 380 hectáreas en la llanura de Zújar.",
          "La planta se conectó a la red en octubre de 2023 y opera desde entonces en régimen de venta a mercado. La subestación elevadora dispone de un transformador de 132 kilovoltios.",
        ],
      },
      {
        title: "Producción 2025", ps: [
          "La producción anual de 2025 fue de 246,3 gigavatios hora. La tabla resume la producción trimestral, las horas de sol medidas y el factor de planta correspondiente.",
          "El mejor trimestre fue el segundo, con un factor de planta del 32 por ciento. La primavera registró cinco días de polvo en suspensión que redujeron la producción un 6 por ciento.",
        ], table: {
          caption: "Tabla 1: Producción trimestral 2025",
          columns: ["Trimestre", "Producción GWh", "Horas de sol", "Factor de planta"],
          widths: [0.20, 0.28, 0.24, 0.28],
          rows: [
            ["T1", "50,1", "529", "23%"],
            ["T2", "70,4", "712", "32%"],
            ["T3", "66,8", "698", "30%"],
            ["T4", "59,0", "554", "27%"],
          ],
        },
      },
      {
        title: "Inversores y mantenimiento", ps: [
          "La planta utiliza 28 inversores centrales de 4,4 megavatios. La disponibilidad técnica de los equipos fue del 98,6 por ciento en 2025.",
          "La limpieza robotizada de paneles se realizó en 6 ciclos. Los módulos bifaciales instalados en las filas norte ganaron un 4 por ciento de rendimiento tras la primera limpieza anual.",
        ],
      },
      {
        title: "Impacto ambiental", ps: [
          "Bajo los paneles se mantiene pastoreo ovino con 2.400 cabezas de un ganadero de la zona, lo que evita el desbroce mecánico en 240 hectáreas.",
          "El seguimiento de avifauna registró 3 colisiones con aves protegidas durante el año. Las medidas de reposición incluyen la plantación de 900 arbustos en los corredores perimetrales.",
        ],
      },
      {
        title: "Economía del proyecto", ps: [
          "La inversión total fue de 118 millones de euros. El precio medio de venta de la energía en 2025 se situó en 41 euros por megavatio hora.",
          "La vida útil de diseño es de 30 años. El servicio de deuda se cubre 1,7 veces con el flujo de caja operativo, y el seguro de producción no se activó en 2025.",
        ],
      },
      {
        title: "Ampliación", ps: [
          "La fase II del parque, con 40 megavatios adicionales, recibió autorización administrativa en noviembre de 2025. Las obras comenzarán en el segundo trimestre de 2026.",
          "El proyecto incluye un sistema de almacenamiento de 60 megavatios hora en baterías de litio, que permitirá desplazar la entrega de energía a las franjas de mayor precio.",
        ],
      },
    ],
  },

  {
    id: "es-norte-textil", file: "es-norte-textil.pdf", language: "es",
    title: "Hilados del Norte",
    subtitle: "Memoria Industrial 2025",
    org: "Hilados del Norte S.A. - Bembibre",
    toc: false, notes: ["no-toc"],
    sections: [
      {
        title: "La fábrica", ps: [
          "Hilados del Norte S.A. fue fundada en 1954 y produce hilos textiles en su planta de Bembibre. La fábrica trabaja en tres turnos con 260 trabajadores.",
          "La planta agrupa las secciones de apertura, cardado, hilatura y bobinado en dos naves. El almacén de producto terminado se automatizó en 2021 con cuatro transelevadores.",
        ],
      },
      {
        title: "Producción de hilos", ps: [
          "La tabla siguiente resume la producción por tipo de hilado en 2025, con el título en Tex y el destino principal de cada familia de producto.",
          "Los hilos técnicos crecieron un 14 por ciento y compensaron la caída del hilo de algodón para confección. La producción total fue de 6.480 toneladas.",
        ], table: {
          caption: "Tabla 1: Producción por tipo de hilado, 2025",
          columns: ["Hilado", "Título Tex", "Toneladas", "Destino principal"],
          widths: [0.30, 0.16, 0.18, 0.36],
          rows: [
            ["Algodón peinado", "30", "1.850", "Confección"],
            ["Algodón cardado", "40", "980", "Punto"],
            ["Lana merino", "34", "620", "Cabonería"],
            ["Poliéster filamento", "75", "890", "Decoración"],
            ["Mezcla algodón-poliéster", "25", "760", "Uniformidad"],
            ["Lino seco", "48", "210", "Tapicería"],
            ["Acrílico alta contracción", "60", "330", "Mantas"],
            ["Técnico aramida", "22", "180", "Protección"],
            ["Técnico vidrio", "68", "240", "Composite"],
            ["Tejidos medicinales", "16", "90", "Sanitario"],
            ["Fibra reciclada", "35", "280", "Automoción"],
            ["Hilo coser industrial", "12", "50", "Confección técnica"],
          ],
        },
      },
      {
        title: "Calidad y certificados", ps: [
          "La planta mantiene la certificación ISO 9001 desde 1998 y la renovó sin desviaciones en la auditoría de marzo de 2025. La tasa de defectos en bobinas fue del 0,8 por ciento.",
          "El laboratorio interno dispone de 14 máquinas de ensayo y analiza 60 muestras diarias. La regularidad de los hilos se controla con probadores automáticos en cada turno.",
        ],
      },
      {
        title: "Energía y agua", ps: [
          "El consumo eléctrico de 2025 fue de 9,4 gigavatios hora, de los cuales el 38 por ciento procede de fuentes renovables mediante contratos con garantía de origen.",
          "El circuito de recuperación de calor de los acondicionadores de naves cubre el 22 por ciento de la demanda de agua caliente. El consumo de agua bajó a 2,1 litros por kilogramo de hilo.",
        ],
      },
      {
        title: "Clientes y pedidos", ps: [
          "La cartera de clientes consta de 62 empresas, con un pedido medio de 4.300 kilogramos. Los plazos de entrega habituales son de 21 días desde la confirmación.",
          "Los cinco mayores clientes concentran el 41 por ciento de las ventas. La facturación de 2025 alcanzó 19,2 millones de euros, con un margen bruto del 18 por ciento.",
        ],
      },
      {
        title: "Personal y formación", ps: [
          "El absentismo voluntario se situó en el 3,1 por ciento, dos décimas por debajo de 2024. La plantilla incluyó 5 aprendices en formación dual durante todo el año.",
          "Se impartieron 2.400 horas de formación, de las cuales 800 correspondieron a seguridad y 600 al manejo de la nueva línea de hilatura de núcleo.",
        ],
      },
      {
        title: "Mercados exteriores", ps: [
          "Las exportaciones representaron el 27 por ciento de las ventas, con Portugal y Francia como principales destinos. El primer pedido de América del Sur se sirvió en octubre de 2025.",
          "La empresa participa en dos ferias internacionales del sector. El gabinete de exportación prepara la certificación de la planta para clientes del sector automoción durante 2026.",
        ],
      },
    ],
  },
];
