[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Baseline,
  [Parameter(Mandatory = $true)]
  [string]$Current,
  [double]$RegressionThresholdPct = 10
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Read-BenchResult {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    throw "File not found: $Path"
  }
  $raw = Get-Content -Path $Path -Raw
  $json = $raw | ConvertFrom-Json

  $requiredRoot = @('version', 'profile', 'metrics')
  foreach ($key in $requiredRoot) {
    if (-not $json.PSObject.Properties.Name.Contains($key)) {
      throw "Missing root field '$key': $Path"
    }
  }

  $requiredMetrics = @('fpsMedian', 'longTaskTotalMs', 'inputLatencyP95Ms', 'mainThreadBusyPct')
  foreach ($key in $requiredMetrics) {
    if (-not $json.metrics.PSObject.Properties.Name.Contains($key)) {
      throw "Missing metrics field '$key': $Path"
    }
  }

  return $json
}

function Get-ChangePct {
  param(
    [double]$Old,
    [double]$New
  )

  if ($Old -eq 0) {
    return [double]::NaN
  }
  return (($New - $Old) / $Old) * 100
}

function Format-Delta {
  param([double]$Value)

  if ([double]::IsNaN($Value)) {
    return 'N/A'
  }
  $rounded = [Math]::Round($Value, 2)
  if ($rounded -gt 0) { return "+$rounded%" }
  return "$rounded%"
}

$base = Read-BenchResult -Path $Baseline
$curr = Read-BenchResult -Path $Current

$rows = @()

# Higher fps is better.
$fpsDelta = Get-ChangePct -Old $base.metrics.fpsMedian -New $curr.metrics.fpsMedian
$rows += [pscustomobject]@{
  Metric = 'fpsMedian'
  Baseline = $base.metrics.fpsMedian
  Current = $curr.metrics.fpsMedian
  Delta = Format-Delta -Value $fpsDelta
  Status = if (-not [double]::IsNaN($fpsDelta) -and $fpsDelta -lt -$RegressionThresholdPct) { 'REGRESSION' } else { 'OK' }
}

# Lower is better for the following metrics.
foreach ($metricName in @('longTaskTotalMs', 'inputLatencyP95Ms', 'mainThreadBusyPct')) {
  $oldValue = [double]$base.metrics.$metricName
  $newValue = [double]$curr.metrics.$metricName
  $rawDelta = Get-ChangePct -Old $oldValue -New $newValue
  $inverseDelta = if ([double]::IsNaN($rawDelta)) { [double]::NaN } else { -$rawDelta }

  $rows += [pscustomobject]@{
    Metric = $metricName
    Baseline = $oldValue
    Current = $newValue
    Delta = Format-Delta -Value $inverseDelta
    Status = if (-not [double]::IsNaN($rawDelta) -and $rawDelta -gt $RegressionThresholdPct) { 'REGRESSION' } else { 'OK' }
  }
}

$summary = [ordered]@{
  baselineVersion = $base.version
  currentVersion = $curr.version
  profileMatch = ($base.profile -eq $curr.profile)
  regressionThresholdPct = $RegressionThresholdPct
  hasRegression = ($rows | Where-Object { $_.Status -eq 'REGRESSION' }).Count -gt 0
}

$summary | ConvertTo-Json -Compress
$rows | Format-Table -AutoSize
