@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "REPO=truongnat/TIRAI"
if defined TIRAI_REPO set "REPO=%TIRAI_REPO%"
set "VERSION=latest"
if defined TIRAI_VERSION set "VERSION=%TIRAI_VERSION%"
set "TOKEN=%GITHUB_TOKEN%"
if not defined TOKEN set "TOKEN=%GH_TOKEN%"

where node >nul 2>nul || (echo [tirai] ERROR: Node.js ^>= 20 is required. & exit /b 1)
where npm >nul 2>nul || (echo [tirai] ERROR: npm is required. & exit /b 1)
where powershell >nul 2>nul || (echo [tirai] ERROR: Windows PowerShell is required. & exit /b 1)

for /f %%V in ('node -p "Number(process.versions.node.split('.')[0])"') do set "NODE_MAJOR=%%V"
if %NODE_MAJOR% LSS 20 (echo [tirai] ERROR: Node.js ^>= 20 is required. & exit /b 1)

echo [tirai] Resolving TIRAI release from %REPO% (%VERSION%)...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$repo=$env:REPO; $version=$env:VERSION; $token=$env:TOKEN;" ^
  "$headers=@{Accept='application/vnd.github+json';'X-GitHub-Api-Version'='2022-11-28'}; if($token){$headers.Authorization='Bearer '+$token};" ^
  "$api='https://api.github.com/repos/'+$repo; if($version -eq 'latest'){$url=$api+'/releases/latest'}else{$tag=if($version.StartsWith('v')){$version}else{'v'+$version};$url=$api+'/releases/tags/'+$tag};" ^
  "try{$r=Invoke-RestMethod -Uri $url -Headers $headers}catch{$status=$_.Exception.Response.StatusCode.value__;if($status -eq 404){if($version -eq 'latest'){throw ('No GitHub Release exists yet for '+$repo+'. Create and push a version tag such as v1.0.0 so the release workflow can publish the CLI package.')}else{throw ('GitHub Release '+$version+' was not found for '+$repo+'.')}};throw ('Could not read GitHub release: '+$_.Exception.Message)};" ^
  "$asset=$r.assets|Where-Object{$_.name -match '^tirai-cli-.*\.tgz$'}|Select-Object -First 1; if(!$asset){throw 'The selected release does not contain a tirai-cli-*.tgz asset.'};" ^
  "$tmp=Join-Path ([IO.Path]::GetTempPath()) ('tirai-install-'+[guid]::NewGuid());New-Item -ItemType Directory -Path $tmp|Out-Null;" ^
  "$tgz=Join-Path $tmp $asset.name; $downloadHeaders=@{Accept='application/octet-stream';'X-GitHub-Api-Version'='2022-11-28'};if($token){$downloadHeaders.Authorization='Bearer '+$token};" ^
  "Write-Host ('[tirai] Downloading '+$asset.name+'...');Invoke-WebRequest -Uri $asset.url -Headers $downloadHeaders -OutFile $tgz;" ^
  "$sha=$r.assets|Where-Object{$_.name -match '\.sha256$'}|Select-Object -First 1;if($sha){$shaFile=Join-Path $tmp $sha.name;Invoke-WebRequest -Uri $sha.url -Headers $downloadHeaders -OutFile $shaFile;$expected=((Get-Content $shaFile -Raw).Trim() -split '\s+')[0].ToLower();$actual=(Get-FileHash $tgz -Algorithm SHA256).Hash.ToLower();if($expected -ne $actual){throw 'SHA256 verification failed.'};Write-Host '[tirai] SHA256 verified.'};" ^
  "Write-Host '[tirai] Installing globally with npm...'; & npm.cmd install --global $tgz; if($LASTEXITCODE -ne 0){exit $LASTEXITCODE};Remove-Item -Recurse -Force $tmp;" ^
  "try{$v=& tirai.cmd --version;Write-Host ('[tirai] Installed '+$v)}catch{Write-Host '[tirai] Installation finished. Open a new terminal if tirai is not yet on PATH.'};Write-Host '[tirai] Run: tirai --help'"

if errorlevel 1 exit /b %errorlevel%
endlocal
