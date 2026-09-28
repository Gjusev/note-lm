# Plan de ejecución para el siguiente agente

Revisión: 2026-09-28. Base inspeccionada: commit `d2bcebe`.
Este documento es un encargo de implementación sobre el código existente.
La presente revisión solo añade documentación; no implementa las tareas.

## Objetivo y límites

Entregar una aplicación de escritorio note-lm con Tauri 2 que permita crear
cuadernos, importar fuentes, indexarlas y conversar con citas usando IA local
o un proveedor remoto elegido. Una instalación, sin contenedores ni procesos
que el usuario tenga que arrancar. Incluir identidad visual, ajustes, recuperación
y exportación como parte del producto.

Mantener React/TypeScript, SQLite y el motor existente. No reiniciar el proyecto
ni reemplazarlo por un fork. Usar las alternativas estudiadas como referencias
de producto. Si se incorpora código de terceros, revisar y conservar las
condiciones de su licencia; una reescritura superficial no demuestra independencia.

Leer primero este documento y después, según la tarea:

- [Producto y decisiones](product-blueprint.md).
- [Distribución y marca](desktop-tauri-plan.md).
- [IA local y RAG](local-ai-rag-plan.md).
- [Importador de recursos](resource-importer-plan.md).

Los planes anteriores contienen estados históricos que han quedado atrás.
La tabla siguiente refleja la revisión actual; el agente debe comprobar el
HEAD y el árbol de trabajo al empezar, preservando cambios posteriores.

## Estado comprobado

| Área | Existe ahora | Falta para el producto |
| --- | --- | --- |
| Persistencia | SQLite/Drizzle, archivos locales, migraciones y perfil local | Backup/restauración desde UI y consolidar versionado de fuentes |
| Importación | Importador URL con pruebas; extracción/procesamiento de archivos; PDF probado por IPC | Consumir trabajos de URL dentro del motor de escritorio |
| Escritorio | `src-tauri`, motor NDJSON, comandos de prueba y un artefacto NSIS presente | UI de producto, puente completo y validación del instalador actual |
| IA local | Supervisor llama-server para embeddings y prueba con binario/modelo reales | Chat local, gestión de modelos, ajustes y ciclo de vida integrado |
| RAG | Perfiles, tablas vec0, indexación reanudable básica, FTS5 y fusión RRF | Conectar importación → embeddings → búsqueda híbrida → chat; robustecer actualización y filtros |
| Chat/citas | Chat Next con OpenAI, contexto acotado y extractos citados persistidos | Servicio reutilizable sin Next y selección local/remota; la ruta actual sigue usando FTS |
| Ajustes | Servicio de valores JSON y activación de perfil por IPC | Proveedores por capacidad, credenciales del sistema y pantallas |
| Diseño | Dirección de marca definida y componentes React existentes | Sistema visual aplicado al escritorio, iconos definitivos, estados y accesibilidad |

Validaciones ejecutadas en esta revisión:

- `npm run typecheck`: correcto.
- `npm test`: **118 pruebas correctas**, 18 archivos.
- `npm run test:e2e`: **22 pruebas correctas**, 3 archivos; incluye llama-server
  real y PDF procesado por el motor. Los artefactos de llama están presentes
  en `.probe-downloads` en este equipo; en otro entorno esas pruebas pueden omitirse.
- `npm run eval:retrieval`: FTS e híbrida empatan con recall@10 = 1, MRR = 0,75
  y nDCG@10 = 1 sobre **8 documentos y 8 preguntas**. No demuestra una mejora
  de calidad ni evalúa respuestas generadas.

No se ha reconstruido ni instalado el paquete de escritorio en esta revisión,
ni probado su ventana de forma interactiva. La existencia de un `.exe` previo
no acredita que incluya los últimos cambios o que el recorrido de producto funcione.

## Hallazgos que deben orientar el trabajo

1. **Las piezas nuevas no están conectadas al chat.**
   `src/app/api/chat/route.ts` llama a `searchChunks` y al cliente de
   `src/lib/openai.ts`. `searchHybrid` se utiliza en pruebas/evaluación;
   `startLlama` todavía sirve como auxiliar de pruebas/evaluación. El motor
   no expone operaciones de chat o recuperación completas.
2. **El fallback de búsqueda informa un modo incorrecto.**
   En `src/lib/services/hybrid-search.ts` una excepción vectorial vacía los
   resultados, pero `vectorChunkIds.length >= 0` siempre es verdadero:
   puede devolver `mode: "hybrid"` aunque esa rama haya fallado.
