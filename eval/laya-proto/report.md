# LAYA evaluation report — triage decisions for note-lm

Status: **COMPLETED — NEGATIVE RESULT (do not adopt zero-shot)**, recorded
following the PI-2 precedent. Criteria: [criteria.md](criteria.md), fixed
BEFORE the run. Model of record: `convaiinnovations/laya-multilingual`
= subfolder `multilingual` of `convaiinnovations/laya` @
`55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851` (mmBERT-base 322M,
Apache-2.0), zero-shot, shipped calibration.

## Results (`results/laya-eval.json`, `results/run-meta.json`)

2.115 decisiones batched en CPU (torch 2.14.0+cpu), 20 batches de ≤128,
wall 308,7 s, **0,146 s/decisión** (peor batch 0,354 s).

- **U1 matriz de evidencia**: page-AUROC **0,5206** (azar = 0,5);
  doc-level dev AUROC 0,6612; recall@1 **3/24 = 0,125** (azar ≈ 0,083);
  preguntas unanswerable: **0/6 limpias** (todás superficie alguna fuente
  con prob ≥ 0,5). Medianas casi idénticas: positivas 0,156 vs
  negativas 0,144 — la cabeza `noul` no discrimina relevancia a nivel
  página en este dominio.
- **U2 priorización de review proposals** (builder corregido: fact-like,
  `moved` = frase compartida con página cambiada): rank-AUC material vs
  no material **0,23** (invertido); format-only 3/5. Incoherencia interna
  reveladora: para `material-change`, doc-level dice "sigue contenida"
  (0,48–0,99) mientras page-level da 0,04–0,18 incluso a frases presentes
  verbatim en `moved` (0,044).
- **U3 intención de consulta**: accuracy **0,20** (< mayoría 0,53) con
  colapso de clase: predice `unanswerable` en 30/30 (recall unanswerable
  1,0 hueco). El smoke EN/ES sí acertó en su dominio (tickets soporte).
- **Smoke / parity**: primer uso 9,4 s (carga), ~0,14 s/decisión; EN/ES
  correctos, DE ambiguo contra mi etiqueta de humo (anotado). El spike
  Node/ONNX reproduce las probabilidades Python **exactamente**
  (0.0245/0.0073/0.0006).

## Criteria check

| # | Criterio | Resultado | Veredicto |
| --- | --- | --- | --- |
| 1 | U1 recall@1 ≥ 0,8 y page-AUROC ≥ 0,85 | 0,125 / 0,5206 | **FALLA** |
| 2 | U1 unanswerable limpio ≥ 5/6 | 0/6 | **FALLA** |
| 3 | U2 AUC ≥ 0,85 y format-only ≥ 4/5 | 0,23 / 3/5 | **FALLA** |
| 4 | U3 accuracy ≥ 0,8 y unans recall ≥ 4/6 | 0,20 / 6/6 (degenerado) | **FALLA** |
| 5 | U1 < 15 min CPU, p95 < 2 s batched | 308,7 s total; 0,146 s/dec | PASA |
| 6 | Encaje como HINTs (chequeo de diseño) | mecánicamente viable (spike) | PASA (irrelevante sin calidad) |

## Decisión

**NO ADOPTAR laya zero-shot** en ninguna de las tres superficies
(hint de matriz, priorización de propuestas, router de intención).
El motor de decisiones no generaliza zero-shot a las decisiones de
investigación de note-lm; coincide con lo que el propio upstream declara:
0,362 zero-shot vs 0,766 fine-tuned en SU benchmark tipado.

Consecuencias (según criteria.md "If criteria fail"):

- No se cablea el hint de matriz; la priorización de propuestas sigue
  siendo determinista (categoría/tiempo); el routing de estrategia sigue
  basado en reglas (§6).
- Se conservan harness, corpus hookup, criterios y resultados como
  evidencia (mismo trato que PI-0..PI-2).
- Única ruta futura razonable: **fine-tuning con decisiones propias**
  (upstream provee notebook RLCD + calibración), con criterios nuevos
  registrados ANTES, dataset etiquetado desde la matriz de evidencia real,
  y presupuesto GPU. Requiere inversión de entrenamiento; no bloquea I1→I2.

## Engine-path: la vía de inferencia FUNCIONA (hallazgo reutilizable)

Probado punta a punta sin Python en inferencia:

- Export split ONNX (encoder 1,23 GB fp32 + head 60 MB + tokenizer 34 MB
  + rl_agent_config 472 B) en 61 s, verificación torch↔ONNX ≤ 2,1e-06
  en 3 longitudes de secuencia. Presupuesto: fp32 = 2× safetensors; el
  export INT8 per-channel existe upstream (a evaluar si se revisitara).
- Spike Node (`spike/spike.mjs`): `Agent.load` local 1,5 s,
  `onnxruntime-node` 1.30.0, ~140 ms/decisión CPU, paridad exacta con
  Python; hay que fijar `{ model: "multilingual" }` o el Router intenta
  auto-descargar el checkpoint por defecto del hub.
- Roce de integración: el paquete `laya-ts` no declara `@types/node`
  (no compila sin añadirlo) y no publica `dist/` ni paquete npm oficial
  (`laya-ts` en el registro = 404; los paquetes `laya-*` de npm NO son
  oficiales). La adopción pasaría por vendorizar la fuente Apache-2.0
  con commit pineado.

## Metodología

Corpus real del proyecto: `eval/fusion-proto/corpus` (30 preguntas × 12
documentos × 5 páginas = 1.800 decisiones página-nivel + 144 doc-level
dev con `max_len=8192`), `eval/corpus/version-pairs-v1` (20 pares v1→v2
con materialidad por construcción) e intención (choice 3 clases).
Batching real (`Router.predict_batch`, `sort_by_length`), un solo
checkpoint, sin fine-tuning. Reproducción completa en [README.md](README.md).
