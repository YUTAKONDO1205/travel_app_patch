param(
  [int]$Port = 3100,
  [string]$BindHost = "127.0.0.1",
  [int]$TimeoutSeconds = 90
)

$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$runner = Join-Path $PSScriptRoot "next-dev-direct.cjs"
$stdoutLog = Join-Path $projectRoot "codex-smoke-out.log"
$stderrLog = Join-Path $projectRoot "codex-smoke-err.log"
$url = "http://$BindHost`:$Port"

Remove-Item -LiteralPath $stdoutLog, $stderrLog -ErrorAction SilentlyContinue

$serverProcess = Start-Process `
  -FilePath "node" `
  -ArgumentList @($runner, "--hostname", $BindHost, "--port", $Port) `
  -WorkingDirectory $projectRoot `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -PassThru

try {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastError = $null

  while ((Get-Date) -lt $deadline) {
    if ($serverProcess.HasExited) {
      $stdout = Get-Content -Raw $stdoutLog -ErrorAction SilentlyContinue
      $stderr = Get-Content -Raw $stderrLog -ErrorAction SilentlyContinue
      throw "Dev server exited before smoke check completed. stdout: $stdout stderr: $stderr"
    }

    try {
      $response = Invoke-WebRequest -UseBasicParsing $url -TimeoutSec 10
      $html = [string]$response.Content
      $requiredText = @("Maison Passage", "Open Jaw Explorer", "Skyscanner")
      $missingText = $requiredText | Where-Object { -not $html.Contains($_) }

      if ($response.StatusCode -ne 200) {
        throw "Expected HTTP 200 from $url, received $($response.StatusCode)."
      }

      if ($missingText.Count -gt 0) {
        throw "Rendered HTML is missing required text: $($missingText -join ', ')"
      }

      Write-Host "[smoke] PASS $url"
      exit 0
    } catch {
      $lastError = $_.Exception.Message
      Start-Sleep -Milliseconds 750
    }
  }

  throw "Timed out waiting for $url. Last error: $lastError"
} finally {
  if ($serverProcess -and -not $serverProcess.HasExited) {
    Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
  }
}
