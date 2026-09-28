# note-lm: producto de investigación y estudio

Fecha: 2026-09-28. Estado: dirección de producto y backlog; primera mejora de
trazabilidad implementada. No describe una aplicación de escritorio ya terminada.

Este documento unifica las referencias de producto y ordena la ejecución.
El [plan Tauri](desktop-tauri-plan.md) sigue siendo la especificación de
distribución y el [plan del importador](resource-importer-plan.md), la de captura.

## Propuesta

**Un cuaderno instalado en tu ordenador para convertir fuentes dispersas en
conocimiento que puedes comprobar, escribir y estudiar.**

Público inicial: estudiantes e investigadores individuales que trabajan con
documentos, páginas y clases grabadas. Una persona, una biblioteca local,
claves propias si utiliza IA remota. La experiencia inicial debe funcionar
sin cuenta, contenedores, terminal ni servicios administrados por el usuario.

El recorrido principal es **capturar → consultar → comprobar → escribir →
repasar → exportar**. Cada transformación debe conservar su relación con las
fuentes. Ese recorrido, junto con la instalación sencilla, será el criterio
para priorizar; el número de funciones no demuestra superioridad.

## Qué adoptamos de cada referencia

Revisión de documentación pública de los proyectos, no auditoría comparativa
de sus implementaciones ni prueba de sus binarios. Las selecciones siguientes
son decisiones propias; no requieren adoptar sus stacks ni copiar sus pantallas.

