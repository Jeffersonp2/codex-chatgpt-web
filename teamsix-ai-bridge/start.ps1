$ErrorActionPreference = 'Stop'

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Here

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    throw 'Bun nao foi encontrado no PATH.'
}

if (-not (Test-Path (Join-Path $Here 'node_modules'))) {
    Write-Host 'Instalando dependencias do TEAMSIX AI Bridge...' -ForegroundColor Cyan
    bun install
}

$env:TEAMSIX_HOST = if ($env:TEAMSIX_HOST) { $env:TEAMSIX_HOST } else { '127.0.0.1' }
$env:TEAMSIX_PORT = if ($env:TEAMSIX_PORT) { $env:TEAMSIX_PORT } else { '11436' }
$env:TEAMSIX_CHATGPT_WEB_URL = if ($env:TEAMSIX_CHATGPT_WEB_URL) { $env:TEAMSIX_CHATGPT_WEB_URL } else { 'http://127.0.0.1:17841/v1' }
$env:TEAMSIX_TOOLS_MODE = if ($env:TEAMSIX_TOOLS_MODE) { $env:TEAMSIX_TOOLS_MODE } else { 'bridge' }

Write-Host ''
Write-Host '=== TEAMSIX AI BRIDGE ===' -ForegroundColor Cyan
Write-Host "API:       http://$($env:TEAMSIX_HOST):$($env:TEAMSIX_PORT)/v1" -ForegroundColor Green
Write-Host "Dashboard: http://$($env:TEAMSIX_HOST):$($env:TEAMSIX_PORT)/" -ForegroundColor Green
Write-Host "Upstream:  $($env:TEAMSIX_CHATGPT_WEB_URL)" -ForegroundColor DarkGray
Write-Host ''

bun run start
