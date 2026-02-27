[CmdletBinding()]
param(
  [ValidateSet('medium', 'high', 'extreme')]
  [string]$Profile = 'high',
  [int]$DurationSeconds = 30,
  [int]$LinesPerSecond,
  [int]$LineLength,
  [int]$Seed = 20260227,
  [string]$Tag = 'terminal-bench'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-ProfileDefaults {
  param([string]$Name)

  switch ($Name) {
    'medium' { return @{ LinesPerSecond = 120; LineLength = 96 } }
    'high' { return @{ LinesPerSecond = 300; LineLength = 128 } }
    'extreme' { return @{ LinesPerSecond = 600; LineLength = 160 } }
    default { throw "Unknown profile: $Name" }
  }
}

function New-Payload {
  param(
    [int]$Length,
    [int]$SeedValue
  )

  $alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789[]{}()<>+-=_/*#@$%:;,.?'
  $random = [System.Random]::new($SeedValue)
  $chars = New-Object char[] $Length
  for ($i = 0; $i -lt $Length; $i++) {
    $chars[$i] = $alphabet[$random.Next(0, $alphabet.Length)]
  }
  return -join $chars
}

$defaults = Get-ProfileDefaults -Name $Profile
if (-not $PSBoundParameters.ContainsKey('LinesPerSecond')) {
  $LinesPerSecond = $defaults.LinesPerSecond
}
if (-not $PSBoundParameters.ContainsKey('LineLength')) {
  $LineLength = $defaults.LineLength
}

if ($DurationSeconds -le 0) { throw 'DurationSeconds must be > 0' }
if ($LinesPerSecond -le 0) { throw 'LinesPerSecond must be > 0' }
if ($LineLength -le 16) { throw 'LineLength should be > 16' }

$payload = New-Payload -Length $LineLength -SeedValue $Seed
$totalTargetLines = $DurationSeconds * $LinesPerSecond
$intervalMs = [Math]::Max(1, [Math]::Floor(1000 / $LinesPerSecond))

# Start metadata for benchmark tracking.
$header = @{
  kind = 'terminal-bench-start'
  timestamp = (Get-Date).ToString('o')
  tag = $Tag
  profile = $Profile
  durationSeconds = $DurationSeconds
  linesPerSecond = $LinesPerSecond
  lineLength = $LineLength
  targetTotalLines = $totalTargetLines
  approxCharsPerSecond = ($LinesPerSecond * $LineLength)
}
$header | ConvertTo-Json -Compress

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$line = 0
$nextDueMs = 0.0

while ($sw.Elapsed.TotalSeconds -lt $DurationSeconds) {
  $line++
  $elapsedMs = [Math]::Floor($sw.Elapsed.TotalMilliseconds)
  $stamp = (Get-Date).ToString('HH:mm:ss.fff')
  "[$Tag][$stamp][$line] $payload"

  $nextDueMs += $intervalMs
  $sleepMs = [int]([Math]::Floor($nextDueMs - $sw.Elapsed.TotalMilliseconds))
  if ($sleepMs -gt 0) {
    Start-Sleep -Milliseconds $sleepMs
  }
}

$sw.Stop()
$actualSeconds = [Math]::Round($sw.Elapsed.TotalSeconds, 3)
$actualLinesPerSecond = if ($actualSeconds -gt 0) { [Math]::Round($line / $actualSeconds, 2) } else { 0 }

# End metadata for benchmark tracking.
$footer = @{
  kind = 'terminal-bench-end'
  timestamp = (Get-Date).ToString('o')
  tag = $Tag
  emittedLines = $line
  actualSeconds = $actualSeconds
  actualLinesPerSecond = $actualLinesPerSecond
  approxTotalChars = ($line * $LineLength)
}
$footer | ConvertTo-Json -Compress
