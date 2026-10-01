# Investigación de producto, UX y diseño desktop

Fecha: 2026-09-29. Propuesta de diseño y experimentación; no implementación. Complementa la [estrategia de innovación](open-source-innovation-strategy.md).

## 1. Dirección recomendada

Construir una **mesa de trabajo para leer, contrastar, escribir y estudiar con evidencia**. La composición pone el documento o resultado de trabajo en el centro y mantiene fuentes, conversación y revisión a mano.

Hipótesis de audiencia: investigación como recorrido principal y estudio como recorrido relacionado. Se ha pedido al usuario priorizar ambos usos; hasta recibir respuesta esta jerarquía es provisional. El núcleo sirve a ambos: una referencia verificable, una nota y una versión de fuente.

Conservar nombre y lenguaje visual actuales: papel, tinta, rojo contenido. No se propone rehacer el motor ni reemplazar la aplicación por una nueva web. Este trabajo define recorridos y criterios para el siguiente agente.

## 2. Lectura del estado actual

Inspección sobre `b7250d9` y archivos de trabajo concurrentes. Es una lectura de código, no una auditoría visual de todas las pantallas instaladas.

- Biblioteca, actividad, ajustes y cuaderno ya tienen superficies desktop.
- `NotebookWorkspace.tsx` dedica una barra de 300 px a cinco pestañas —fuentes, afirmaciones, notas, cálculos y materiales— y el espacio principal a conversación. Esto coloca tareas de lectura y edición en un espacio estrecho y hace competir sus controles.
- `EvidencePanel.tsx` ya incluye renderizado PDF y reproducción de intervalos de medios. La siguiente iteración debe integrar ese lector en el espacio principal, conservar su versión y mejorar selección, navegación y accesibilidad; no crear un segundo visor desconectado.
- Los tokens existen, pero la hoja desktop consultada solo expresa el tema oscuro mediante la preferencia del sistema. Definir selección explícita claro/oscuro/sistema y persistencia al implementar.
- Geist y JetBrains Mono están nombradas en CSS; no encontré una declaración `@font-face` en esa hoja. Verificar que las fuentes se empaqueten antes de prometer esa tipografía offline; mantener fallback del sistema.
- Cálculo puntual sobre tokens actuales: blanco sobre `#d2705f`, el acento oscuro, da aproximadamente **3,37:1**. Cambiar el texto del botón oscuro a `#1c1b19` da **5,10:1**; blanco sobre el acento claro `#b4473d` da **5,37:1**. Esto no sustituye una auditoría de todos los estados.
- El catálogo consultado contiene BGE small **EN** para embeddings. Investigar recuperación entre español, alemán e inglés antes de considerar resuelta la búsqueda multilingüe.

Preservar cambios concurrentes. Los comentarios de código y los planes antiguos no prueban que un recorrido esté implementado o probado desde el instalador.

## 3. Referencias investigadas y aprendizaje aplicable

