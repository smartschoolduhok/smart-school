# Registers (or replaces) a Windows scheduled task that runs the daily D1 backup.
# Runs as the current user only while logged on, so it uses the existing
# `wrangler login`; a run missed while the PC was off starts when it is next on.
param(
  [Parameter(Mandatory = $true)][string]$BackupRoot,
  [Parameter(Mandatory = $true)][string]$TargetFile,
  [string]$At = '02:00',
  [string]$NodePath = (Get-Command node -ErrorAction Stop).Source,
  [string]$TaskName = 'SmartSchool-Daily-D1-Backup'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$script = Join-Path $PSScriptRoot 'run-daily-backup.mjs'
foreach ($path in @($BackupRoot, $TargetFile, $NodePath, $script)) { if (-not (Test-Path $path)) { throw "Missing: $path" } }

$arguments = "--no-warnings `"$script`" --root `"$BackupRoot`" --target `"$TargetFile`""
$action = New-ScheduledTaskAction -Execute $NodePath -Argument $arguments -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'Smart School: daily D1 export, manifest, local restore proof and retention (7 daily / 4 weekly).' -Force | Out-Null
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State
