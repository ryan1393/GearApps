param(
    [string]$Folder = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
$RemoteUrl = 'https://github.com/ryan1393/TruckLog.git'

try {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw 'Install Git for Windows from https://git-scm.com/download/win, reopen PowerShell, and run this script again.'
    }

    $ResolvedFolder = (Resolve-Path -LiteralPath $Folder).Path
    $RepoRoot = $null
    $Candidate = Get-Item -LiteralPath $ResolvedFolder
    if (-not $Candidate.PSIsContainer) { throw 'Folder must be a directory.' }
    for ($Depth = 0; $Depth -lt 4 -and $null -ne $Candidate; $Depth++) {
        if ((Test-Path -LiteralPath (Join-Path $Candidate.FullName 'truck-log\VERSION')) -and
            (Test-Path -LiteralPath (Join-Path $Candidate.FullName 'truck-log\package.json')) -and
            (Test-Path -LiteralPath (Join-Path $Candidate.FullName 'print-agents') -PathType Container) -and
            (Test-Path -LiteralPath (Join-Path $Candidate.FullName 'README.md'))) {
            $RepoRoot = $Candidate.FullName
            break
        }
        $Candidate = $Candidate.Parent
    }
    if (-not $RepoRoot) {
        throw 'Run this from the extracted GitHub TruckLog folder, or its truck-log subfolder. The repository folder must contain README.md and truck-log\VERSION.'
    }

    for ($Ancestor = Get-Item -LiteralPath $RepoRoot; $null -ne $Ancestor; $Ancestor = $Ancestor.Parent) {
        if (Test-Path -LiteralPath (Join-Path $Ancestor.FullName '.git')) {
            throw ('An existing Git repository was found at ' + $Ancestor.FullName + '. Run git status there before changing its configuration.')
        }
    }
    foreach ($Child in @('truck-log', 'print-agents')) {
        if (Test-Path -LiteralPath (Join-Path (Join-Path $RepoRoot $Child) '.git')) {
            throw ('A nested Git repository already exists in ' + $Child + '. Its history has been left intact.')
        }
    }
    $IgnoreFile = Join-Path $RepoRoot 'truck-log\.gitignore'
    if (-not (Test-Path -LiteralPath $IgnoreFile)) { throw 'The app .gitignore is missing.' }
    if (-not (Select-String -LiteralPath $IgnoreFile -Pattern '^\.env$' -Quiet)) {
        throw 'The app .gitignore must exclude .env before connecting this folder.'
    }

    Write-Host ('Repository folder: ' + $RepoRoot)
    Write-Host 'Checking GitHub access. Complete GitHub sign-in if a browser opens.'
    $SavedPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $RemoteHead = @(& git ls-remote --exit-code --heads $RemoteUrl main)
        $RemoteExitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $SavedPreference }
    if ($RemoteExitCode -ne 0 -or $RemoteHead.Count -eq 0) {
        throw 'GitHub access failed. Complete sign-in or check the connection, then run this script again.'
    }

    function Invoke-RepoGit {
        param([string[]]$GitArguments)
        # Git progress and credential-manager notices can use stderr; check its exit code.
        $SavedGitPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            & git -C $RepoRoot @GitArguments
            $GitExitCode = $LASTEXITCODE
        } finally { $ErrorActionPreference = $SavedGitPreference }
        if ($GitExitCode -ne 0) {
            throw ('Git failed: ' + ($GitArguments -join ' ') + '. Keep the current files and resolve this error before continuing.')
        }
    }

    Invoke-RepoGit -GitArguments @('init', '-b', 'main')
    Invoke-RepoGit -GitArguments @('remote', 'add', 'origin', $RemoteUrl)
    Invoke-RepoGit -GitArguments @('fetch', 'origin', 'main')
    # A mixed reset attaches fetched history and index while preserving all working files.
    Invoke-RepoGit -GitArguments @('reset', '--mixed', 'origin/main')
    Invoke-RepoGit -GitArguments @('branch', '--set-upstream-to=origin/main', 'main')
    Invoke-RepoGit -GitArguments @('status', '--short', '--branch')

    Write-Host ''
    Write-Host 'TruckLog is now a local Git repository connected to origin/main.'
    Write-Host 'Your app files and .env were preserved. Local differences appear in git status.'
    Write-Host ('App folder: ' + (Join-Path $RepoRoot 'truck-log'))
    Write-Host 'For future updates, review git status before running git pull --ff-only.'
} catch {
    Write-Host ('ERROR: ' + $_.Exception.Message) -ForegroundColor Red
    if ($RepoRoot -and (Test-Path -LiteralPath (Join-Path $RepoRoot '.git'))) {
        Write-Host 'Keep the existing .git folder. Re-running this script will stop to protect its history.'
        Write-Host ('Inspect it with: git -C "' + $RepoRoot + '" status')
    }
    exit 1
}
