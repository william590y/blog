@echo off
setlocal
set "WRITING_INSTALLER=%~f0"
powershell.exe -NoProfile -Command "$text = [IO.File]::ReadAllText($env:WRITING_INSTALLER); $parts = $text -split '(?m)^# POWERSHELL_START\r?$', 2; try { & ([scriptblock]::Create($parts[1])) } catch { Write-Host $_ -ForegroundColor Red; exit 1 }"
set "RESULT=%errorlevel%"
pause
exit /b %RESULT%
# POWERSHELL_START
$ErrorActionPreference = 'Stop'
Write-Host 'Scriptorium - Obsidian configuration installer'
$defaultPath = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Scriptorium'
$answer = Read-Host "New vault folder (Enter for $defaultPath)"
$destination = if ([string]::IsNullOrWhiteSpace($answer)) { $defaultPath } else { [IO.Path]::GetFullPath($answer) }
if (Test-Path -LiteralPath $destination) { throw "Folder already exists: $destination. Choose a new folder; nothing was changed." }
$tempPath = Join-Path ([IO.Path]::GetTempPath()) ('obsidian-writing-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tempPath | Out-Null
try {
    $archive = Join-Path $tempPath 'Writing.zip'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://williamliaw.com/assets/downloads/Scriptorium.zip' -OutFile $archive
    $actualHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne '3c7353f7822f0bd31d51fab2f1a94b5160d163cc10b76828005e8ba7762b5683') { throw 'Package verification failed. Please download the current installer from the Projects page.' }
    $staging = Join-Path $tempPath 'vault'
    Expand-Archive -LiteralPath $archive -DestinationPath $staging
    if (!(Test-Path -LiteralPath (Join-Path $staging '.obsidian/appearance.json'))) { throw 'Invalid configuration archive.' }
    function Find-Obsidian {
        foreach ($base in @($env:LOCALAPPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)})) {
            if (!$base) { continue }
            foreach ($relative in @('Obsidian\Obsidian.exe', 'Programs\Obsidian\Obsidian.exe')) {
                $exe = Join-Path $base $relative
                if (Test-Path -LiteralPath $exe -PathType Leaf) { return $exe }
            }
        }
        $cmd = Get-Command Obsidian.exe -CommandType Application -ErrorAction SilentlyContinue
        if ($cmd) { return $cmd.Source }
    }
    $protocol = 'Registry::HKEY_CLASSES_ROOT\obsidian\shell\open\command'
    $exe = Find-Obsidian
    if (!$exe -and !(Test-Path -LiteralPath $protocol)) {
        Write-Host 'Installing Obsidian for the current user ...'
        $setup = Join-Path $tempPath 'Obsidian-Setup.exe'
        Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/obsidianmd/obsidian-releases/releases/download/v1.15.0/Obsidian-1.15.0.exe' -OutFile $setup
        if ((Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash -ne 'b0f60c75a12f96d54cb16b9fc32919966f2ebf029d9af75d67a19ba6555e1da0') { throw 'Obsidian download verification failed.' }
        $process = Start-Process -FilePath $setup -ArgumentList '/S', '/currentuser' -Wait -PassThru
        if ($process.ExitCode -ne 0) { throw "Obsidian setup exited with code $($process.ExitCode)." }
        $exe = Find-Obsidian
        if (!$exe -and !(Test-Path -LiteralPath $protocol)) { throw 'Obsidian setup did not complete.' }
    }
    # CreateDirectory alone would merge; this deliberately fails if another process created the folder.
    New-Item -ItemType Directory -Path $destination -ErrorAction Stop | Out-Null
    Get-ChildItem -LiteralPath $staging -Force | Copy-Item -Destination $destination -Recurse
    Write-Host "Installed in $destination"
    Write-Host 'For the intended fonts, install EB Garamond and Cormorant Garamond from Google Fonts.'
    Write-Host 'Open Lorem Ipsum in Reading view. Review the bundled community plugins before enabling them.'
    Write-Host "In Obsidian, choose Open folder as vault and select $destination"
    if ($exe) { Start-Process -FilePath $exe -ArgumentList 'obsidian://choose-vault' }
    else { Start-Process 'obsidian://choose-vault' }
} finally {
    Remove-Item -LiteralPath $tempPath -Recurse -Force -ErrorAction SilentlyContinue
}
