# T2-v2: whisper.cpp over NATURAL redistributable human speech (de/es/en)

Generated: 2026-09-29T12:48:39.095Z · whisper.cpp v1.9.2 (pinned, CPU) · hardware: AMD Ryzen 5 7600X 6-Core Processor, 12 cores (same machine as T2) · corpus: eval/audio-proto-v2 (audio-orig/ + transcripts/ + licenses.json)

T2 (eval/audio-proto/wer-report.md) measured whisper.cpp over synthetic Windows SAPI
TTS and honestly documented that ceiling: one clean studio-style voice, no human
prosody, no room noise, no accents. This extension measures the same pinned engine
(ggml-tiny + ggml-base, CPU) over REAL human speech that is fully redistributable:
9 clips, 3 per language (de/es/en), single poems read start to finish by volunteers and
released under CC0 / CC BY-SA 3.0 / CC BY-SA 4.0, with verbatim public-domain
reference texts taken from Wikisource. ES had no T2 baseline (SAPI corpus was de/en).

## Annotation validity (mandate: real temporal annotations)

Every natural clip is ONE complete utterance: a single poem read start to finish,
converted deterministically to 16 kHz mono wav (ffmpeg, `wav/` cache) with leading/
trailing silence trimmed (silenceremove, -38 dB, 0.15 s boundary kept) so the wav
duration IS the ground-truth span of the spoken utterance. The annotation
[0, duration] is therefore a real annotation of that span - not the
file-duration-vs-multi-sentence-span confound the mandate warns about. Multi-sentence
clips without per-sentence timing were rejected at selection time for exactly that
reason (e.g. the Commons 'Poems Every Child' files bundle several poems per file and
were excluded; the LibriVox 'Short Poetry Collection' per-poem files prepend spoken
title/author announcements and were excluded for the same reason). Timestamp
precision is therefore scored on BOTH edges: whisper's first-segment start vs 0, and
last-segment end vs the annotated duration.

## ggml-tiny (74.1 MB, sha256 `be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21`) - condition: natural human speech

| Clip | Lang | Ref words | WER % | Anno [start,end] s | Whisper [start,end] s | Start dev s | End dev s | Wall s |
|---|---|---:|---:|---|---|---:|---:|---:|
| de-purzelbaum | de | 113 | 24.8 | [0, 57.5] | [0, 57.5] | 0 | 0 | 3.9 |
| de-landregen | de | 82 | 34.1 | [0, 52] | [0, 52] | 0 | 0 | 2.4 |
| de-flugzeug | de | 90 | 22.2 | [0, 44.6] | [0, 44] | 0 | -0.5 | 2.7 |
| es-rima30 | es | 65 | 26.2 | [0, 25.8] | [0, 25.5] | 0 | -0.3 | 1.9 |
| es-luna | es | 68 | 19.1 | [0, 38.4] | [0, 37.2] | 0 | -1.2 | 2.1 |
| es-cogida | es | 339 | 10.6 | [0, 103.7] | [0, 104] | 0 | 0.3 | 6.8 |
| en-elephant | en | 23 | 4.3 | [0, 9.5] | [0, 9.6] | 0 | 0.1 | 0.7 |
| en-hippopotamus | en | 22 | 54.5 | [0, 7.1] | [0, 7] | 0 | 0 | 0.8 |
| en-dodo | en | 49 | 18.4 | [0, 17] | [0, 16.9] | 0 | -0.1 | 1.1 |

Average WER: **23.8%** · mean |start dev|: **0 s** · mean |end dev|: **0.3 s**

### ggml-tiny - condition: tts-sapi (T2 samples re-run read-only, same session)

| Clip | Lang | Ref words | WER % | Anno [start,end] s | Whisper [start,end] s | Start dev s | End dev s | Wall s |
|---|---|---:|---:|---|---|---:|---:|---:|
| de-wirtschaft | de | 45 | 26.7 | [0, 23.8] | [0, 23.7] | 0 | -0.1 | 1.3 |
| de-zahlen | de | 42 | 16.7 | [0, 24.8] | [0, 24.7] | 0 | 0 | 1.1 |
| en-briefing | en | 43 | 0 | [0, 18] | [0, 17.7] | 0 | -0.3 | 1 |

