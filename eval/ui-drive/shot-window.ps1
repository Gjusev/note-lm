# Capture the note-lm desktop window (surface A evidence): DPI-aware
# CopyFromScreen of the notelm-spike main window rect.
# Usage: powershell -File shot-window.ps1 -OutFile <abs png path>
param([Parameter(Mandatory)][string]$OutFile)

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
}
"@
[Win]::SetProcessDPIAware() | Out-Null

# wait up to 10 s for a window handle belonging to our process
$h = [IntPtr]::Zero
for ($i = 0; $i -lt 100; $i++) {
  $h = (Get-Process -Name notelm-spike -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1).MainWindowHandle
  if ($h -ne [IntPtr]::Zero) { break }
  Start-Sleep -Milliseconds 100
}
if ($h -eq [IntPtr]::Zero) { throw "no notelm-spike window handle" }
[Win]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 800

$r = New-Object Win+RECT
[Win]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.R - $r.L
$ht = $r.B - $r.T
if ($w -le 0 -or $ht -le 0) { throw "empty window rect $($r.L),$($r.T),$($r.R),$($r.B)" }
$bmp = New-Object System.Drawing.Bitmap($w, $ht)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
$bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "saved=$OutFile size=${w}x${ht} at=$($r.L),$($r.T)"
