# Registers the hourly Windows scheduled task that runs tools/github-feed-sync.py.
# Run once in PowerShell on the PC that has the report folder:
#   powershell -ExecutionPolicy Bypass -File tools\install-github-feed-task.ps1
# Remove it again with:
#   Unregister-ScheduledTask -TaskName 'WorkBoard Github feed sync' -Confirm:$false
$ErrorActionPreference = 'Stop'

$script = Join-Path $PSScriptRoot 'github-feed-sync.py'
$python = (Get-Command python -ErrorAction Stop).Source
$pythonw = Join-Path (Split-Path $python) 'pythonw.exe'
if (-not (Test-Path $pythonw)) { $pythonw = $python }

$action = New-ScheduledTaskAction -Execute $pythonw -Argument "-X utf8 `"$script`"" -WorkingDirectory (Split-Path $PSScriptRoot)
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddHours(7).AddMinutes(40) -RepetitionInterval (New-TimeSpan -Hours 1)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName 'WorkBoard Github feed sync' -Force `
  -Description 'Rebuilds the Work Board Github feed from the report folder and uploads it to Supabase when it changed.' `
  -Action $action -Trigger $trigger -Settings $settings | Out-Null

Start-ScheduledTask -TaskName 'WorkBoard Github feed sync'
Start-Sleep -Seconds 20
Get-ScheduledTask -TaskName 'WorkBoard Github feed sync' | Get-ScheduledTaskInfo |
  Select-Object LastRunTime, LastTaskResult, NextRunTime | Format-List
$log = Join-Path $env:USERPROFILE '.workboard\github-feed-sync.log'
if (Test-Path $log) { Get-Content $log -Tail 3 }