Average WER: **14.5%** · mean |start dev|: **0 s** · mean |end dev|: **0.1 s**

## ggml-base (141.1 MB, sha256 `60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe`) - condition: natural human speech

| Clip | Lang | Ref words | WER % | Anno [start,end] s | Whisper [start,end] s | Start dev s | End dev s | Wall s |
|---|---|---:|---:|---|---|---:|---:|---:|
| de-purzelbaum | de | 113 | 17.7 | [0, 57.5] | [0, 57.3] | 0 | -0.2 | 5.6 |
| de-landregen | de | 82 | 15.9 | [0, 52] | [0, 52.1] | 0 | 0.1 | 5.3 |
| de-flugzeug | de | 90 | 12.2 | [0, 44.6] | [0, 44] | 0 | -0.6 | 5 |
| es-rima30 | es | 65 | 18.5 | [0, 25.8] | [0, 25.5] | 0 | -0.3 | 3.2 |
| es-luna | es | 68 | 13.2 | [0, 38.4] | [0, 36] | 0 | -2.4 | 3.6 |
| es-cogida | es | 339 | 18.3 | [0, 103.7] | [0, 103.6] | 0 | -0.1 | 15.2 |
| en-elephant | en | 23 | 4.3 | [0, 9.5] | [0, 9.5] | 0 | 0 | 1.9 |
| en-hippopotamus | en | 22 | 40.9 | [0, 7.1] | [0, 7] | 0 | 0 | 2.3 |
| en-dodo | en | 49 | 12.2 | [0, 17] | [0, 16.9] | 0 | -0.1 | 3.3 |

Average WER: **17.0%** · mean |start dev|: **0 s** · mean |end dev|: **0.4 s**

### ggml-base - condition: tts-sapi (T2 samples re-run read-only, same session)

| Clip | Lang | Ref words | WER % | Anno [start,end] s | Whisper [start,end] s | Start dev s | End dev s | Wall s |
|---|---|---:|---:|---|---|---:|---:|---:|
| de-wirtschaft | de | 45 | 24.4 | [0, 23.8] | [0, 22.9] | 0 | -0.8 | 2.7 |
| de-zahlen | de | 42 | 14.3 | [0, 24.8] | [0, 24] | 0 | -0.8 | 2.3 |
| en-briefing | en | 43 | 0 | [0, 18] | [0, 17.3] | 0 | -0.7 | 1.9 |

Average WER: **12.9%** · mean |start dev|: **0 s** · mean |end dev|: **0.8 s**

## Comparison vs the published T2 SAPI baseline (cited, not re-run)

T2 published (eval/audio-proto/wer-report.md, same pinned builds): ggml-tiny average
WER **14.5%**, mean timestamp deviation -0.1 s;
ggml-base average WER **12.9%**, mean timestamp deviation -0.8 s
(de/en only, SAPI TTS references). The tts-sapi tables above are a fresh read-only
re-run of the same sample files on this machine for within-report comparability;
small wall-time and WER deltas vs the published numbers are run-to-run variance of
the same setup, not a different configuration.

## Per-language summary (natural condition)

| Lang | tiny WER % (per clip) | base WER % (per clip) |
|---|---|---|
| de | de-purzelbaum: 24.8, de-landregen: 34.1, de-flugzeug: 22.2 | de-purzelbaum: 17.7, de-landregen: 15.9, de-flugzeug: 12.2 |
| es | es-rima30: 26.2, es-luna: 19.1, es-cogida: 10.6 | es-rima30: 18.5, es-luna: 13.2, es-cogida: 18.3 |
| en | en-elephant: 4.3, en-hippopotamus: 54.5, en-dodo: 18.4 | en-elephant: 4.3, en-hippopotamus: 40.9, en-dodo: 12.2 |

## Redistributability + license list (exact license + source URL per clip)