| Referencia | Aportación que nos interesa | Decisión para note-lm |
| --- | --- | --- |
| [Cortex](https://github.com/PndaMan/cortex) | Escritorio Tauri, organización de fuentes, tarjetas con repetición espaciada y búsqueda híbrida | Un instalador; cuadernos y temas; tarjetas enlazadas a evidencia; repaso después del núcleo de investigación |
| [SurfSense](https://github.com/MODSetter/SurfSense/tree/main/surfsense_local) | Captura y generación de materiales como trabajos separados en su aplicación local | Colas diferenciadas y límites de concurrencia para que una transcripción no bloquee consultas; estudio de formatos después de una importación fiable |
| [Open Notebook](https://github.com/lfnovo/open-notebook) | Cuadernos multimodales, transformaciones, selección de modelos y audio con varios participantes | Plantillas reutilizables sobre una selección de fuentes; proveedor por tarea; audio construido a partir de un guion revisable |
| [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) | Elección de proveedores, espacios de trabajo y experiencia de chat sobre documentos | Configuración guiada de IA y herramientas acotadas al cuaderno; evaluar conectores una vez resuelto el flujo principal |
| [AI Notebook](https://github.com/lukoplt/AI-notebook) | Experiencia de escritorio, búsqueda local y citas con fragmentos concretos | Citas desplegables, conservación del extracto consultado y navegación al documento; claves en el almacén del sistema |

El importador propio mantiene la idea de identificar un recurso y resolver su
mejor representación: texto o subtítulos cuando basten, audio/vídeo cuando
sea necesario. Su alcance se documenta por proveedor y formato; no prometer
compatibilidad universal ni depender de una instancia pública de Cobalt.

## Diferencia de producto que vamos a construir

1. **La evidencia viaja con el trabajo.** Una respuesta, nota, tarjeta o guion
   conserva los fragmentos de los que parte. Se puede consultar el extracto
   incluso si la fuente cambia. Una cita identifica evidencia disponible;
   no certifica que el razonamiento del modelo sea correcto.
2. **Investigar y estudiar comparten el mismo cuaderno.** Seleccionar fuentes,
   preguntar, guardar una conclusión editable y convertirla en tarjetas sin
   repetir importaciones ni perder referencias.
3. **El usuario controla la IA.** Selección de proveedor/modelo por chat,
   embeddings, transcripción y voz. Ajustes indican qué contenido se enviará
   al proveedor. Los datos locales no convierten una llamada remota en offline.
4. **Instalar y abrir.** Base de datos, motor y herramientas gestionados por la
   aplicación; restauración y exportación accesibles desde la interfaz.

Estas son hipótesis de valor. No afirmar que somos mejores que las referencias
o que igualamos NotebookLM hasta probar el recorrido con usuarios y un corpus
común. Las funciones pendientes deben distinguirse de las disponibles.

## Recorrido de la primera versión

1. Abrir la aplicación y crear un cuaderno, sin registrarse.
2. Arrastrar documentos o pegar enlaces. Antes de procesar, mostrar título,
   tipo, duplicados y si alguna etapa requiere IA remota.
3. Ver el progreso y poder cancelar o reintentar por fuente. Las fuentes
   completadas están disponibles aunque otras fallen.
4. Elegir fuentes y preguntar. Cada referencia abre su extracto y, cuando
   exista un localizador, la página o el momento de la grabación.
5. Guardar una respuesta como nota editable conservando las referencias.
6. Crear un resumen o tarjetas; revisar antes de guardar el material.
7. Cerrar, reabrir y continuar. Exportar el cuaderno y restaurarlo desde la UI.

Sin claves se pueden gestionar cuadernos, leer, tomar notas, importar formatos
que no necesitan IA y buscar texto. Las acciones que requieren un proveedor
indican cómo configurarlo. La primera versión incluye una opción de chat y
embeddings locales con llama.cpp gestionado por la aplicación, sin exigir
Ollama. Los modelos se descargan o importan desde Ajustes. El
[plan de IA local y RAG híbrido](local-ai-rag-plan.md) concreta su ejecución.

## Alcance y orden de entrega

| Entrega | Resultado utilizable | Condición de aceptación |
| --- | --- | --- |
| P0 · Evidencia | Referencias de chat vinculadas al contexto real y extractos desplegables | No generar fichas de citas para fragmentos descartados, no citados, de otros cuadernos o sin procesar |
| P1 · Vertical de escritorio | Instalador Windows que abre, crea un cuaderno e importa un PDF de texto | Máquina sin Node, Docker, Convex o FFmpeg instalado; cerrar/reabrir conserva datos y termina los procesos auxiliares |
| P2 · Investigación e IA local | Gestor llama.cpp, chat/embeddings locales, RAG SQLite híbrido, selección de fuentes, localizadores y notas con citas | Recorrido sin conexión con modelos instalados; evidencia de las fuentes elegidas y referencias a su versión/ubicación |
| P3 · Estudio | Resúmenes, tarjetas y cuestionarios editables sobre fuentes elegidas | Cada material conserva sus referencias; respuestas de evaluación comprobables; exportación y restauración verificadas |
| P4 · Ampliación | Repaso espaciado, audio con guion, mapas y conectores elegidos por demanda | No degradar latencia del chat; costes/proveedores visibles; cada formato tiene evaluación propia |

P1 incluye onboarding, ajustes de proveedor, credenciales del sistema, tokens
visuales y navegación base. El prototipo de empaquetado de P1 debe validarse
antes de migrar toda la interfaz, incluyendo llama.cpp y sqlite-vec. P2 y P3 completan la primera versión de
producto; P4 no bloquea esa entrega. macOS/Linux siguen tras validar Windows.

Quedan fuera de esta primera versión: colaboración multiusuario, sincronización
en nube propia, agentes con acciones externas, marketplace, calendario completo,
generación de cualquier formato y soporte de todas las plataformas de vídeo.

## Arquitectura de implementación

Se conserva la decisión **Tauri 2 + React/Vite + motor TypeScript con runtime
incluido + SQLite + archivos locales**, descrita en el plan de escritorio.
La UI llama a contratos de dominio mediante Tauri; el motor se comunica por
stdin/stdout privado. El producto empaquetado no necesita un servidor Next.
El auxiliar llama-server utiliza exclusivamente loopback autenticado y es
gestionado por la aplicación. El repositorio actual todavía usa rutas Next
durante la transición.

Límites entre módulos:

- `capture`: clasificación, descarga, extracción, procedencia y deduplicación.
- `library`: cuadernos, fuentes, versiones, notas, archivos y exportación.
- `retrieval`: filtros, FTS5, embeddings reales y fusión de resultados.
- `evidence`: presupuesto de contexto, referencias y extractos persistidos.
- `studio`: materiales editables, guiones y sus relaciones con la evidencia.
- `providers`: capacidades y configuración por tarea; credenciales fuera de
  los documentos y exportaciones.
- `jobs`: tareas reanudables con progreso, cancelación y concurrencia limitada.

Son límites de responsabilidad, no una obligación de crear siete servicios.
Reutilizar `src/lib/services`, `src/lib/ingestion` y la base local existente.
La primera pieza `evidence.ts` ya es independiente del transporte Next/Tauri.

La búsqueda híbrida utilizará SQLite/FTS5, sqlite-vec y fusión RRF tras una
prueba de empaquetado. Guardar modelo, dimensiones y versión de embeddings;
reindexar cuando cambien. FTS5 debe seguir funcionando sin proveedor de
embeddings. No confundir el campo actual `embeddingId` con un índice vectorial
real: el chat revisado utiliza FTS5/BM25.

## Modelo de evidencia objetivo

```text
Source → SourceVersion → Chunk + Locator
                         ↓
                    EvidenceSnapshot
                         ↓
                 Message / Note / Material
```

Un localizador puede ser página y rango de texto, o tiempo inicial/final.
No inventar números de página a partir del índice del fragmento. Cada snapshot
debe incluir versión o hash, fuente, ubicación, texto enviado y fecha. Una
reimportación crea una versión nueva; las referencias existentes conservan la
versión citada. La eliminación de originales mantiene los extractos asociados
salvo que el usuario elija eliminar también ese contenido derivado.

P0 conserva título, fuente, índice y extracto enviado en el JSON del mensaje;
no introduce todavía versiones ni localizadores de página/audio. Las citas
históricas anteriores conservan sus datos: no pueden validarse retroactivamente.

## Marca y diseño

Nombre de trabajo: **note-lm**. Promesa editorial: **«De tus fuentes a tus ideas»**.
Antes del lanzamiento se revisarán nombre, disponibilidad y diferenciación;
no se asume que esta denominación esté disponible como marca registrada.

La identidad propia evoluciona la libreta existente: papel, tinta, retícula
sutil y acento rojo. La retícula funciona en portadas y vacíos, con superficies
tranquilas para lectura. Geist Sans para interfaz, JetBrains Mono para datos
breves. Paleta inicial: papel `#FAFAFA`, tinta `#202020`, acento `#B4473D`;
tokens semánticos para claro/oscuro/sistema y contraste medido por componente.

La aplicación tendrá tres áreas ajustables: biblioteca de fuentes, lectura o
conversación, y notas/materiales. En ventanas pequeñas se convierten en vistas
alternables; no mantener tres columnas estrechas. Una referencia abre evidencia
en el contexto de trabajo y permite regresar sin perder la posición.

Voz: directa, en español inicialmente, con catálogos para otros idiomas.
«Añadir fuentes», «Ver fragmento», «Guardar como nota», «Repasar». Evitar
promesas como «respuesta verificada» cuando solo se ha validado la referencia.
Las cadenas actuales en alemán se migrarán con los componentes, sin cambiar
el idioma de documentos ni traducciones existentes de forma destructiva.

Entregables de diseño incluidos en P1–P3:

- Guía de marca, logotipo vectorial simplificado, icono legible en 16–256 px,
  versiones claras/oscuras y recursos para instalador y pantalla Acerca de.
- Tokens y componentes para botones, fuentes, citas, progreso, selección,
  errores, estados vacíos y configuración de proveedores.
- Prototipo navegable del recorrido completo, con teclado, foco visible,
  escalado 125–200 % y reducción de movimiento.
- Biblioteca visual de referencia para que instalador, aplicación y
  exportaciones mantengan una identidad coherente.

La [sección de marca del plan Tauri](desktop-tauri-plan.md#marca-dirección-visual-y-diseño-de-producto)
detalla los entregables. No reutilizar logotipos o identidad de los proyectos
de referencia ni presentar sus capturas como diseños propios.

## Cómo decidiremos si el producto mejora

Preparar un corpus versionado: PDFs digitales y escaneados, páginas web,
transcripciones, fuentes contradictorias y preguntas sin respuesta. Para cada
pregunta, anotar fuentes y pasajes aceptables. Separar datos de desarrollo de
los usados en la evaluación final.

| Medida | Criterio de salida propuesto |
| --- | --- |
| Aislamiento de cuadernos | Cero fragmentos de otros cuadernos en pruebas de recuperación/chat |
| Integridad de referencias | Toda cita mostrada identifica un extracto realmente enviado; referencias inexistentes se señalan |
| Fidelidad de respuestas | Revisión humana de al menos 50 preguntas; objetivo inicial ≥90 % de afirmaciones factuales respaldadas, registrar también omisiones y abstenciones |
| Recuperación | Comparar recall@10 de FTS5 frente a híbrida sobre las mismas preguntas anotadas antes de activar la segunda por defecto |
| Continuidad | Cierre durante importación, reapertura y reintento sin duplicados en los escenarios probados |
| Distribución | Instalación, apertura, importación, chat configurado y restauración en Windows limpio sin herramientas de desarrollo |
| Facilidad de uso | Prueba con cinco usuarios: al menos cuatro completan importar → preguntar → abrir evidencia → guardar nota sin ayuda |
| Rendimiento | Registrar hardware, corpus, arranque y latencia p50/p95; fijar presupuestos tras medir P1, sin anunciar cifras inventadas |

Medir versiones concretas de otros productos únicamente si se hace una prueba
comparativa equivalente. Estas metas aún no son resultados alcanzados.

## Estado del primer corte de implementación

Implementado en esta iteración:

- Construcción de contexto acotada incluyendo etiquetas y escapado JSON;
  los extractos muy largos se recortan respetando el presupuesto.
- Resolución de referencias por fragmento emitidas por el modelo. Solo se
  guardan las presentes en el contexto y citadas; las desconocidas se señalan.
- Exclusión de fuentes sin completar; fichas desplegables con el extracto
  persistido y numeración correspondiente a la respuesta.
- Corrección del alias `chunkId` devuelto por FTS5 para ajustarlo al contrato.
- Pruebas del presupuesto, referencias, persistencia SQLite, aislamiento y UI.

Pendiente: comprobar entailment (que la afirmación se deduce del extracto),
abstención consistente del modelo, localizadores/versionado, búsqueda híbrida,
selección de fuentes y toda la distribución Tauri. No se ha evaluado aquí la
calidad de un modelo remoto ni construido un instalador.
