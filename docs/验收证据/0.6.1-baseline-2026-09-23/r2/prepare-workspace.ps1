param(
    [string]$RunId = '061-20260923-a',
    [string]$Workspace
)
$ErrorActionPreference = 'Stop'
if ($RunId -notmatch '^061-\d{8}-[a-z0-9]+$') { throw '运行标记格式不正确' }
if (-not $Workspace) { $Workspace = Join-Path $env:TEMP "zhiliao-r2-$RunId" }
$workspacePath = [IO.Path]::GetFullPath($Workspace)
if (Test-Path -LiteralPath $workspacePath) { throw '目标已存在，请使用新目录和新运行标记' }
$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../../..')).Path
$manifestPath = Join-Path $PSScriptRoot '../candidate-inputs.json'
$identity = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot '../candidate-identity.json') | ConvertFrom-Json
if ((Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $identity.manifest_sha256) { throw '候选清单哈希不匹配' }
$manifest = Get-Content -Raw -Encoding UTF8 $manifestPath | ConvertFrom-Json
# 先核对全部输入，再复制到新目标；不读取环境文件、数据库或用户图片。
foreach ($entry in $manifest.files) {
    $sourcePath = [IO.Path]::GetFullPath((Join-Path $repository $entry.path))
    if (-not $sourcePath.StartsWith($repository + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw '输入路径越界' }
    if ((Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw "候选输入已变化：$($entry.path)" }
}
[IO.Directory]::CreateDirectory($workspacePath) | Out-Null
$contextPath = Join-Path $workspacePath 'context'
foreach ($entry in $manifest.files) {
    $targetPath = [IO.Path]::GetFullPath((Join-Path $contextPath $entry.path))
    if (-not $targetPath.StartsWith($contextPath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw '目标路径越界' }
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($targetPath)) | Out-Null
    Copy-Item -LiteralPath (Join-Path $repository $entry.path) -Destination $targetPath
    if ((Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw '复制后哈希不一致' }
}
Copy-Item -LiteralPath $PSScriptRoot -Destination (Join-Path $workspacePath 'package') -Recurse
Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $workspacePath 'candidate-inputs.json')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../candidate-identity.json') -Destination (Join-Path $workspacePath 'candidate-identity.json')
[IO.Directory]::CreateDirectory((Join-Path $workspacePath 'snapshot')) | Out-Null
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
function New-R2Secret {
    $secretBytes = New-Object byte[] 32
    $rng.GetBytes($secretBytes)
    return ([BitConverter]::ToString($secretBytes)).Replace('-', '').ToLowerInvariant()
}
$roles = @('source', 'import', 'restore')
for ($i = 0; $i -lt $roles.Count; $i++) {
    $role = $roles[$i]
    $artifacts = Join-Path $workspacePath $role
    [IO.Directory]::CreateDirectory($artifacts) | Out-Null
    $lines = @(
        "R2_IMAGE=$($identity.local_image_tag)", "R2_RUN=$RunId", "R2_ROLE=$role",
        "R2_PASSWORD=$(New-R2Secret)", "R2_SECRET=$(New-R2Secret)", "R2_PORT=$(3311 + $i)",
        "R2_PACKAGE=$((Join-Path $workspacePath 'package').Replace('\','/'))",
        "R2_ARTIFACTS=$($artifacts.Replace('\','/'))",
        "R2_SNAPSHOT=$((Join-Path $workspacePath 'snapshot').Replace('\','/'))"
    )
    [IO.File]::WriteAllText((Join-Path $workspacePath "$role.env"), ($lines -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
}
$rng.Dispose()
Write-Output "准备目录：$workspacePath"
Write-Output "候选：$($identity.local_image_tag)；输入 $($manifest.files.Count) 个文件；未调用 Docker。"
