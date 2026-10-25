# Install or update dsh-tg-bridge from the npm registry (Windows).
#
#   $env:DSH_TG_TOKEN='123456789:AA...'; $env:DSH_TG_USER='123456789'
#   .\install.ps1
#
# Optional: DSH_TG_VOICE=1 (voice), DSH_TG_HOME (install dir),
#           DSH_TG_NOSETUP=1 (install and check only, do not restart the bridge),
#           DSH_TG_PACKAGE (npm package, default dsh-tg-bridge).
$ErrorActionPreference = 'Stop'

$Pkg = if ($env:DSH_TG_PACKAGE) { $env:DSH_TG_PACKAGE } else { 'dsh-tg-bridge' }
$Dest = if ($env:DSH_TG_HOME) { $env:DSH_TG_HOME } else { Join-Path $env:USERPROFILE '.dsh\tg-bridge' }
$Token = $env:DSH_TG_TOKEN
$User = $env:DSH_TG_USER

foreach ($tool in 'node', 'npm') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is required" }
}
$major = [int]((node -v).TrimStart('v').Split('.')[0])
if ($major -lt 20) { throw "node >= 20 is required (found $(node -v))" }

$Tmp = Join-Path $env:TEMP ("dsh-tg-" + [guid]::NewGuid().ToString('n'))
New-Item -ItemType Directory -Force -Path $Tmp | Out-Null
try {
  Write-Host "downloading $Pkg@latest"
  npm pack "$Pkg@latest" --pack-destination $Tmp | Out-Null
  $tgz = Get-ChildItem $Tmp -Filter *.tgz | Select-Object -First 1
  if (-not $tgz) { throw 'npm pack produced no tarball' }
  tar -xzf $tgz.FullName -C $Tmp

  Write-Host "installing into $Dest"
  New-Item -ItemType Directory -Force -Path $Dest | Out-Null
  # config.json, state.json and pending\ are not part of the package, so an
  # update keeps them while every code file is replaced.
  Copy-Item (Join-Path $Tmp 'package\*') $Dest -Recurse -Force
} finally {
  Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Push-Location $Dest
try {
  if ($Token -and $User) {
    $initArgs = @('cli.mjs', 'init', '--token', $Token, '--user', $User)
    if ($env:DSH_TG_VOICE -eq '1') { $initArgs += '--voice' }
    node @initArgs
  } elseif (-not (Test-Path 'config.json')) {
    Copy-Item 'config.example.json' 'config.json'
    Write-Host 'created config.json - set allowedUserIds and cwd, or rerun with DSH_TG_TOKEN and DSH_TG_USER'
  }

  if ($Token -and $User -and -not $env:DSH_TG_NOSETUP) {
    node cli.mjs setup
  } else {
    node cli.mjs check
  }
} finally { Pop-Location }

Write-Host ''
Write-Host 'Next:'
Write-Host '  in Telegram: /doctor, /help, /plugins, /cd <project>'
Write-Host "  logs:        $Dest\bridge.log"
