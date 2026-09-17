param(
    [string]$Bridge = 'http://127.0.0.1:11436',
    [string]$Router = 'http://127.0.0.1:20128',
    [string]$RouterKey = ''
)

$ErrorActionPreference = 'Stop'

Write-Host '=== TEAMSIX HEALTH ===' -ForegroundColor Cyan
Invoke-RestMethod "$Bridge/healthz" | ConvertTo-Json -Depth 20

Write-Host ''
Write-Host '=== TEAMSIX MODELS ===' -ForegroundColor Cyan
(Invoke-RestMethod "$Bridge/v1/models").data | Select-Object id, owned_by | Format-Table -AutoSize

Write-Host ''
Write-Host '=== DIRECT RESPONSE ===' -ForegroundColor Cyan
$body = @{
    model = 'chatgpt-web/high'
    input = 'Responda exatamente: TEAMSIX DIRECT OK'
    stream = $false
} | ConvertTo-Json -Depth 20
Invoke-RestMethod -Uri "$Bridge/v1/responses" -Method POST -ContentType 'application/json' -Body $body | ConvertTo-Json -Depth 30

if ($RouterKey) {
    Write-Host ''
    Write-Host '=== 9ROUTER -> TEAMSIX ===' -ForegroundColor Cyan
    $headers = @{ Authorization = "Bearer $RouterKey"; 'Content-Type' = 'application/json' }
    $routerBody = @{
        model = 'teamsix/chatgpt-web/high'
        input = 'Responda exatamente: 9ROUTER TEAMSIX OK'
        stream = $false
    } | ConvertTo-Json -Depth 20
    Invoke-RestMethod -Uri "$Router/v1/responses" -Method POST -Headers $headers -Body $routerBody | ConvertTo-Json -Depth 30
} else {
    Write-Host ''
    Write-Host '9Router test skipped. Pass -RouterKey with a 9Router API key to enable it.' -ForegroundColor Yellow
}