| Referencia primaria | Qué tomar como referencia | Aplicación propuesta |
| --- | --- | --- |
| [Lector y notas de Zotero](https://www.zotero.org/support/pdf_reader) | Relación entre anotación, documento y nota con regreso a la evidencia | Seleccionar un pasaje → guardar evidencia → insertar referencia en una nota → volver al original versionado |
| [Ghostreader de Readwise](https://docs.readwise.io/reader/guides/ghostreader/overview) | Acciones de IA sobre documento o selección | Menú contextual corto: explicar, comparar, preguntar, guardar evidencia; conservar el alcance visible |
| [Formatos de Zotero](https://www.zotero.org/support/dev/data_formats) | Interoperabilidad bibliográfica | Empezar por importación/exportación CSL JSON, BibTeX o RIS; referencias sin metadatos inventados |
| [Docling](https://docling-project.github.io/docling/) y [modelo documental](https://docling-project.github.io/docling/reference/docling_document/) | Extracción estructurada y procedencia de elementos | Evaluar tablas, orden de lectura, OCR y regiones. Convertir resultados a nuestro contrato de evidencia |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) | Reconocimiento de voz ejecutable localmente | Primer candidato para transcripción administrada por Tauri y el sistema de trabajos |
| [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) | Herramientas locales de voz, incluyendo ASR/TTS | Alternativa a evaluar si el alcance de voz lo requiere. Elegir runtime por resultados, no empaquetar ambos por defecto |
| [Qwen3 Embedding](https://github.com/QwenLM/Qwen3-Embedding) | Modelos multilingües de embeddings y reranking | Evaluar una variante pequeña contra el perfil actual, conservando instrucciones, pooling y dimensiones en el perfil |
| [FSRS TypeScript](https://github.com/open-spaced-repetition/ts-fsrs) | Programación de repasos | Añadir cuando existan tarjetas con evidencia y revisiones persistidas; evaluar aprendizaje, no solo volumen de tarjetas |
| [PDF.js](https://mozilla.github.io/pdf.js/) | Renderizado de PDF ya incorporado al proyecto | Ampliar el visor existente con texto seleccionable, navegación y anclas; no duplicar runtimes |

Son patrones y candidatos, no una obligación de incorporar productos completos. No se han instalado ni comparado estos candidatos en este turno. Las condiciones de los pesos, voces, corpus y binarios deben revisarse aparte del código.

## 4. Qué añadir y en qué orden

### A. Mejoras próximas: lectura y evidencia

**Lector como espacio principal.** PDF con miniaturas/índice, página, zoom, búsqueda y texto seleccionable; medios con transcripción sincronizada; CSV con filas y columnas originales. Al abrir una cita se mantiene el alcance de búsqueda y la versión. Las referencias sin localizador fiable muestran esa limitación.

**Anotación que se convierte en evidencia.** Un resaltado puede guardarse, vincularse a una afirmación o insertarse en una nota. Referencia estable a versión, página/región/rango y texto original; una traducción se guarda como derivado, nunca sustituye la cita original. Soportar selección con teclado además del ratón.

**Revisión comparada.** Lista de cambios a la izquierda y versiones anterior/nueva en el centro. La acción dice qué cambia: mantener referencia, actualizar ubicación o registrar una conclusión revisada. La desaparición de una cita no convierte una conclusión en falsa. Mostrar todas las propuestas de una afirmación y su historial tras reiniciar.

### B. Experimentos técnicos prioritarios

**Docling y control de extracción.** Añadir un indicador accionable por fuente: extracción completa, páginas sin texto, tabla pendiente de revisión o error. Permitir abrir original junto al texto extraído y corregir una transcripción o tabla como nueva revisión derivada. La confianza del extractor no es probabilidad de que una afirmación sea verdadera.

Contrato mínimo del adaptador: versión de entrada, extractor/modelo/configuración, bloques tipados, texto, orden de lectura, tablas, anclas de página/región y advertencias. Registrar sistema de coordenadas, dimensiones y rotación al convertir bounding boxes. Cachear por receta completa; no mutar evidencia antigua al actualizar el extractor.

**Voz local.** Transcripción con idioma, segmentos y reproducción del pasaje citado. Descargas administradas desde ajustes, reanudación por segmentos y validación de tiempos sobre audio real. Mantener etiquetas de hablantes como propuesta si se evalúa diarización posteriormente. TTS de lectura accesible precede a podcasts con varias voces.

**Recuperación entre idiomas.** Preguntar en español por una fuente alemana y responder con cita original y traducción diferenciada. Medir calidad por pares de idiomas; comparar híbrido actual, nuevo embedding y reranker por separado. La compatibilidad de formato no prueba calidad ni soporte del modelo en nuestro runtime: comprobar ambos. Cambiar receta exige nuevo índice, con activación cuando esté completo.

### C. Capacidades que dan identidad al producto

**Matriz de evidencia.** Filas = afirmaciones o preguntas; columnas = fuentes seleccionadas. Cada celda distingue evidencia vinculada, discrepancia propuesta, no revisado o no encontrado en la búsqueda realizada. El último estado nunca significa «la fuente no contiene evidencia». Abrir la celda lleva al fragmento, versión y criterio de comparación. Primera versión con relaciones seleccionadas por el usuario; interpretación automática opcional y revisable.

**Preguntas de investigación.** Guardar una pregunta, sus fuentes, conclusiones, huecos y próxima acción. El sistema puede proponer qué falta buscar, pero no presentar un porcentaje de cobertura científica sin una definición verificable. Priorizar «pendiente de contrastar» y «solo una fuente revisada» frente a puntuaciones opacas.

**Escritura con citas.** Notas con referencias insertables, esquema de informe, bibliografía editable y exportación. No inferir autores/DOI/fechas si faltan. Primera integración bibliográfica mediante archivos; conexión a Zotero opcional y explícita posteriormente. Toda generación de párrafos mantiene las evidencias usadas y se acepta como borrador.

**Estudio ligado a evidencia.** Tarjetas, ejercicios y explicación de errores que abren sus fuentes. Cambios de fuente generan revisión del material; no borran el historial de aprendizaje. FSRS se propone para el calendario, no como medida absoluta de comprensión. Distinguir «revisar evidencia» de «repasar una tarjeta» en la terminología.

### D. Después de validar los recorridos anteriores

Carpetas vigiladas con alcance explícito, deduplicación y política de importación visible; capturas web como versiones; búsquedas guardadas; comparación entre cuadernos opt-in; grafo enfocado en una pregunta; publicación y colaboración sobre paquetes. No capturar portapapeles ni enviar archivos nuevos automáticamente a un proveedor remoto.

PageIndex permanece fuera de la configuración recomendada tras PI-2. Una nueva prueba con documentos largos reales, modo y modelo diferentes debe tener criterios propios y datos reservados nuevos. Recuperación visual y RLM conservan su línea experimental; no bloquean el diseño del lector.

## 5. Arquitectura de información

Navegación global compacta: **Biblioteca · Actividad · Ajustes**, más búsqueda de comandos. El nombre del cuaderno y el alcance se mantienen visibles.

Dentro de un cuaderno:

| Vista de trabajo | Espacio central | Inspector contextual |
| --- | --- | --- |
| Investigar | Documento, nota o conversación ampliada | Preguntas, evidencia, propiedades |
| Revisar cambios | Comparación anterior/nueva | Afirmaciones y materiales afectados; decisión e historial |
| Estudiar | Ejercicio, tarjeta o material | Evidencia y explicación; ocultable para responder |

Fuentes, notas, afirmaciones, tablas y materiales viven en una navegación vertical del cuaderno. Son colecciones de objetos; no cinco pestañas apretadas dentro de 300 px. Cambiar de vista conserva fuente, selección, scroll y borrador cuando sea posible.

Composición recomendada para escritorio amplio: navegación de 220–260 px, área central flexible y panel contextual de 320–400 px. El chat se puede ampliar al centro para una investigación conversacional y volver al lateral sin perder el hilo. La posición de la IA depende de la tarea, no ocupa siempre la mayor parte de la ventana.

```text
Biblioteca / Cuaderno              Buscar comandos            Actividad · Ajustes
───────────────────────────────────────────────────────────────────────────────
Fuentes y notas       Investigar | Revisar cambios | Estudiar       Alcance
                      ────────────────────────────────────────────────────────
Informe.pdf           Lector / editor / comparación       Preguntas / evidencia
Clase.mp4             Versión y ubicación visibles        Referencias abribles
Datos.csv             Selección y anotación               Acción sobre selección
                      ────────────────────────────────────────────────────────
Añadir fuente         Estado del trabajo y procesamiento local/remoto
```

Pantallas estrechas: primero ocultar el inspector en un panel con foco gestionado; después convertir la navegación izquierda en un desplegable. Las ventanas pequeñas conservan las funciones mediante navegación, no mediante texto cada vez más diminuto. Si se propone un ancho mínimo de ventana, probar zoom/DPI para no hacerlo excluyente.

## 6. Dirección visual y marca

Concepto: **archivo de investigación contemporáneo**. Papel cálido, tinta legible, jerarquía tipográfica y un acento rojo que identifica acciones. La singularidad está en cómo se ve y se recorre la evidencia.

| Elemento | Propuesta |
| --- | --- |
| Fondo claro | Papel neutro cálido; conservar `#fafafa` o probar `#f7f6f2` como variante, sin cambiar toda la identidad |
| Superficies | Documento blanco, navegación ligeramente más oscura, separadores finos |
| Tinta | `#202020`; texto secundario con contraste medido, sin opacidad arbitraria para contenido esencial |
| Acento | `#b4473d` claro y `#d2705f` oscuro; texto sobre acento mediante token independiente |
| Oscuro | `#1c1b19` / `#242220`, tinta `#ece9e2`; evitar invertir imágenes y PDF originales |
| Tipografía UI | Geist si está distribuida localmente; fallback Segoe UI/system-ui. 14–15 px como punto de partida escalable |
| Lectura | 16–18 px, interlineado 1,55–1,7, medida aproximada de 60–75 caracteres; escala ajustable |
| Datos técnicos | JetBrains Mono donde ayude: tiempo, versión, atajo; no convertir todas las etiquetas en mayúsculas |
| Geometría | Radios de 6–8 px, escala espacial 4/8/12/16/24/32; listas y tablas con separadores |
| Iconos | Reutilizar Lucide ya instalado; misma escala y grosor, etiqueta accesible en botones solo icono |
| Movimiento | 150–220 ms para cambios de estado; respetar movimiento reducido; sin animaciones continuas decorativas |

Crear tokens semánticos: `surface.canvas`, `surface.document`, `text.primary`, `text.secondary`, `action.primary.bg/fg`, `border.default`, `focus`, `status.warning/success/error`. Los nombres aquí son diseño propuesto, no una migración obligatoria a una librería CSS.

Distinguir visualmente tres dimensiones independientes: ubicación del procesamiento, estado del trabajo y estado de revisión de la evidencia. «Local» no significa «correcto». «Revisado» no significa «actualizado». No mostrar una insignia verde global que mezcle esas garantías.

Recursos de marca: conservar el nombre provisional; explorar posteriormente símbolo basado en página y referencia, icono a 16/32/256 px, wordmark y portada de documentación. Mantener ilustraciones editoriales en onboarding/documentación y dejar espacio de lectura en el cuaderno. Disponibilidad legal del nombre y de nuevos activos no verificada en esta entrega.

## 7. Interacciones y estados

- **Importación:** un punto de entrada con archivos, URL o paquete. Vista previa de tipo y destino; progreso por etapas y aviso de extracción parcial. Cancelar el diálogo no es un error de procesamiento.
- **Trabajos:** distinguir «pausa solicitada» de «pausado», y «cancelación solicitada» de «cancelado». Mostrar etapa y unidades reales; ETA solo cuando exista estimación defendible. Continuar en segundo plano desde bandeja y recuperar al reabrir.
- **Búsqueda:** alcance por cuaderno/fuentes con filtros, lista de resultados y ubicación. Reutilizar el texto de la pregunta al pasar al chat; no ampliar fuentes silenciosamente.
- **Respuesta:** evidencia junto a cada afirmación, estado de borrador y acción «guardar como afirmación». Streaming es una mejora posterior al contrato de cancelación; los fragmentos incompletos no se tratan como respuestas finales.
- **Actualización:** indicar versión nueva sin reemplazar el documento que el usuario está citando. Cambiar de versión es explícito. Aceptar un cambio conserva la relación anterior en el historial.
- **Exportación:** previsualización de originales, texto extraído, notas, mensajes y metadatos incluidos. «Sin originales» no significa «sin contenido sensible»: fragmentos y citas también contienen texto. Mostrar esta diferencia antes de compartir.
- **Modelos:** inicio funcional sin modelo; elegir perfil local o proveedor desde ajustes. Explicar idioma, tamaño y capacidad medida. Una comprobación de descarga o JSON no demuestra calidad suficiente para investigar.
- **Onboarding:** abrir ejemplo, seguir una cita y revisar una nueva versión. Objetivo propuesto: completar el recorrido básico en menos de cinco minutos sin terminal ni documentación externa.

## 8. Accesibilidad y plataforma

Objetivo de contraste: texto normal 4,5:1 y elementos no textuales relevantes 3:1; comprobar todos los estados. [W3C, contraste mínimo](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

Preferir controles de 32–36 px de alto en escritorio y mayores cuando haya interacción táctil. El mínimo WCAG 2.2 de objetivo de puntero es 24×24 CSS px o sus excepciones; no confundir ese mínimo con un tamaño cómodo. [W3C, tamaño de objetivos](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

Separadores ajustables con teclado, foco visible, nombre y valor accesibles; restaurar anchos por cuaderno con una opción de restablecer. El patrón APG sirve de guía, no certifica una implementación. [W3C, window splitter](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/).

Atajos propuestos, sujetos a comprobar conflictos del sistema/WebView: Ctrl/Cmd+K comandos, Ctrl/Cmd+F buscar en documento, Escape cerrar panel temporal, navegación entre paneles por teclado. No capturar atajos de edición de texto ni Tab para navegar aplicaciones de forma inesperada.

Pruebas: 1280×720, 1440×900 y ventana estrecha; zoom 100/150/200 %, alemán con etiquetas largas, tema oscuro, teclado y lector de pantalla. Un canvas de PDF necesita representación textual/alternativa accesible. Formularios y diálogos deben anunciar errores y devolver el foco al control de origen.

## 9. Decisiones de implementación para el otro agente

Mantener React/Vite, TanStack Query, Tauri IPC, PDF.js y Lucide presentes. Usar el sistema de tokens y estilos consistente; no migrar todo a una librería de componentes solo por el diseño.

Separar `NotebookWorkspace` en contenedor, navegación, vista central e inspector. Componentes propuestos: `WorkspaceShell`, `SourceNavigator`, `DocumentWorkspace`, `EvidenceInspector`, `ReviewWorkspace`, `StudyWorkspace`, `ActivityDrawer` y `CommandMenu`. Son nombres orientativos; el contrato de datos y la accesibilidad importan más que esos nombres.

Conservar selección/versión/alcance/borradores en estado explícito; datos persistidos a través del motor y caché de consultas. No duplicar reglas de estado de trabajos en componentes. Desacoplar el selector de proveedor de las pantallas de lectura.

El visor debe cargar solo páginas cercanas y liberar canvases/decodificadores; listas grandes requieren medición antes de añadir virtualización. Compartir un stream/event cursor cuando sea apropiado y evitar un poller por componente. Mantener análisis pesado fuera del hilo de UI.

El prototipo de diseño puede usar datos ilustrativos claramente marcados. La aceptación de producto debe usar el motor real y el instalador. Una captura bonita no prueba selección de archivos, permisos del protocolo de activos ni recuperación.

## 10. Experimentos y entregas

| Entrega | Prueba | Criterio para continuar |
| --- | --- | --- |
| D1: estructura de trabajo | Abrir fuente, seguir referencia, volver a nota y cambiar de vista con teclado | Sin pérdida de selección/borrador; controles legibles en los tamaños definidos |
| D2: revisión y matriz | Comparar v1/v2 con varias afirmaciones y decisiones | Toda decisión trazable; diferencias y fuentes distinguibles; no inferir verdad a partir de estado |
| T1: Docling | Corpus nuevo de PDF real redistribuible: columnas, tablas, escaneos y encabezados; baseline actual | Mejora de extracción y anclaje en clases definidas, con tiempo/RAM/tamaño de paquete documentados; ninguna región inventada |
| T2: ASR local | Muestras ES/DE/EN, habla limpia/ruido y archivos largos | Medir WER y error de tiempos; interrupción/reanudación; calidad y velocidad por hardware antes de recomendar perfil |
| T3: búsqueda multilingüe | Consultas en un idioma, evidencia en otro; separaciones dev/reservado nuevas | Comparar recall, respuestas respaldadas, latencia e indexado contra baseline; evaluar reranking por separado |
| D3: escribir/estudiar | Nota citada → material → actualización de fuente | Citas conservadas y material marcado para revisión sin borrar historial |
| U1: piloto | 6–10 usuarios, tareas equivalentes, orden alternado | Medir éxito sin ayuda, tiempo hasta evidencia, errores de versión y comprensión de local/remoto; resultados descriptivos, sin generalizar por muestra pequeña |

Secuencia recomendada: terminar integridad/instalador en marcha; D1 y diseño de D2; experimentar T1/T2/T3 de forma independiente del rediseño; completar D2/D3 según problemas observados; U1 antes de aumentar complejidad. Cada integración técnica entra por sus resultados, no por el nombre del framework.

## 11. Artefacto visual y alcance

La [lámina de composición en PNG](../design/workspace-concept.png), con su [original editable SVG](../design/workspace-concept.svg), muestra una propuesta estática de investigación con documento central. Sus datos son ilustrativos y sus controles no son funcionales. Conserva la interfaz en alemán para que el agente pueda valorar longitudes reales; la especificación está en español.

No se han modificado componentes de la aplicación ni instalado dependencias. La propuesta de audiencia, composición y nuevos experimentos requiere validación de uso; los hechos existentes y sus límites quedan separados de la propuesta.
