@echo off
setlocal
set "WRITING_INSTALLER=%~f0"
powershell.exe -NoProfile -Command "$text = [IO.File]::ReadAllText($env:WRITING_INSTALLER); $parts = $text -split '(?m)^# POWERSHELL_START\r?$', 2; try { & ([scriptblock]::Create($parts[1])) } catch { Write-Host $_ -ForegroundColor Red; exit 1 }"
pause
exit /b
# POWERSHELL_START
$ErrorActionPreference = 'Stop'
Write-Host 'Writing - Obsidian configuration installer'
$defaultPath = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Obsidian-Writing'
$answer = Read-Host "New vault folder (Enter for $defaultPath)"
$destination = if ([string]::IsNullOrWhiteSpace($answer)) { $defaultPath } else { [IO.Path]::GetFullPath($answer) }
if (Test-Path -LiteralPath $destination) { throw "Folder already exists: $destination. Choose a new folder; nothing was changed." }
$tempPath = Join-Path ([IO.Path]::GetTempPath()) ('obsidian-writing-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tempPath | Out-Null
try {
    $archive = Join-Path $tempPath 'Writing.zip'
    Invoke-WebRequest -Uri 'https://williamliaw.com/assets/downloads/Writing-obsidian-config.zip' -OutFile $archive
    $actualHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne '599bf22c2b736f1e9a94836dd135fc549d5e3830bf0cefc2c18fe12ca07e854e') { throw 'Package verification failed. Please download the current installer from the Projects page.' }
    $staging = Join-Path $tempPath 'vault'
    Expand-Archive -LiteralPath $archive -DestinationPath $staging
    if (!(Test-Path -LiteralPath (Join-Path $staging '.obsidian/appearance.json'))) { throw 'Invalid configuration archive.' }
    # CreateDirectory alone would merge; this deliberately fails if another process created the folder.
    New-Item -ItemType Directory -Path $destination -ErrorAction Stop | Out-Null
    Get-ChildItem -LiteralPath $staging -Force | Copy-Item -Destination $destination -Recurse
    Write-Host "Installed in $destination"
    Write-Host 'For the intended fonts, install EB Garamond and Cormorant Garamond from Google Fonts.'
    Write-Host 'Open Lorem Ipsum in Reading view. Review the bundled community plugins before enabling them.'
    $obsidian = Get-ItemProperty 'Registry::HKEY_CLASSES_ROOT\obsidian' -ErrorAction SilentlyContinue
    if ($null -ne $obsidian) {
        Start-Process ('obsidian://open?path=' + [uri]::EscapeDataString($destination))
    } else {
        Write-Host "Install Obsidian, then choose Open folder as vault and select $destination"
        Start-Process 'https://obsidian.md/download'
    }
} finally {
    Remove-Item -LiteralPath $tempPath -Recurse -Force -ErrorAction SilentlyContinue
}
