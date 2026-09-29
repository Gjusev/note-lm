# Deterministic TTS reference samples for the local ASR WER harness (T2).
# Windows SAPI (System.Speech) renders fixed literal texts with the voices
# installed by default on Windows (de-DE: Microsoft Hedda Desktop, en-US:
# Microsoft Zira Desktop) into 16 kHz / 16 bit / mono WAVs. The exact text
# files next to each WAV are the reference transcripts the harness scores
# against. SAPI output is deterministic per voice, so re-running the script
# reproduces the same audio on the same Windows build.
#
# NOTE: this file must stay UTF-8 WITH BOM (PowerShell 5.1 reads BOM-less
# scripts as ANSI and would mangle the German umlauts).
#
# Run:  powershell -NoProfile -ExecutionPolicy Bypass -File generate-samples.ps1
# Out:  samples/<name>.wav + samples/<name>.txt (plus the ~10 s desktop
#       walkthrough sample under src-tauri/resources/samples/).

Add-Type -AssemblyName System.Speech

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$outDir = Join-Path $here "samples"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$deVoice = "Microsoft Hedda Desktop"   # de-DE, default on German Windows
$enVoice = "Microsoft Zira Desktop"    # en-US, default on Windows

# Reference texts. Numbers are written as digits on purpose: SAPI reads them
# naturally and whisper typically transcribes digits, so normalization stays
# comparable. Every text is 35-45 words (~15-25 s of speech).
$samples = @(
  @{
    name  = "de-wirtschaft"
    voice = $deVoice
    text  = "Der Zwischenbericht zur Kaffeestudie liegt dem Ausschuss seit Montag vor. An der Untersuchung nahmen 240 freiwillige Teilnehmende teil, die über acht Wochen beobachtet wurden. Die Gruppe mit täglichem Filterkaffee zeigte am Vormittag eine deutlich längere Konzentration. Der Abschlussbericht umfasst vierzig Seiten und erscheint im März."
  },
  @{
    name  = "en-briefing"
    voice = $enVoice
    text  = "Good morning, this is the weekly research briefing. The transcription study compared two local speech models on the same audio material. Both models ran entirely on this computer without any cloud connection. The final report with all measurements will be published next week."
  },
  @{
    name  = "de-zahlen"
    voice = $deVoice
    text  = "Der Zinssatz steigt im Jahr 2026 um 0,5 Prozent auf 3,75 Prozent. Die Abteilung beschäftigt 128 Mitarbeitende in 4 Teams. Das Budget beträgt 1,2 Millionen Euro, verteilt über 3 Quartale. Bis zum 15. März sind 500 Datensätze zu prüfen."
  },
  @{
    # Short (~10 s) German sample bundled with the installer: the desktop
    # audio walkthrough gate drives the installed engine over this file.
    name  = "notelm-audio-de"
    voice = $deVoice
    out   = "..\..\src-tauri\resources\samples"
    text  = "Willkommen bei note-lm. Dieses Beispielnotizbuch zeigt, wie eine Sprachaufnahme lokal auf diesem Computer transkribiert wird. Alle Daten bleiben auf Ihrem Gerät."
  }
)

foreach ($s in $samples) {
  $targetDir = $outDir
  if ($s.out) {
    $targetDir = (New-Item -ItemType Directory -Force -Path (Join-Path $here $s.out)).FullName
  }
  $wav = Join-Path $targetDir "$($s.name).wav"

  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.SelectVoice($s.voice)
  $synth.Rate = 0
  $fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo -ArgumentList `
    16000, ([System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen), ([System.Speech.AudioFormat.AudioChannel]::Mono)
  $synth.SetOutputToWaveFile($wav, $fmt)
  $synth.Speak($s.text)
  $synth.SetOutputToNull()
  $synth.Dispose()

  # Reference transcript: the EXACT text spoken (what a perfect transcription
  # would produce up to punctuation/number formatting).
  [System.IO.File]::WriteAllText((Join-Path $targetDir "$($s.name).txt"), $s.text, [System.Text.Encoding]::UTF8)

  $bytes = (Get-Item $wav).Length
  $seconds = [math]::Round(($bytes - 44) / 32000, 1)   # 16000 Hz * 2 bytes mono
  "{0} -> {1} ({2} s)" -f $s.name, $wav, $seconds
}
