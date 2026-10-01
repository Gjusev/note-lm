# PageIndex: evaluación e integración de análisis documental en Tauri

Fecha: 2026-09-28. Estado: plan para el agente ejecutor; PageIndex no se ha
instalado, integrado ni evaluado en este proyecto durante la preparación del plan.

## Encargo

Evaluar PageIndex como recuperación adicional para documentos largos y,
si supera los criterios definidos abajo, integrarlo como **Análisis profundo**
en note-lm. Mantener FTS5 + sqlite-vec + RRF como recuperación general.
La evaluación debe poder concluir que PageIndex no mejora nuestro caso sin
obligar a incorporarlo al instalador.

Todo el uso final ocurre dentro de Tauri: preparar el índice, elegir modelo,
consultar, abrir citas, ver progreso, pausar, cancelar y recuperar tareas.
El usuario no instala Python ni ejecuta servicios. El modo local utiliza
llama.cpp gestionado por la aplicación; PageIndex Cloud no es una dependencia.

Este trabajo amplía el [plan principal](agent-execution-plan.md), respetando el
[contrato de workers](desktop-workers-plan.md) y el [plan de IA local](local-ai-rag-plan.md).
No sustituye el trabajo en curso de esos módulos. Antes de editar, leer
`CONTEXT.md`, las instrucciones locales y el estado actual de Git.

## Evidencia revisada y decisiones

La documentación y el código público revisados describen:

- Un árbol documental que el modelo consulta para recuperar contenido.
  El modo Flash obtiene estructura del documento y usa IA para refinarla y
  resumirla. Esto es una alternativa de recuperación, no una garantía de
  respuestas correctas. [Repositorio](https://github.com/VectifyAI/PageIndex).
- Indexación local centrada en PDFs con capa textual; el modo local del SDK
  no incorpora el OCR y comprensión de imágenes ofrecidos por su servicio
  cloud. [Guía oficial](https://docs.pageindex.ai/getting-started).
- Un SDK Python con dependencias de parsing e integración de modelos.
  El archivo revisado declara versión 0.2.10; el prototipo debe fijar una
  revisión exacta y dependencias reproducibles, no depender de `main`.
  [Manifiesto](https://github.com/VectifyAI/PageIndex/blob/main/pyproject.toml).
- `LocalAPI.submit_document` construye el índice antes de guardar el documento
  terminado. No asumir recuperación por sección simplemente por envolver
  esa llamada en un worker. [Código](https://github.com/VectifyAI/PageIndex/blob/main/pageindex/local_api.py).
- Configuración de modelos compatibles con OpenAI. El soporte del protocolo
  no demuestra que un modelo pequeño navegue correctamente el árbol o llame
  herramientas: esa compatibilidad y calidad se comprobarán con llama.cpp.
  [Integración del chat](https://github.com/VectifyAI/PageIndex/blob/main/pageindex/local_chat.py).
- Licencia MIT: al reutilizar o adaptar código, conservar copyright y licencia,
  y registrar las dependencias distribuidas. Reescribir en TypeScript no
  elimina por sí mismo las obligaciones de una adaptación.
  [Licencia](https://github.com/VectifyAI/PageIndex/blob/main/LICENSE).

Decisión inicial: **usar el SDK oficial en un prototipo aislado como referencia**.
No reimplementar todo PageIndex antes de saber si aporta valor. Si gana la
evaluación, probar su empaquetado como auxiliar y elegir entre mantener ese
adaptador o implementar un módulo TypeScript de alcance acotado, con nueva
evaluación de equivalencia. La decisión debe considerar tamaño, memoria,
arranque, mantenimiento y recuperación, además de calidad.

## Condiciones de entrada y alcance

Pueden prepararse ahora el corpus, las páginas/localizadores y el contrato.
La integración visible depende de que el motor pueda importar, consultar el
RAG existente y ejecutar/controlar trabajos desde Tauri.

Primera cobertura: PDFs textuales largos con secciones reconocibles, en
español, alemán e inglés. Incluir documentos sin índice para probar rechazo
o degradación. PDFs escaneados necesitan primero OCR local con páginas
conservadas; audio/vídeo, imágenes aisladas y páginas web siguen usando el
pipeline existente. No inventar páginas para representar transcripciones.

En el código inspeccionado, `src/lib/text-extraction.ts` concatena el texto
de las páginas. Debe evolucionar a una extracción estructurada antes de
integrar citas por página, conservando un adaptador de texto para consumidores
existentes. Revisar de nuevo el archivo al empezar porque hay trabajo simultáneo.

## Experiencia dentro del programa

| Opción | Recorrido | Si no está disponible |
| --- | --- | --- |
| Rápida | Recuperación híbrida actual y respuesta con evidencia | Recuperación textual con motivo visible si falla la rama vectorial |
| Profunda | Elegir documentos, consultar árbol/secciones y leer los pasajes originales | Explicar modelo/índice ausente o fallo; permitir preparar índice o usar búsqueda rápida |
| Automática | Seleccionar candidatos con recuperación híbrida y explorar sus secciones cuando la política lo indique | Continuar con rápida, mostrando el modo efectivo |

Inicialmente habilitar Profunda de forma explícita y experimental. Activar
Automática solo después de evaluar sus reglas. Usar disponibilidad del árbol,
estructura documental y tipo de consulta; no un porcentaje de confianza
inventado por el modelo. Mantener un presupuesto máximo de documentos,
pasos, tokens y tiempo. No excluir definitivamente un documento seleccionado
solo porque no apareció en el primer top-k híbrido: evaluar ese caso y ofrecer
Profunda sobre todos los documentos seleccionados dentro del presupuesto.

En la fuente: «Preparar análisis profundo», estado del índice y explorador
de secciones con páginas. En el chat: selector de modo, modo efectivo,
cancelación y citas que abren el PDF. En Actividad: etapas, progreso medible,
pausa/reanudación y errores. Reutilizar los tokens y componentes de marca.

## Datos y contratos propuestos

SQLite sigue siendo el catálogo de negocio. Las estructuras del SDK pueden
vivir como artefactos versionados en disco, relacionados desde SQLite; no
crear una segunda biblioteca que la UI tenga que gestionar separadamente.

Introducir o reutilizar, según el esquema que exista al ejecutar:

- `document_pages`: versión de fuente, índice físico de página, etiqueta
  impresa opcional, texto, hash y procedencia de extracción/OCR.
- `document_tree_indexes`: fuente/versión, backend, revisión de parser/modelo,
  configuración, estado, tarea, ruta/hash del artefacto y versión de formato.
- Nodos: ID estable dentro de una versión, padre, título, rango de páginas,
  resumen y enlaces a texto original. Validar límites y ausencia de ciclos.
- Registro de ejecución: estrategia solicitada/efectiva, modelo, secciones
  consultadas, evidencia recuperada, tiempos, uso y motivo de fallback.

No almacenar razonamiento interno del modelo como explicación de fiabilidad.
Mostrar secciones consultadas y textos citados. Los resúmenes del árbol guían
la selección; las afirmaciones se citan contra páginas originales, no contra
resúmenes generados. Conservar snapshots de evidencia tras reimportar o borrar
un índice derivado, según la política existente de retención de fuentes.

Contrato común orientativo:

```text
retrieve(query, notebookId, allowedSourceIds, strategy, budget, cancellation)
  → effectiveStrategy, evidence[], visitedSections[], warnings[], usage

evidence[]
  → sourceVersionId, page/range, originalText, backendReference
```

FTS/vector y árbol pueden devolver unidades distintas. Normalizarlas a
localizadores/versiones y deduplicar solapamientos antes de crear el contexto.
No mezclar puntuaciones de BM25, distancia vectorial y valoración del LLM
como si fueran equivalentes. El experimento combinado puede usar selección
de documentos seguida de exploración, sin una nueva puntuación global.

Aplicar el filtro de cuaderno/fuentes en cada herramienta de navegación,
lectura de página y resolución de citas. Validar que un resultado del modelo
no referencia un documento fuera de la selección. Tratar texto documental
e instrucciones incluidas en él como datos no confiables.

## Workers, checkpoints y recuperación

Etapas previstas:

```text
guardar versión → extraer páginas → construir árbol → resumir/refinar nodos
→ validar rangos y referencias → publicar índice listo
```

- Ejecutar fuera del bucle de UI/planificador y con límites de CPU, memoria e IA.
- Persistir checkpoints tras páginas y artefactos confirmados. Para resúmenes,
  cachear por hash de texto + modelo + prompt/configuración.
- Con el SDK sin modificar, describir la construcción monolítica como una
  etapa reiniciable: cancelar y volver a construir esa etapa puede ser necesario.
  No mostrar «reanudar sección» si el backend no lo permite. Para ofrecerlo,
  introducir hooks comprobados o una implementación granular y probarla.
- Pausa detiene nuevas unidades; mostrar «Pausando» hasta confirmación real.
  Respetar tokens de ejecución, intención persistida y resultados tardíos
  igual que en el resto de workers.
- Publicar el índice mediante confirmación atómica, solo tras validar
  integridad. Un árbol incompleto no aparece como listo para chat.
- Un cambio de PDF/modelo/parser invalida la versión correspondiente. Construir
  un índice nuevo sin destruir el anterior antes de confirmar el reemplazo.
- Al cancelar una consulta, conservar un borrador claramente incompleto; no
  asumir que el estado interno de inferencia se puede reanudar tras reiniciar.
- En local, ningún paso usa PageIndex Cloud ni un proveedor remoto por defecto.
  En mixto, indicar proveedor por capacidad y aplicar límites de consumo.

## Fases y entregables

### PI-0 · Baseline y corpus

Registrar HEAD, contratos actuales, versión exacta de PageIndex y modelos.
Preparar al menos 20 documentos textuales y 80 preguntas anotadas, con un
subconjunto de desarrollo separado de evaluación. Incluir búsquedas exactas,
referencias cruzadas, comparaciones entre secciones y documentos, y al menos
20 preguntas sin respuesta. Utilizar documentos autorizados y reproducibles.

Entregables propuestos: `eval/corpus/document-trees-v1/`, manifiesto de fuentes,
pasajes/páginas esperados y un informe de baseline. Son rutas a crear, no
artefactos existentes. No reutilizar ocho documentos como única validación.

### PI-1 · Prototipo oficial y compatibilidad local

Preparar un entorno de desarrollo aislado y un adaptador Python del SDK;
es aceptable usar scripts de evaluación aquí, no como entrega al usuario.
Probar construcción, recuperación y chat con llama.cpp local, incluidos
formatos estructurados/llamadas a herramientas que necesite el backend.
Desactivar trazas/telemetría externas de las dependencias cuando corresponda
y verificar tráfico con salida externa bloqueada.

Evaluar cuatro variantes sobre los mismos documentos y preguntas:
FTS sola, híbrida, PageIndex y combinación híbrida + árbol. Mantener el mismo
modelo de respuesta, presupuesto de salida y rúbrica; registrar las llamadas
adicionales de recuperación. La elección de contexto es parte del experimento.

Entregable: informe reproducible con resultados, fallos, hardware, revisiones,
latencia p50/p95, tokens y pico de memoria. Registrar también fallos de parseo
y compatibilidad, no excluirlos silenciosamente del denominador.

### PI-2 · Decisión de producto y backend

Criterios iniciales de decisión, a fijar antes de mirar el conjunto reservado:

- Cero referencias fuera del cuaderno/fuentes autorizadas y cero páginas
  inexistentes presentadas como evidencia válida.
- Mejorar al menos 5 puntos porcentuales las respuestas plenamente respaldadas
  en preguntas estructurales frente a híbrida; no empeorar más de 3 puntos
  en el conjunto general. Informar tamaño de muestra e incertidumbre: este
  piloto orienta producto y no prueba superioridad universal.
- La proporción de respuestas inventadas en preguntas sin respuesta no puede
  aumentar. Evaluar abstención separadamente de recall/nDCG.
- Propuesta inicial para Automática: p95 no superior a 2× la híbrida sobre el
  mismo hardware. Si excede ese presupuesto, valorar solo Profunda explícita
  mostrando el coste temporal; no ocultar diferencias tras un promedio.
- Cumplir un presupuesto de RAM/VRAM fijado tras medir el modelo y equipo de
  PI-0, con cancelación efectiva y degradación controlada al agotarlo.

Si no cumple calidad: conservar el experimento y no añadirlo como requisito
del producto. Si mejora solo ciertos documentos: acotar la función a ellos.
No sustituir la búsqueda general porque un benchmark ajeno anuncie más precisión.

Si procede integrarlo: probar tamaño y ciclo de vida del auxiliar Python
empaquetado. Adoptar una implementación TypeScript solo con alcance y coste
justificados; contrastarla contra el SDK con las mismas pruebas, sin prometer
equivalencia por compartir el concepto de árbol.

### PI-3 · Persistencia e integración del motor

Implementar páginas/localizadores, índices versionados y el contrato común.
Integrar workers y estados en los servicios existentes. Añadir comandos
tipados para preparar, inspeccionar, reconstruir y consultar índices, y
eventos duraderos para el centro de actividad. Reutilizar la capa de evidencia
y los controles de proveedores, sin duplicar el chat.

Archivos a revisar: `src/lib/text-extraction.ts`, `src/db/local/*`,
`src/lib/services/{chat,evidence,hybrid-search,job-control}.ts`, `src/engine/*`.
Los nombres son puntos de partida; preservar y adaptar los cambios en curso.

### PI-4 · Tauri, instalador y experiencia completa

Conectar la interfaz descrita arriba al motor; incluir árbol navegable,
selección de modo y controles de actividad. Empaquetar auxiliares y librerías
con versiones/hashes/licencias, sin instalar Python en el sistema. No iniciar
una segunda web ni depender del checkout. Si se elige backend TypeScript,
mantener las mismas exigencias de recursos nativos y datos de parsing.

Probar PDF → índice → pregunta → página citada → pausa/reanudación → cierre
y reapertura desde el programa instalado, con modelos presentes y red bloqueada.
El modelo local compatible es un recurso gestionado desde Ajustes, no un
comando que el usuario deba ejecutar.

### PI-5 · Regresión y documentación

Casos obligatorios: PDF sin texto, índice incorrecto, página ilegible, tabla
partida entre páginas, árbol inválido devuelto por IA, ID de documento ajeno,
límites de contexto, modelo incompatible, caída del worker, cancelación justo
antes de publicar, cambio de fuente, reconstrucción y restauración de backup.

Comprobar que eliminar índices profundos deja disponible el RAG general y
que restaurar sin modelo permite seguir leyendo y buscar texto. Añadir una
prueba de ventana instalada: el éxito del script comparativo no la reemplaza.

Entregar informe de decisión, instrucciones de reproducción, matriz de
capacidades locales/remotas, limitaciones de pausa y evidencias de la prueba
del instalador. Actualizar los planes para distinguir propuesta y disponible.

## Texto de encargo para el otro agente

> Lee `CONTEXT.md`, las instrucciones locales y
> `docs/specs/agent-execution-plan.md`. Ejecuta la evaluación de
> `docs/specs/pageindex-integration-plan.md` sin interrumpir el trabajo actual
> de Tauri, workers y RAG. Empieza por PI-0 y PI-1; usa sus resultados para
> tomar la decisión PI-2. Si supera los criterios, continúa con PI-3 a PI-5.
> Todas las funciones finales deben controlarse desde Tauri, incluyendo
> modelos locales, progreso, pausa, cancelación y recuperación. Conserva el
> RAG híbrido general y los cambios existentes. No presentes como implementada
> ninguna capacidad que solo esté en scripts o documentación. Informa por
> entrega de archivos cambiados, pruebas, resultados medidos y pendientes.