| Clip | Lang | Audio license (recorder) | Text (author, license) | Audio source | Text source |
|---|---|---|---|---|---|
| de-purzelbaum | de | CC BY-SA 4.0 (Frank Dittmer) | Christian Morgenstern (d. 1914), Public domain | https://commons.wikimedia.org/wiki/File:DE-Morgenstern_Der_Purzelbaum-wikisource.ogg | text: https://de.wikisource.org/wiki/Der_Purzelbaum |
| de-landregen | de | CC0 1.0 (Juliane Flade) | Joachim Ringelnatz (d. 1934), Public domain | https://commons.wikimedia.org/wiki/File:De-Landregen-wikisource.ogg | text: https://de.wikisource.org/wiki/Landregen |
| de-flugzeug | de | CC BY-SA 4.0 (Juliane Flade) | Joachim Ringelnatz (d. 1934), Public domain | https://commons.wikimedia.org/wiki/File:De-Flugzeuge_am_Winterhimmel-Wikisource.ogg | text: https://de.wikisource.org/wiki/Flugzeug_am_Winterhimmel |
| es-rima30 | es | CC BY-SA 4.0 (Benjamín Núñez González) | Gustavo Adolfo Bécquer (d. 1870), Public domain | https://commons.wikimedia.org/wiki/File:Gustavo_Adolfo_B%C3%A9cquer,_Rima_XXX,_Madrid,_2016.ogg | text: https://es.wikisource.org/wiki/Rimas_(B%C3%A9cquer,_1885)/Rima_XXX |
| es-luna | es | CC BY-SA 4.0 (Voiceover77) | Federico García Lorca (d. 1936), Public domain (Spain, since 2017) | https://commons.wikimedia.org/wiki/File:Lorca_la_luna_asoma.ogg | text: https://es.wikisource.org/wiki/La_luna_asoma |
| es-cogida | es | CC BY-SA 4.0 (Benjamín Núñez González) | Federico García Lorca (d. 1936), Public domain (Spain, since 2017) | https://commons.wikimedia.org/wiki/File:La_cogida_y_la_muerte,_2016.ogg | text: https://es.wikisource.org/wiki/Llanto_por_Ignacio_S%C3%A1nchez_Mej%C3%ADas |
| en-elephant | en | CC BY-SA 3.0 (Theornamentalist) | Hilaire Belloc (d. 1953), Public domain (1896 US publication; PD in EU since 2024) | https://commons.wikimedia.org/wiki/File:The_Bad_Childs_Book_of_Beasts_The_Elephant.ogg | text: https://en.wikisource.org/wiki/The_Bad_Child%27s_Book_Of_Beasts/The_Elephant |
| en-hippopotamus | en | CC BY-SA 3.0 (Theornamentalist) | Hilaire Belloc (d. 1953), Public domain (1896 US publication; PD in EU since 2024) | https://commons.wikimedia.org/wiki/File:The_Bad_Childs_Book_of_Beasts_The_Hippopotamus.ogg | text: https://en.wikisource.org/wiki/The_Bad_Child%27s_Book_Of_Beasts/The_Hippopotamus |
| en-dodo | en | CC BY-SA 3.0 (Theornamentalist) | Hilaire Belloc (d. 1953), Public domain (1896 US publication; PD in EU since 2024) | https://commons.wikimedia.org/wiki/File:The_Bad_Child%27s_Book_Of_Beasts_The_Dodo.ogg | text: https://en.wikisource.org/wiki/The_Bad_Child%27s_Book_Of_Beasts/The_Dodo |

All 9 originals (6.9 MB total) ship in `audio-orig/` with sha256 recorded in licenses.json;
transcripts in `transcripts/` are verbatim from the listed Wikisource pages except the
orthographic-only modernizations recorded per clip in licenses.json (`transcriptNotes`)
(e.g. 1885 Spanish 'á'->'a', German 'laß'->'lass' - identical when spoken, so they add
no WER penalty). CC BY-SA clips require attribution + share-alike when redistributed;
attribution strings are the table rows above and licenses.json.

## Transcript integrity notes