3. **El perfil no identifica toda la receta.**
   `embedding-profiles.ts` reutiliza la fila por proveedor/modelo/revisión,
   ignorando diferencias nuevas de dimensión, pooling y prefijos. Además,
   `retrieval.profile.activate` cambia el perfil activo sin esperar a un índice
   preparado. El plan exige separar perfil solicitado, en construcción y activo.
4. **La indexación necesita endurecerse antes de conectarla.**
   `vector-index.ts` inserta vectores y estado en pasos separados, espera un
   callback síncrono y no comprueba cambios del hash al saltarse filas ya
   indexadas. El supervisor real devuelve promesas. Las tablas vec0 necesitan
   limpieza explícita al borrar/reemplazar chunks; resolver IDs huérfanos
   después del top-k puede dejar menos resultados útiles.
5. **Los filtros están incompletos.**
   `searchHybrid` filtra por cuaderno, pero no recibe selección de fuentes ni
   filtra fuentes completadas/versiones activas. Aplicar esos filtros antes
   de truncar candidatos en las dos ramas.
6. **Tauri sigue siendo un prototipo.**
   `src-tauri/ui/index.html` usa `window.__TAURI__`; la configuración no activa
   `withGlobalTauri` y el esquema instalado lo define como falso por defecto.
   Revisar el puente de la ventana real. Revisar también la diferencia entre
   resolución de recursos del modo `--smoke` y `.setup()`: no debe funcionar
   exclusivamente por encontrar archivos del checkout.
7. **El paquete no cubre aún toda la IA/RAG.**
   `scripts/build-engine.mjs` copia dependencias nativas concretas, pero no
   declara una estrategia de distribución de sqlite-vec y su binario; el
   cargador silencia errores de la extensión. llama.cpp/modelos tampoco están
   incluidos en los recursos del paquete actual. Validarlos fuera del checkout.
8. **Faltan garantías de ciclo de vida.**
   El supervisor de llama no atiende explícitamente el evento `error` del
   proceso; reservar/liberar un puerto no evita una carrera al arrancar otro
   proceso. El puente Rust hace lecturas bloqueantes sin timeout y mata al
   motor al cerrar. Probar ausencia de binario, caída, cancelación y cierre
   con procesos auxiliares antes de integrar inferencias largas.

## Secuencia de ejecución

### 1. Cerrar contratos y corregir integridad del RAG

Archivos principales: `src/lib/services/{hybrid-search,vector-index,
embedding-profiles,search}.ts`, `src/db/local/{schema,migrations}.ts`,
`src/engine/dispatch.ts` y pruebas asociadas.

- Añadir pruebas de regresión para los hallazgos 2–5 y corregirlos.
- Hacer asíncronos los contratos de embeddings para aceptar el supervisor
  real. No mantener una transacción SQLite abierta mientras se hace inferencia.
- Validar dimensiones enteras permitidas, longitud/valores finitos de vectores
  y receta completa. Añadir normalización y versión de preprocesado al perfil
  cuando correspondan. Resolver conflictos con migraciones, sin borrar datos.
- Generar embeddings fuera de transacción; guardar vector y estado juntos,
  comprobando que la versión/hash del chunk siguen vigentes al confirmar.
- Limpiar/reconciliar vectores al borrar o reemplazar fuentes. Mantener citas
  históricas aunque se actualice el índice.
- Distinguir fallo vectorial, índice aún incompleto y búsqueda híbrida correcta
  mediante un resultado tipado que pueda explicar la UI.
- Aplicar filtros dentro de las consultas. Si vec0 no soporta una combinación,
  calcular sobre el conjunto permitido en lugar de filtrar un top-k global.

Aceptación: aislamiento de cuadernos/fuentes probado; cambiar receta no reutiliza
vectores incompatibles; reintentos no duplican; borrado no consume candidatos;
fallback textual informado correctamente; cancelación permite continuar.

### 2. Construir un recorrido completo en el motor

Archivos principales: `src/engine/{dispatch,jobs,processing}.ts`,
`src/lib/ai/llama-supervisor.ts`, `src/lib/services/evidence.ts`,
`src/app/api/chat/route.ts`, `workers/ingestion.ts`.

