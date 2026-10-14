# Checagem antes do commit do painel (14/10/2026).
# 1) carimba a versao (data/hora) no index.html  2) valida a sintaxe
# 3) mostra o que vai entrar no commit. Uso: .\checar.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$arq = Join-Path $PSScriptRoot 'index.html'

$txt = [IO.File]::ReadAllText($arq)
if ($txt -notmatch "const BUILD_VERSAO = '[^']*';") {
  Write-Host "BUILD_VERSAO nao encontrado no index.html" -ForegroundColor Red; exit 1
}
# Versao x.y.z a partir do nº de commits (decidido 14/10/2026):
# proximo commit = total atual + 1; y = centena, z = resto. Ex: 258 -> 1.2.58
$n = [int](git rev-list --count HEAD) + 1
$semver = "1.$([math]::Floor($n / 100)).$($n % 100)"
$versao = "$semver - " + (Get-Date -Format 'dd/MM/yyyy HH:mm')
$novo = [regex]::Replace($txt, "const BUILD_VERSAO = '[^']*';", "const BUILD_VERSAO = '$versao';")
[IO.File]::WriteAllText($arq, $novo, (New-Object Text.UTF8Encoding($false)))

node .\checar-sintaxe.js .\index.html
if ($LASTEXITCODE -ne 0) { Write-Host "Sintaxe com erro - NAO commite." -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "Arquivos modificados:" -ForegroundColor Cyan
git status --short --untracked-files=no
Write-Host ""
git diff --stat -- index.html
Write-Host ""
Write-Host "Versao carimbada: $versao" -ForegroundColor Green
Write-Host "Se so o index.html aparece acima: git add index.html; git commit -m '...'; git push" -ForegroundColor Green
