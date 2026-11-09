$ErrorActionPreference = 'Stop'
$lapperRoot = Split-Path $PSScriptRoot -Parent
$lapperLocalSdk = Join-Path $lapperRoot '.tools/dotnet/dotnet.exe'
if (Test-Path -LiteralPath $lapperLocalSdk) {
    $lapperDotnet = $lapperLocalSdk
    $env:DOTNET_ROOT = Split-Path $lapperLocalSdk -Parent
    $env:DOTNET_CLI_HOME = Join-Path $lapperRoot '.tools/cli-home'
    $env:NUGET_PACKAGES = Join-Path $lapperRoot '.nuget/packages'
} else {
    $lapperDotnet = (Get-Command dotnet -ErrorAction Stop).Source
}
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$lapperTests = Join-Path $lapperRoot 'LapperRead.Tests/LapperRead.Tests.csproj'
& $lapperDotnet test $lapperTests --configuration Release --nologo --verbosity minimal --logger 'trx;LogFileName=regression.trx' 2>&1 |
    Tee-Object -FilePath (Join-Path $PSScriptRoot 'results.txt')
if ($LASTEXITCODE -ne 0) { throw "Lapper Read regression checks failed (exit $LASTEXITCODE)." }