- Reference transcripts INCLUDE the readers' spoken opening announcements
  (title/author/reader credits, 4-12 words per clip; the English clips have none).
  German announcement wording follows the documented de.wikisource 'Gesprochene
  Wikisource' formula; the shorter Spanish intros were pinned by base-model
  alignment, so errors on those few announcement words are slightly understated.

## Limitations (what natural-speech conditions remain unmeasured)

- Read poetry, not conversational speech: no disfluencies, self-corrections or
  overlapping speakers; all clips are single monologue read-aloud speech.
- Clean recordings: no additive noise, reverb-heavy rooms, or far-field microphones.
- Accents: readers are standard-variety (Hochdeutsch, Castilian Spanish, general
  American/British English); no regional or non-native accents in the corpus.
- Poetry prosody (verse rhythm, emphatic stresses) is itself atypical of note-taking
  voice memos; natural conversational prosody is still unmeasured.
- 3 clips per language but few distinct readers: 2 German (Flade, Dittmer), 2 Spanish
  (Núñez González, Voiceover77) and just 1 English (Theornamentalist, all three clips);
  speaker diversity is minimal and inter-reader variance is confounded with language.
- One es clip (es-luna) comes from a web-poetry series that sometimes mixes music;
  its per-clip WER is the honest signal of any such artefact.

## Hypotheses (raw whisper output, natural condition)

