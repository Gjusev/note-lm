# WER harness (T2): local whisper.cpp over synthetic TTS references

Generated: 2026-09-29T11:43:07.568Z · whisper.cpp v1.9.2 (pinned, CPU) · samples: eval/audio-proto/samples (SAPI TTS, 16 kHz mono, deterministic per voice)

> **Ceiling note (read before quoting these numbers):** the references are
> synthetic Windows SAPI speech - a single clean studio voice, no room noise,
> no real human prosody. WER on TTS flatters the models (upper-bound
> estimate); real microphone speech will score worse. The harness measures
> runtime mechanics (wall time, timestamp span, number handling) more than
> acoustic robustness. Timestamps deviation compares whisper's reported
> segment span with the true wav duration from the RIFF header.

## ggml-tiny (74.1 MB)

| Sample | Lang | Ref words | WER % | Ref dur s | Whisper span s | Deviation s | Wall s |
|---|---|---:|---:|---:|---:|---:|---:|
| de-wirtschaft | de | 45 | 26.7 | 23.8 | 23.7 | -0.1 | 1.2 |
| de-zahlen | de | 42 | 16.7 | 24.8 | 24.7 | 0 | 1.2 |
| en-briefing | en | 43 | 0 | 18 | 17.7 | -0.3 | 0.9 |

Average WER: **14.5%** · average timestamp deviation: **-0.1 s** · model sha256: `be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21`

## ggml-base (141.1 MB)

| Sample | Lang | Ref words | WER % | Ref dur s | Whisper span s | Deviation s | Wall s |
|---|---|---:|---:|---:|---:|---:|---:|
| de-wirtschaft | de | 45 | 24.4 | 23.8 | 22.9 | -0.8 | 2 |
| de-zahlen | de | 42 | 14.3 | 24.8 | 24 | -0.8 | 1.7 |
| en-briefing | en | 43 | 0 | 18 | 17.3 | -0.7 | 1.6 |

Average WER: **12.9%** · average timestamp deviation: **-0.8 s** · model sha256: `60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe`

## Hypotheses (raw whisper output)

- **ggml-tiny / de-wirtschaft** (de): Der Zwischenbericht zur Café studiert liegt im Ausschuss seit Montag vor. An der Untersuchung nahmen 240 freiwillige Teil nimmende Teil, die über acht Wochen beobachtet wurden. Die Gruppe mit täglichem Filter Café zeigt er am Vormittag eine deutlich längere Konzentration. Der Abschlussbericht um fast 40 Seiten und erscheint im März.
- **ggml-tiny / de-zahlen** (de): Der Zinsatz steigt im Jahr 2020 um 0,5 Prozent auf 3,75 Prozent. Die Abteilung beschäftigt 128 mit Arbeiten der Infiatives. Das Budget beträgt 1,2 Millionen Euro, verteilt über 3 Wattale. Bis zum 15. März sind 500 Datensätze zu prüfen.
- **ggml-tiny / en-briefing** (en): Good morning, this is the weekly research briefing. The transcription study compared two local speech models on the same audio material. Both models ran entirely on this computer without any cloud connection. The final report with all measurements will be published next week.
- **ggml-base / de-wirtschaft** (de): Der Zwischenbericht zur Café-Studie liegt im Ausschussseit Montag vor. An der Untersuchung nahmen 240 freiwillige Teilnimmende Teil, die über 8 Wochen beobachtet wurden. Die Gruppe mit täglichem Filtercafé zeigt er am Vormittag eine deutlich längere Konzentration. Der Abschlussbericht umfasst 40 Seiten und erscheint im März.
- **ggml-base / de-zahlen** (de): Der Zinssatz steigt im Jahr 2006 und 20 um 0,5 Prozent auf 3,75 Prozent. Die Abteilung beschäftigt 128 Mitarbeiter in vier Teams. Das Budget beträgt 1,2 Millionen Euro, verteilt über drei Quartale. Bis zum 15. März sind 500 Datensätze zu prüfen.
- **ggml-base / en-briefing** (en): Good morning, this is the weekly research briefing. The transcription study compared two local speech models on the same audio material. Both models ran entirely on this computer without any cloud connection. The final report with all measurements will be published next week.
