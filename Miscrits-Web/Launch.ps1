$ErrorActionPreference = 'Stop'
$node = Join-Path $PSScriptRoot 'runtime/node.exe'
if (-not (Test-Path -LiteralPath $node)) { throw 'Missing browser backend runtime: runtime/node.exe.' }
$url = 'http://127.0.0.1:4318'
$running = $false
try {
    $health = Invoke-RestMethod -Uri ($url + '/api/health') -TimeoutSec 2
    if ($health.app -ne 'miscrits-browser') { throw 'Port 4318 is already used by another app.' }
    $running = $true
} catch {
    if ($_.Exception.Message -like '*already used*') { throw }
}
if (-not $running) {
    Start-Process -FilePath $node -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -ArgumentList @(('"' + (Join-Path $PSScriptRoot 'server.mjs') + '"'))
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 300
        try { $health = Invoke-RestMethod -Uri ($url + '/api/health') -TimeoutSec 1; if ($health.app -eq 'miscrits-browser') { $running = $true; break } } catch {}
    }
}
if (-not $running) { throw 'The browser backend could not start. Run runtime/node.exe server.mjs in Miscrits-Web for the error.' }
if ($health.version -lt 17) { throw 'An older website backend is still running. Finish any battle, run Stop Miscrits Website.cmd, then run Launch Miscrits Website.cmd again and sign in.' }
Start-Process $url
