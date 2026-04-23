param(
  [int]$Port = 3000,
  [string]$BindHost = "127.0.0.1"
)

$ErrorActionPreference = "Stop"

function Get-ListeningPids {
  param([int]$TargetPort)

  $matches = netstat -ano | Select-String ":$TargetPort"

  $pids = foreach ($match in $matches) {
    $parts = ($match.Line -split "\s+") | Where-Object { $_ }
    if ($parts.Length -ge 5 -and $parts[3] -eq "LISTENING") {
      [int]$parts[4]
    }
  }

  $pids | Sort-Object -Unique
}

function Assert-PortAvailable {
  param([int]$TargetPort)

  $blockingPids = Get-ListeningPids -TargetPort $TargetPort | Where-Object { $_ -ne $PID }
  if (-not $blockingPids) {
    return
  }

  Write-Host "[travel-app] Port $TargetPort is in use. Stopping listener(s): $($blockingPids -join ', ')"

  foreach ($blockingPid in $blockingPids) {
    & taskkill /PID $blockingPid /T /F | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Could not free port $TargetPort from PID $blockingPid. Stop the conflicting app and run npm run dev again."
    }
  }

  Start-Sleep -Milliseconds 600

  $remainingPids = Get-ListeningPids -TargetPort $TargetPort | Where-Object { $_ -ne $PID }
  if ($remainingPids) {
    throw "Port $TargetPort is still occupied by PID(s) $($remainingPids -join ', '). Stop the conflicting app and run npm run dev again."
  }
}

Assert-PortAvailable -TargetPort $Port

$runner = Join-Path $PSScriptRoot "next-dev-direct.cjs"
& node $runner --hostname $BindHost --port $Port
exit $LASTEXITCODE