- **ggml-tiny / de-purzelbaum** (de): Sie hören, der Puzzlebaum, von Christian Morgenstern, gesprochen von Frank Dittmann für das deutschsprache Gewicisausprojekt. "Ein Puzzlebaum trat vor mich hin und sagte, du nur siehst mich und weißt, was für ein Baum ich bin. Ich schieße nicht, man schießt mich und trag ich froh, ich glaube kaum, auch bin ich nicht verwurzelt. Ich bin nur noch ein Puzzle-Traum, sobald ich hin gepurzelt." "Jennun, so schwach ich messter Schatz, du bist doch klug und siehst uns nun auch für uns bestät der Satz, wie es schießt, nicht es schießt, uns auch wurzeln treibt, man nicht sobald und früchte, nun es trecht nicht." Geheim in deinem Puzzle-Walt und lästere dein Geschlecht nicht.
- **ggml-tiny / de-landregen** (de): Landregeln von Joachim Ringel-Naz, gesprochen von Juliane Flade, für das deutschsprache Wiegissursprojekt. Der Regenraust, der Regenraust schon seit Tagen immer zu und Käferchen er trinken, im Schlammren an den Wegen. Der Wald hat Ru, gelabt Tippletter, Linken, im Regenrauschenschweigen alle Fügel und zeigen sich nicht. Es rauscht ur ewige Musik und der noch sucht mein Blick ein Streifchen, helles Licht, fast schämen ich mich zu sagen, ich sehene mich nach etwas Staub. Ich kann das schwere, kalte Laub nicht länger mehr ertragen.
- **ggml-tiny / de-flugzeug** (de): flugzeug am Winterhimmel. Ich fliege im Flokkengewimmel, Ach Godahimmel, lasst das doch sein. Ich flug Riese bin nur klein für Genein, Gigendich schüttern der Himmel. Sag Schnee gestöber, ich Bete es sehr, ein wenig nachzulassen, denn meine Flügel tragen schon schwer, an sechs ganz dicken Innen sassen, die Spielen Karten in meinem Leib und trinken, weil sie so frieren. Und wollen nach Zoppot und Zeitvertreib und örtliches zu studieren. Und Kerme, ich dort nicht pünktlich hin, die würden es niemals verzeihen. Lieber Himmel, wenn ich gelandet bin, dann lasst du gern wieder schneiden.
- **ggml-tiny / es-rima30** (es): Pues sí, debe que, rima 30. Asomaba a sus ojos una lágrima y a mi labio una frase de perdón, hablo de orgullo ese en jugo su llanto y la frase en mis labios expiro. Yo voy por un camino, ella, por otro. Pero, al pensar en nuestro muto amor, yo digo aún, ¿por qué calle a el día y ya dirá, ¿por qué no yo rello?
- **ggml-tiny / es-luna** (es): de Federico García Lorca, la Luna Soma, cuando sale la Luna se pierde en las campanas y aparecen las sendas impenetrables, cuando sale la Luna el mar cubre la tierra y el corazón se siente, isla en el infinito, nadie conme en las bajas bajo la Luna llene, es preciso comer fruta verde y elada, cuando sale la Luna, defien rostros iguales, la moneda de plata, soyosa en el bolsido
- **ggml-tiny / es-cogida** (es): La cojida y la muerte, Federico García Lorca. A las cinco de la tarde, eran las cinco en punto de la tarde. Un niño trajo la blancazaban a las cinco de la tarde. Una expuesta de calya prevenida a las cinco de la tarde. Lo demás era muerte, sólo muerte, las cinco de la tarde. El viento se llevó los algodones a las cinco de la tarde. Y el oxido se emberó cristalini que en la las cinco de la tarde. Ya luchan la paloma y el leopardo a las cinco de la tarde. Y un muslo con una hasta desolada a las cinco de la tarde. Comenzaron los sones de bordona a las cinco de la tarde. Las campanas de arcenico y el humo a las cinco de la tarde. En las esquinas, grupos de silencio a las cinco de la tarde. Y el toro sólo corazón arriba a las cinco de la tarde. Cuando el sudor de nieve fue llegando a las cinco de la tarde. Cuando la plaza se cubrió de llodo a las cinco de la tarde. La muerte puso huevos en la herida a las cinco de la tarde. A las cinco de la tarde. A las cinco en punto de la tarde. Una taud con ruedas es la cama a las cinco de la tarde. O esos y flautas suenan en su oído a las cinco de la tarde. El toro ya mujía por su frente a las cinco de la tarde. El cuarto se irisaba de agonía a las cinco de la tarde. A lo lejos ya viene la gangrena a las cinco de la tarde. Trompa delirio por las verdes inglés a las cinco de la tarde. Las heridas que mavan como soles a las cinco de la tarde. Y el gentillo rompía a las ventanas a las cinco de la tarde. A las cinco de la tarde. Hay que terribles cinco de la tarde. Eran las cinco en todos los rojes. Eran las cinco en sombra de la tarde.
- **ggml-tiny / en-elephant** (en): When people call this beast to mind, they marvel more and more. At such a little tale behind, so large a trunk before.
- **ggml-tiny / en-hippopotamus** (en): I shoot the hippo part of this with boards made of platinum, because if I use lead and once, his hide is short of platinum.
- **ggml-tiny / en-dodo** (en): The Dodo used to walk around and take the sun and hair. The Sonia Worms is native ground. The Dodo was not there. The voice which used to squawk in squeak is now forever dumb. Yet may you see his bones and beak all in the museum.
- **ggml-base / de-purzelbaum** (de): Sie hören, der Puzzlebaum, von Christian Morgenstern, gesprochen von Frank Dittmer für das Deutschsprache Gewigi-Saus-Projekt. Ein Puzzlebaum trat vor mich hin, und sagte, "Du nur siehst mich, und weißt, was für ein Baum ich bin, ich schieße nicht, man schießt mich, und trage ich Frucht, ich glaube kaum, auch bin ich nicht verwurzelt, ich bin nur noch ein Puzzle Traum, sobald ich ihn gepurzelt." "Jeh nun, so sprach ich Bester Schatz, du bist doch klug, und siehst uns nun auch für uns besteht der Satz, wie ich schieße nicht, es schießt uns, auch Wurzeln treibt man nicht sobald und Früchte, nun erst recht nicht, geheim in deinen Puzzlewald und lässt Dein Geschlecht nicht.
- **ggml-base / de-landregen** (de): Landrägen von Joachim Ringelnatz, gesprochen von Juliane Flade, für das deutschsprachige Vigisursprojekt. Der Regen rauscht, der Regen rauscht, schon seit Tagen immer zu und Käferchen ertrinken, im Schlammren an den Wegen. Der Wald hat ho, gelabtippletter, blinken, im Regen rauschen, schweigen alle Vögel und zeigen sich nicht. Es rauscht, ure-ewege Musik, und dennoch sucht mein Blick, ein streifchen, helles Licht. Fast schäm ich mich, zu sagen, ich sehne mich nach etwas Staub. Ich kann das schwere, kalte Laub nicht länger mehr ertragen.
- **ggml-base / de-flugzeug** (de): Flugzeug am Winterhimmel. Ich fliege im Flokkengewimmel, ach guter Himmel, lasst das doch sein. Ich Flugrise bin nur klein fürgelein, gegen dich schütender Himmel. Sag, Schnee gestöber, ich belte es sehr, ein wenig nachzulassen, denn meine Flügel tragen schon schwer, an sechs ganz dicken Innensassen, die spielen Karten in meinem Leib, und trinken weil sie so frieren und wollen nach Zuppott um Zeitvertreib und örtliches zu studieren. Und käme ich dort nicht pünktlich hin, die würden es niemals verzeihen. Lieber Himmel, wenn ich gelandet bin, dann dachst du gern wieder schneien.
- **ggml-base / es-rima30** (es): Poesía de bequer, Rima 30, Asomaba a sus ojos una lágrima, y a mi labio una frase de perdón, Hablo del orgullo es en jugo su llanto, y la frase en mis labios expiro, "Yo voy por un camino, ella, por otro, pero, al pensar en nuestro muto amor, yo digo aún, ¿por qué que calle aquel día y ya dirá, ¿por qué no llore yo?
- **ggml-base / es-luna** (es): De Federico García Lorca, la Luna Soma, cuando sale la Luna, se pierden las campanas y aparecen las endas impenetrables, cuando sale la Luna el mar cubre la tierra y el corazón se siente isla en el infinito. Nadie conmen la haja, bajo la Luna llena es preciso comer fruta verde y helada, cuando sale la Luna de 100 rostros iguales, la monida de plata soy oza en el bolsillo.
- **ggml-base / es-cogida** (es): La cojide y la muerte, Federico García Lorca. A las 5 de la tarde, eran las 5 en punto de la tarde. Un niño trajo la blanca sábana a las 5 de la tarde. Una es puerta de calya prevenida a las 5 de la tarde. Lo demás era muerte y sólo muerte a las 5 de la tarde. El viento se llevó los algodones a las 5 de la tarde. Y el oxido se embró cristal y nique a las 5 de la tarde. Ya luchan la paloma y el leopardo a las 5 de la tarde. Y un músculo con una hasta desolada a las 5 de la tarde. Comenzaron los sones de bordona a las 5 de la tarde. Las campanas de arsenico y el humo a las 5 de la tarde. En las esquinas grupos de silencio a las 5 de la tarde. Y el toro sólo corazó en arriba a las 5 de la tarde. Cuando el sudor de nieve fue llegando a las 5 de la tarde. Cuando la plaza se cubrió de llodo a las 5 de la tarde. La muerte puso huevos en la herida a las 5 de la tarde. A las 5 de la tarde. A las 5 en punto de la tarde. Una taud con ruedas es la cama a las 5 de la tarde. O esos y flautas suenan en su oído a las 5 de la tarde. El toro ya muría por su frente a las 5 de la tarde. El cuarto se irizaba de agonía a las 5 de la tarde. A lo lejos ya viene la gangrena a las 5 de la tarde. Trompa del hirio por las verdes ingles a las 5 de la tarde. Las heridas que mamaban como soles, a las 5 de la tarde. Y el gentío rompía a las ventanas, a las 5 de la tarde, a las 5 de la tarde. Hay que terribles 5 de la tarde. Eran las 5 en todos los lojes. Eran las 5 en sombra de la tarde.
- **ggml-base / en-elephant** (en): When people call this beast to mind, they marvel more and more. At such a little tale behind, so large a trunk before.
- **ggml-base / en-hippopotamus** (en): I shoot the hippopotamus with boards made of platinum, because if I use leaden once, it's high to show the platinum.
- **ggml-base / en-dodo** (en): The dodo used to walk around and take the sun in the air. The sun yet warms his native ground. The dodo is not there. The voice which used to squawk and squeak is now forever dumb. Yet may you see his bones in peak all in the museum.