- Extraer la lógica del chat a un servicio independiente del transporte.
  Mantener API web y escritorio como adaptadores del mismo servicio.
- Introducir contratos por capacidad: conversación, embeddings, transcripción
  y voz. Implementar primero conversación y embeddings locales, más el
  proveedor remoto existente. No exigir una clave para arrancar.
- Ampliar el supervisor para chat y embeddings con modelos/configuraciones
  separados, carga bajo demanda, cancelación, timeout, errores de proceso y
  liberación de memoria. No asumir pooling `mean` para cualquier modelo.
- Encadenar procesamiento completado → cola persistente de embeddings → índice
  disponible. Priorizar consultas frente a indexación masiva.
- Añadir operaciones tipadas de búsqueda, chat y estado/progreso del índice.
  Validar entradas en tiempo de ejecución; no confiar solo en casts TypeScript.
- Integrar el ejecutor de importaciones URL en el motor reutilizando la lógica
  del worker. `imports.create` debe acabar procesándose sin arrancar otro programa.
- Implementar modo local/mixto/sin conexión sin fallback remoto silencioso.
- Conservar los extractos citados; introducir localizadores de página/tiempo
  solo cuando el extractor los proporcione realmente.

Aceptación: prueba del proceso real que cree cuaderno, importe PDF, genere
embeddings locales, recupere por ambas ramas y produzca una respuesta con
modelo local y referencias resolubles. Probar URL, cancelación y reapertura.
No sustituir esta prueba por embeddings simulados; mantener simulados para
las pruebas unitarias deterministas. El modelo de embeddings actual no basta
para validar generación: preparar un modelo de chat con revisión/hash fijados.

### 3. Validar la distribución de ese recorrido

Archivos: `src-tauri/src/{main,engine}.rs`, `src-tauri/tauri.conf.json`,
`scripts/{build-engine,desktop-verify,fetch-node,fetch-ffmpeg}.mjs`.

- Unificar resolución de recursos de la ventana y del smoke test.
- Empaquetar el runtime y todos los binarios/bibliotecas necesarios, incluyendo
  sqlite-vec y llama.cpp, fijando versiones y verificando hashes.
- Añadir transporte con IDs únicos, respuesta correlacionada, eventos de
  progreso, timeout y cierre ordenado. Evitar bloquear el hilo de interfaz
  durante procesamiento o inferencia.
- Limitar llama-server a loopback y autenticar inferencia con token de sesión
  fuera del frontend y los logs. Resolver carreras de puerto con reintentos.
- Comprobar cierre del árbol de procesos, no solo del hijo Node directo.
- Ejecutar el paquete sin Node/FFmpeg en PATH y sin acceso a archivos del repo.
  Extender el smoke para cargar sqlite-vec e inferir localmente; no basta crear
  y listar cuadernos.
- Conservar distribución ligera y paquete offline: la configuración actual
  descarga WebView2. Si se ofrece instalación offline, incluir su runtime y
  los recursos necesarios de forma explícita.

Aceptación: instalación limpia, recorrido de fase 2 desde recursos instalados,
cierre sin procesos propios huérfanos y reapertura con datos intactos. Registrar
si se probó en VM limpia o solo con PATH reducido; no son pruebas equivalentes.

### 4. Convertir el prototipo en interfaz de producto

Crear `src/desktop` con React/Vite y un adaptador Tauri. Reutilizar componentes,
servicios y patrones de consulta existentes; sustituir la pantalla de prueba.

- Biblioteca, cuaderno, fuentes, lectura/conversación, notas y materiales.
- Importación por diálogo/arrastre y enlaces, con progreso/reintento/cancelación.
- Selección de fuentes, búsqueda y citas desplegables conectadas al motor.
- Rutas de frontend para IDs dinámicos sin servidor Next en el paquete.
- Onboarding que permita crear el primer cuaderno antes de configurar IA.
- Primera UI funcional de proveedores y elección de modelo importado.

Aplicar aquí el diseño ya definido: papel/tinta/acento rojo, tipografía
empaquetada, temas claro/oscuro/sistema, paneles ajustables y navegación por
teclado. Definir tokens y componentes antes de multiplicar pantallas. Catálogos
de idiomas con español inicial; preservar contenido y compatibilidad de datos.

Aceptación: una persona puede completar el recorrido desde la ventana instalada,
sin terminal; funciona con teclado y escalado 125–200 %. Comprobar la ventana
real además del modo `--smoke`.

