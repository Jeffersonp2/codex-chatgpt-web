$ErrorActionPreference = 'Stop'

$Base = if ($env:TEAMSIX_TEST_URL) { $env:TEAMSIX_TEST_URL.TrimEnd('/') } else { 'http://127.0.0.1:11436/v1' }
$Key = $env:TEAMSIX_TEST_KEY

$Headers = @{}
if ($Key) { $Headers.Authorization = "Bearer $Key" }

Write-Host '=== TEAMSIX / 9ROUTER ENDPOINT TEST ===' -ForegroundColor Cyan
Write-Host "Endpoint: $Base" -ForegroundColor DarkGray
Write-Host 'This script tests the public TEAMSIX endpoint. The packaged desktop app should own the embedded ChatGPT runtime automatically.' -ForegroundColor DarkGray
Write-Host ''

Write-Host 'Models:' -ForegroundColor Cyan
$Models = Invoke-RestMethod -Uri "$Base/models" -Headers $Headers
$Models.data | Select-Object id, owned_by | Format-Table -AutoSize

Write-Host ''
Write-Host 'Response:' -ForegroundColor Cyan
$Body = @{
    model = 'chatgpt-web/high'
    input = 'Responda exatamente: TEAMSIX 9ROUTER OK'
    stream = $false
} | ConvertTo-Json -Depth 20

try {
    $Response = Invoke-RestMethod `
        -Uri "$Base/responses" `
        -Method POST `
        -Headers $Headers `
        -ContentType 'application/json' `
        -Body $Body
    $Response | ConvertTo-Json -Depth 30
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
    throw
}
