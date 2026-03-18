$ErrorActionPreference = "SilentlyContinue"

function Test-ClaudeMemManagedProcess {
	param(
		[int]$WorkerProcessId,
		[string]$ExpectedWorkerPath
	)

	if ($WorkerProcessId -le 0) {
		return $false
	}

	$process = Get-CimInstance Win32_Process -Filter "ProcessId = $WorkerProcessId" -ErrorAction SilentlyContinue
	if ($null -eq $process) {
		return $false
	}

	$commandLine = [string]$process.CommandLine
	if ([string]::IsNullOrWhiteSpace($commandLine)) {
		return $false
	}

	$normalizedCommandLine = $commandLine.ToLowerInvariant()

	if (-not $normalizedCommandLine.Contains("opencode-daemon")) {
		return $false
	}

	if (-not $normalizedCommandLine.Contains("worker-service.cjs")) {
		return $false
	}

	if (-not [string]::IsNullOrWhiteSpace($ExpectedWorkerPath)) {
		$normalizedExpectedPath = $ExpectedWorkerPath.ToLowerInvariant().Replace("/", "\\")
		if (-not $normalizedCommandLine.Contains($normalizedExpectedPath)) {
			return $false
		}
	}

	if (-not $normalizedCommandLine.Contains("claude-mem-for-opencode")) {
		return $false
	}

	return $true
}

function Add-TargetPid {
	param(
		[System.Collections.Generic.HashSet[int]]$PidSet,
		[int]$WorkerProcessId,
		[string]$ExpectedWorkerPath
	)

	if (Test-ClaudeMemManagedProcess -WorkerProcessId $WorkerProcessId -ExpectedWorkerPath $ExpectedWorkerPath) {
		[void]$PidSet.Add($WorkerProcessId)
	}
}

$stateDir = Join-Path $HOME ".claude-mem\opencode-worker-state"
$pluginRoot = Split-Path -Path $PSScriptRoot -Parent
$expectedWorkerPath = Join-Path $pluginRoot "vendor\claude-mem\plugin\scripts\worker-service.cjs"
$expectedWorkerPath = $expectedWorkerPath.Replace("/", "\\")

$targetPids = [System.Collections.Generic.HashSet[int]]::new()

# 1) Read state files first
if (Test-Path $stateDir) {
	Get-ChildItem -Path $stateDir -Filter "*.json" -File | ForEach-Object {
		try {
			$state = Get-Content -Path $_.FullName -Raw | ConvertFrom-Json
			if ($null -ne $state -and $null -ne $state.pid) {
				$workerPidValue = [int]$state.pid
				Add-TargetPid -PidSet $targetPids -WorkerProcessId $workerPidValue -ExpectedWorkerPath $expectedWorkerPath
			}
		}
		catch {
		}
	}
}

# 2) Fallback: scan listener ports and verify ownership
$ports = 37777..37796
foreach ($port in $ports) {
	Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
		Add-TargetPid -PidSet $targetPids -WorkerProcessId ([int]$_.OwningProcess) -ExpectedWorkerPath $expectedWorkerPath
	}
}

if ($targetPids.Count -eq 0) {
	Write-Output "[claude-mem] No managed worker process found for safe restart."
	Write-Output "[claude-mem] If you still have a stale TCP listener, restart network stack or machine."
	exit 0
}

$killed = New-Object System.Collections.Generic.List[int]
foreach ($workerPid in $targetPids) {
	try {
		Stop-Process -Id $workerPid -Force -ErrorAction Stop
		$killed.Add($workerPid) | Out-Null
	}
	catch {
	}
}

if (Test-Path $stateDir) {
	# Remove state files/locks for killed workers
	Get-ChildItem -Path $stateDir -Filter "*.json" -File | ForEach-Object {
		try {
			$state = Get-Content -Path $_.FullName -Raw | ConvertFrom-Json
			if ($null -ne $state -and $null -ne $state.pid -and $killed.Contains([int]$state.pid)) {
				Remove-Item -Path $_.FullName -Force -ErrorAction SilentlyContinue
			}
		}
		catch {
		}
	}

	Get-ChildItem -Path $stateDir -Filter "*.lock" -Directory | ForEach-Object {
		Remove-Item -Path $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
	}
}

if ($killed.Count -gt 0) {
	Write-Output "[claude-mem] Restarted worker, killed PID(s): $($killed -join ', ')"
	Write-Output "[claude-mem] Worker will auto-start on next hook/tool call."
}
else {
	Write-Output "[claude-mem] No managed worker was killed (it may have exited already)."
}
