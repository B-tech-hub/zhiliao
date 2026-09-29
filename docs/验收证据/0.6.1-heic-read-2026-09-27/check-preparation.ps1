$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../..')).Path
$prepare = Join-Path $PSScriptRoot '../0.6.1-baseline-2026-09-23/r2/prepare-workspace.ps1'
$compare = Join-Path $PSScriptRoot '../0.6.1-baseline-2026-09-23/r2/compare.py'
$identity = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'candidate-identity.json') | ConvertFrom-Json
$testRoot = Join-Path $env:TEMP ('zhiliao-r2-local-heic-' + [guid]::NewGuid().ToString('N'))
$testWorkspace = Join-Path $testRoot 'prepared'
$result = [ordered]@{ status = 'pending'; docker_invoked = $false; real_run_created = $false }
try {
    & $prepare -RunId '061-20260927-localheic' -Workspace $testWorkspace -CandidateDirectory $PSScriptRoot | Out-Null
    if (-not (Test-Path -LiteralPath (Join-Path $testWorkspace 'context'))) { throw 'context missing' }
    & py -3 $compare manifest (Join-Path $testWorkspace 'candidate-inputs.json') (Join-Path $testWorkspace 'context')
    if ($LASTEXITCODE -ne 0) { throw 'manifest comparison failed' }
    foreach ($role in 'source', 'import', 'restore') {
        $lines = [IO.File]::ReadAllLines((Join-Path $testWorkspace "$role.env"))
        if ($lines -notcontains "R2_IMAGE=$($identity.local_image_tag)") { throw 'image identity mismatch' }
    }
    $result['candidate_files'] = $identity.file_count
    $result['copied_manifest_passed'] = $true
    $result['three_env_images_match'] = $true
    try {
        & $prepare -RunId '061-20260927-localheic' -Workspace $testWorkspace -CandidateDirectory $PSScriptRoot | Out-Null
        throw 'existing workspace accepted'
    } catch {
        if ($_.Exception.Message -eq 'existing workspace accepted') { throw }
        $result['existing_workspace_rejected'] = $true
    }
    $oldTarget = Join-Path $testRoot 'old-identity'
    try {
        & $prepare -RunId '061-20260927-localheic' -Workspace $oldTarget -CandidateDirectory (Join-Path $PSScriptRoot '../0.6.1-registry-2026-09-27') | Out-Null
        throw 'old identity accepted'
    } catch {
        if ($_.Exception.Message -eq 'old identity accepted' -or (Test-Path -LiteralPath $oldTarget)) { throw }
        $result['old_identity_rejected_before_copy'] = $true
    }
    $result['status'] = 'passed'
} finally {
    if (Test-Path -LiteralPath $testRoot) {
        $cleanup = (Resolve-Path -LiteralPath $testRoot).Path
        $tempPrefix = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
        if (-not $cleanup.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($cleanup) -notlike 'zhiliao-r2-local-heic-*') { throw 'cleanup outside test directory' }
        Remove-Item -LiteralPath $cleanup -Recurse -Force
    }
}
$result['temporary_workspace_removed'] = -not (Test-Path -LiteralPath $testRoot)
$json = ($result | ConvertTo-Json) -replace "`r`n", "`n"
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'preparation-check.json'), $json + "`n", [Text.UTF8Encoding]::new($false))
$json
