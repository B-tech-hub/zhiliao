param(
  [string]$Project = "",
  [ValidateRange(1, 65535)]
  [int]$Port = 3322,
  [ValidateRange(1, 300)]
  [int]$StartupTimeoutSeconds = 120,
  [ValidateRange(1, 60)]
  [int]$RequestTimeoutSeconds = 10,
  [switch]$KeepResources,
  [switch]$IncludeSse,
  [switch]$IncludeNetwork,
  [string]$EvidencePath = ""
)

$ErrorActionPreference = "Stop"
# 保留 UTF-8 BOM，供 Windows PowerShell 5.1 正确读取中文。
if (-not (Get-Command node -CommandType Application -ErrorAction SilentlyContinue)) {
  throw "请先安装 Node.js 22 或更高版本。"
}

# 参数作为独立参数传递；脚本从自身位置解析仓库，不依赖调用目录。
$runtimeArgs = @(
  (Join-Path $PSScriptRoot "verify-demo-runtime.mjs"),
  "--port", [string]$Port,
  "--startup-timeout", [string]$StartupTimeoutSeconds,
  "--request-timeout", [string]$RequestTimeoutSeconds
)
if ($Project) { $runtimeArgs += @("--project", $Project) }
if ($KeepResources) { $runtimeArgs += "--keep-resources" }
if ($IncludeSse) { $runtimeArgs += "--include-sse" }
if ($IncludeNetwork) { $runtimeArgs += "--include-network" }
if ($EvidencePath) { $runtimeArgs += @("--evidence", $EvidencePath) }
& node @runtimeArgs
exit $LASTEXITCODE
