<#
  Instala o plugin Antigravity (agy) para o OpenCode 2 no Windows.

  Uso (na pasta onde você extraiu o zip):
    powershell -ExecutionPolicy Bypass -File .\install.ps1
#>
param(
  # Pasta de configuração do OpenCode (padrão: %USERPROFILE%\.config\opencode)
  [string]$ConfigDir = $(if ($env:XDG_CONFIG_HOME) { Join-Path $env:XDG_CONFIG_HOME "opencode" } else { Join-Path $HOME ".config\opencode" })
)
$ErrorActionPreference = "Stop"

function Ok($message) { Write-Host "  [ok] $message" -ForegroundColor Green }
function Warn($message) { Write-Host "  [aviso] $message" -ForegroundColor Yellow }

Write-Host ""
Write-Host "Plugin Antigravity (agy) para OpenCode" -ForegroundColor Cyan
Write-Host ""

# 1. Pré-requisitos (só avisa, não impede a instalação)
if (Get-Command opencode -ErrorAction SilentlyContinue) {
  $version = (& opencode --version 2>$null | Out-String).Trim()
  if ($version -match '(\d+)\.\d+') {
    if ([int]$Matches[1] -ge 2) { Ok "OpenCode $version" }
    else { Warn "Seu OpenCode é $version, mas este plugin precisa do OpenCode 2.x (atualize com: opencode upgrade)." }
  }
} else {
  Warn "O comando 'opencode' não foi encontrado. Instale o OpenCode 2 antes de usar o plugin."
}

$agyInstalled = Join-Path $env:LOCALAPPDATA "agy\bin\agy.exe"
if (Get-Command agy -ErrorAction SilentlyContinue) { Ok "agy encontrado no PATH" }
elseif (Test-Path $agyInstalled) { Ok "agy encontrado em $agyInstalled" }
else { Warn "O agy não foi encontrado. Instale o Antigravity CLI e rode 'agy' uma vez no terminal para fazer login." }

# O agy ignora o settings.json INTEIRO se ele tiver erro de sintaxe (vírgula faltando/sobrando).
$agySettings = Join-Path $HOME ".gemini\antigravity-cli\settings.json"
if (Test-Path $agySettings) {
  try {
    [System.IO.File]::ReadAllText($agySettings) | ConvertFrom-Json | Out-Null
    Ok "settings.json do agy é válido"
  } catch {
    Warn "O arquivo $agySettings tem erro de sintaxe; o agy vai ignorar todas as configurações dele. Veja a seção 'Problemas comuns' do README."
  }
}

# 2. Copia o plugin
$source = Join-Path $PSScriptRoot "agy"
$pluginDir = Join-Path $ConfigDir "plugins\agy"
$isUpdate = Test-Path (Join-Path $pluginDir "server.js")
New-Item -ItemType Directory -Force -Path $pluginDir | Out-Null
Copy-Item -Path (Join-Path $source "*") -Destination $pluginDir -Force
# Arquivos extraídos de um zip baixado da internet vêm "bloqueados" pelo Windows.
Get-ChildItem $pluginDir | Unblock-File -ErrorAction SilentlyContinue
Ok "Plugin copiado para $pluginDir"

# 3. Configuração do OpenCode
$configFile = Join-Path $ConfigDir "opencode.json"
$example = Join-Path $PSScriptRoot "opencode.example.json"
if (-not (Test-Path $configFile)) {
  Copy-Item $example $configFile
  Ok "Criado $configFile"
} else {
  $config = $null
  try { $config = [System.IO.File]::ReadAllText($configFile) | ConvertFrom-Json } catch { }

  if ($null -eq $config) {
    Warn "Não consegui ler $configFile (ele tem comentários ou erro de sintaxe)."
    Warn "Copie manualmente o bloco ""agy"" do arquivo opencode.example.json para dentro de ""providers""."
  } elseif ($config.PSObject.Properties["providers"] -and $config.providers.PSObject.Properties["agy"]) {
    Ok "O opencode.json já tem providers.agy; mantive a sua configuração."
  } else {
    $backup = "$configFile.bak-agy"
    Copy-Item $configFile $backup -Force
    $block = ([System.IO.File]::ReadAllText($example) | ConvertFrom-Json).providers.agy
    if (-not $config.PSObject.Properties["providers"]) {
      $config | Add-Member -NotePropertyName providers -NotePropertyValue ([pscustomobject]@{})
    }
    $config.providers | Add-Member -NotePropertyName agy -NotePropertyValue $block
    $json = $config | ConvertTo-Json -Depth 32
    [System.IO.File]::WriteAllText($configFile, $json, (New-Object System.Text.UTF8Encoding $false))
    Ok "Adicionado providers.agy em $configFile (backup em $backup)"
  }
}

Write-Host ""
if ($isUpdate) {
  Write-Host "Atualização: rode 'opencode service restart' uma vez para o serviço do OpenCode carregar a versão nova." -ForegroundColor Yellow
}
Write-Host "Pronto! Feche e abra o OpenCode de novo, depois confira com:" -ForegroundColor Cyan
Write-Host "  opencode models"
Write-Host "Os modelos aparecem como agy/<modelo> (grupo 'Antigravity (agy)' no /models)."
Write-Host ""