### 5. Gestión completa de modelos y credenciales

- Biblioteca de modelos con capacidad, revisión/hash, tamaño, requisitos
  estimados y estado: disponible, descargando, verificando, cargando o fallido.
- Importar GGUF y descargar desde un catálogo pequeño validado; descarga
  reanudable, cancelación, verificación y promoción atómica.
- Proveedores por tarea y prueba de conexión. Claves remotas en el almacén
  del sistema; en SQLite solo configuración no secreta y referencias.
- Mostrar dónde se procesa cada tarea y qué sale del equipo en modo mixto.
- Presupuesto de memoria y alternancia de modelos para equipos modestos.
- Cambio de embeddings mediante índice nuevo; conmutar cuando esté listo,
  conservando recuperación textual durante el proceso.

Aceptación: configurar sin editar `.env`, importar/descargar y cambiar modelo
desde la UI; sin conexión no hay llamadas externas; una descarga o inferencia
fallida conserva biblioteca y documentos.

### 6. Notas, estudio, exportación y marca final

- Guardar respuestas como notas editables conservando evidencia.
- Conectar resúmenes, tarjetas y cuestionarios al servicio compartido y a
  trabajos ejecutados por el motor; solicitar un material no puede dejarlo
  indefinidamente pendiente sin consumidor.
- Exportar/restaurar cuadernos y probar copia consistente de SQLite con WAL
  más archivos. Incluir metadatos de modelos; pesos opcionales por tamaño.
- Versionar fuentes/localizadores y mantener snapshots de citas tras reimportación.
- Finalizar guía de marca, logo vectorial, iconos, instalador y pantalla Acerca
  de; aplicar los mismos tokens a errores, vacíos, progreso y exportaciones.
- Dejar repaso espaciado, audio con varios interlocutores, mapas y conectores
  adicionales para después de la primera versión estable.

Aceptación: importar → consultar → comprobar → guardar nota → generar material
→ exportar → restaurar mantiene contenido y referencias.

### 7. Evaluar calidad y preparar entrega

- Ampliar corpus con español/alemán/inglés, documentos largos, distractores,
  paráfrasis sin palabras compartidas, contradicciones y preguntas sin respuesta.
- Comparar FTS, vectores solos e híbrida. Con ocho documentos, recall@10 es
  poco discriminante. Separar consultas sin respuesta de métricas de ranking:
  ahora reciben recall/nDCG = 1 aunque haya resultados irrelevantes.
- Medir abstención, fidelidad de respuestas y precisión de citas por separado
  de recuperación. La validez de un ID no demuestra respaldo de la afirmación.
- Registrar modelos, revisiones, hardware, p50/p95 y memoria. No anunciar
  superioridad sobre otras aplicaciones con el corpus actual.
- Actualizar README, índice y estados de planes para describir el producto
  real. Retirar dependencias/configuración antiguas de Convex/auth/Postgres
  solo después de comprobar que no las usa ninguna ruta conservada.
- Comprobar actualizaciones, migraciones, rollback de datos cuando proceda,
  instalación/desinstalación, recursos y avisos de licencias distribuidas.

Aceptación: informe de pruebas reproducible y paquete instalable identificado
por versión/hash. Anotar por separado firma de binarios/publicación si aún no
hay credenciales; no bloquear las comprobaciones locales por ese motivo.

## Primer encargo concreto para el agente

Empezar por **fase 1**, en cambios pequeños con pruebas de regresión. Después
continuar con el recorrido real de fase 2 y su empaquetado de fase 3. No
construir primero todas las pantallas sobre operaciones que todavía no existen.

Antes de editar: comprobar HEAD, `git status` e instrucciones locales. La base
estaba limpia durante esta revisión. Mantener los cambios de terceros que
hayan aparecido después. No reejecutar todos los tests tras cada cambio de
texto; ejecutar los relevantes a cada tarea y la suite completa al integrar.

Cada entrega debe indicar qué recorrido ya funciona, cómo se probó, qué está
simulado y qué falta. El número de pruebas es evidencia de regresión, no una
medida de porcentaje de producto terminado.

No descargar modelos grandes sin explicar previamente tamaño y finalidad.
No iniciar procesos auxiliares visibles. No publicar, enviar mensajes o
desplegar como parte de este encargo local. No marcar terminado por disponer
de módulos aislados o de un instalador que solo prueba el protocolo.
