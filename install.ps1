<#
Install everything needed to build and preview Saxion ACS courses locally, on
Windows 10/11 (64-bit). See requirements.md. In WSL, use install.sh instead:
it is faster.

Usage, in PowerShell:
  irm https://raw.githubusercontent.com/SaxionACS/course-tools/v2/install.ps1 | iex
or from a clone:
  powershell -ExecutionPolicy Bypass -File install.ps1           the same
  powershell -ExecutionPolicy Bypass -File install.ps1 -Local    install this clone
                                                                 (editable, for working on course-tools)

Environment: TOOLS_REF (course-tools version from GitHub, default v2),
PYTHON_VERSION (default 3.12), UV_NO_MODIFY_PATH (set: leave PATH alone).

Runs in Windows PowerShell 5.1: no `&&`, no ternary operator. ASCII only:
5.1 reads a file without a byte order mark in the ANSI code page. Not
$ErrorActionPreference = 'Stop': 5.1 then stops on anything a program writes
to stderr (progress, warnings) when the output is redirected; native programs
are checked by their exit code (Run) and cmdlets with -ErrorAction Stop.
#>
param([switch]$Local)

function Install-CourseTools([string]$LocalDir) {
    # Inside a function, so that `irm | iex` leaves the caller's session alone.
    $ref = if ($env:TOOLS_REF) { $env:TOOLS_REF } else { 'v2' }
    $python = if ($env:PYTHON_VERSION) { $env:PYTHON_VERSION } else { '3.12' }

    function Step([string]$Text) { Write-Host "`n==> $Text" -ForegroundColor Cyan }
    # Native programs report failure through their exit code, not as an error.
    function Run([string]$What) {
        if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE)" }
    }
    function Refresh-Path {
        $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                    [Environment]::GetEnvironmentVariable('Path', 'User')
    }

    if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
        throw "course-tools supports 64-bit Windows on x64 (AMD64), not $env:PROCESSOR_ARCHITECTURE."
    }

    Step 'git'
    if (Get-Command git -ErrorAction SilentlyContinue) {
        Write-Host (git --version)
    } else {
        if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
            throw 'git is needed: install Git for Windows (https://git-scm.com), then run this script again.'
        }
        winget install --id Git.Git --exact --source winget --accept-package-agreements --accept-source-agreements
        Run 'winget install Git.Git'
        Refresh-Path
    }

    Step 'uv (installs Python and course-tools)'
    $bin = Join-Path $HOME '.local\bin'
    $loginPath = $env:Path
    $env:Path = "$bin;$env:Path"
    if (Get-Command uv -ErrorAction SilentlyContinue) {
        Write-Host (uv --version)
    } else {
        Invoke-RestMethod https://astral.sh/uv/install.ps1 -ErrorAction Stop | Invoke-Expression
        $env:Path = "$bin;$env:Path"
    }
    $uv = (Get-Command uv -ErrorAction Stop).Source

    Step 'course-tools'
    if ($LocalDir) {
        & $uv tool install --force --python $python --editable $LocalDir
    } else {
        & $uv tool install --force --python $python "git+https://github.com/SaxionACS/course-tools@$ref"
    }
    Run 'uv tool install'
    $course = Join-Path (& $uv tool dir --bin) 'course.exe'
    if (-not $env:UV_NO_MODIFY_PATH) {
        # Puts ~\.local\bin (where `course` is) on the user's PATH, if a new terminal would not have it.
        $session = $env:Path
        $env:Path = $loginPath
        & $uv tool update-shell
        $env:Path = $session
    }

    Step 'Quarto, PlantUML, Chrome Headless Shell and Graphviz'
    & $course setup
    Run 'course setup'

    Step 'Check'
    & $course doctor
    Run 'course doctor'

    Write-Host ''
    Write-Host 'Done. Open a new terminal (so PATH is updated), go to a course repository and run:'
    Write-Host '  course preview    # live preview at http://localhost:4200'
    Write-Host '  course build      # website + PDFs in dist\'
}

if ($Local -and -not $PSScriptRoot) {
    throw '-Local needs a clone: run install.ps1 from the clone with -File.'
}
Install-CourseTools $(if ($Local) { $PSScriptRoot } else { '' })
