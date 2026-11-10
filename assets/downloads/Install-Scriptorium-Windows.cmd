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
    # Install missing font families for this user, including roman and italic faces.
    Add-Type -AssemblyName System.Drawing
    $installed = New-Object System.Drawing.Text.InstalledFontCollection
    $families = @($installed.Families | ForEach-Object { $_.Name })
    $installed.Dispose()
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ScriptoriumFontRegistration {
    [DllImport("gdi32.dll", CharSet = CharSet.Unicode)]
    public static extern int AddFontResourceEx(string path, uint flags, IntPtr reserved);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
}
'@
    $fontDir = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Fonts'
    $fontRegistry = 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Fonts'
    function Install-ScriptoriumFont($file, $url, $hash, $label) {
        $target = Join-Path $fontDir $file
        if (Test-Path -LiteralPath $target) {
            if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $hash) { throw "Existing font differs: $target" }
        } else {
            $download = Join-Path $tempPath $file
            Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $download
            if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ne $hash) { throw "Font verification failed: $file" }
            New-Item -ItemType Directory -Path $fontDir -Force | Out-Null
            Copy-Item -LiteralPath $download -Destination $target
        }
        New-Item -Path $fontRegistry -Force | Out-Null
        New-ItemProperty -Path $fontRegistry -Name $label -Value $target -PropertyType String -Force | Out-Null
        if ([ScriptoriumFontRegistration]::AddFontResourceEx($target, 0, [IntPtr]::Zero) -eq 0) {
            throw "Could not load font: $target"
        }
    }
    if ($families -notcontains 'EB Garamond') {
        Write-Host 'Installing EB Garamond ...'
        Install-ScriptoriumFont 'EBGaramond-Scriptorium.ttf' 'https://raw.githubusercontent.com/google/fonts/5bb28733cec313b63fbd415b574b5ae35c8aa8b8/ofl/ebgaramond/EBGaramond%5Bwght%5D.ttf' 'ef9512f92f6d579e5dc75af59a5a4b1b8b47d2eda89e00b954d44520e5369027' 'EB Garamond Regular (TrueType)'
        Install-ScriptoriumFont 'EBGaramond-Italic-Scriptorium.ttf' 'https://raw.githubusercontent.com/google/fonts/5bb28733cec313b63fbd415b574b5ae35c8aa8b8/ofl/ebgaramond/EBGaramond-Italic%5Bwght%5D.ttf' 'bba2c4499c93c9612b90b9825d32b07da52fce2fe57562a1eb6b833553f93c4e' 'EB Garamond Italic (TrueType)'
    }
    if ($families -notcontains 'Cormorant Garamond') {
        Write-Host 'Installing Cormorant Garamond ...'
        Install-ScriptoriumFont 'CormorantGaramond-Scriptorium.ttf' 'https://raw.githubusercontent.com/google/fonts/5bb28733cec313b63fbd415b574b5ae35c8aa8b8/ofl/cormorantgaramond/CormorantGaramond%5Bwght%5D.ttf' 'b20b7d9626dd956b2c5e558692ad328b1f19e3275e2782db4fa07670d83f35e0' 'Cormorant Garamond Regular (TrueType)'
        Install-ScriptoriumFont 'CormorantGaramond-Italic-Scriptorium.ttf' 'https://raw.githubusercontent.com/google/fonts/5bb28733cec313b63fbd415b574b5ae35c8aa8b8/ofl/cormorantgaramond/CormorantGaramond-Italic%5Bwght%5D.ttf' '0f48ea6abb2084537854f7174c470991a463b13036309e3b50a81511611c530d' 'Cormorant Garamond Italic (TrueType)'
    }
    $broadcastResult = [UIntPtr]::Zero
    [void][ScriptoriumFontRegistration]::SendMessageTimeout([IntPtr]0xffff, 0x001d, [UIntPtr]::Zero, [IntPtr]::Zero, 2, 5000, [ref]$broadcastResult)
    # CreateDirectory alone would merge; this deliberately fails if another process created the folder.
    New-Item -ItemType Directory -Path $destination -ErrorAction Stop | Out-Null
    Get-ChildItem -LiteralPath $staging -Force | Copy-Item -Destination $destination -Recurse
    Write-Host "Installed in $destination"
    Write-Host 'Fonts are ready. Restart any running Obsidian windows to load newly installed fonts.'
    Write-Host 'Open Lorem Ipsum in Reading view. Review the bundled community plugins before enabling them.'
    Write-Host "In Obsidian, choose Open folder as vault and select $destination"
    if ($exe) { Start-Process -FilePath $exe -ArgumentList 'obsidian://choose-vault' }
    else { Start-Process 'obsidian://choose-vault' }
} finally {
    Remove-Item -LiteralPath $tempPath -Recurse -Force -ErrorAction SilentlyContinue
}
