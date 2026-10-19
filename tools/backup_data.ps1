# Pulls the private data repo into its OneDrive clone and keeps weekly ZIP snapshots.
# Run by the scheduled task from register_backup_task.ps1; safe to run by hand any time.

param(
    [string]$DataDir = "C:\Users\Nico\OneDrive\Desktop\nihongo-tracker-data",
    [string]$BackupDir = "C:\Users\Nico\OneDrive\Desktop\nihongo-tracker\backup",
    [int]$Keep = 12
)

$ErrorActionPreference = "Continue"
New-Item -ItemType Directory -Force $BackupDir | Out-Null
$log = Join-Path $BackupDir "backup.log"
function Log($msg) { "$(Get-Date -Format s)  $msg" | Add-Content -Path $log -Encoding UTF8 }

# Windows notification; only logs if toasts are unavailable (e.g. no interactive session).
function Toast($title, $text) {
    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
        $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
        $t = [Security.SecurityElement]::Escape($title); $b = [Security.SecurityElement]::Escape($text)
        $xml.LoadXml("<toast><visual><binding template=`"ToastGeneric`"><text>$t</text><text>$b</text></binding></visual></toast>")
        $app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($xml))
    } catch {
        Log "Toast nicht moeglich: $($_.Exception.Message)"
    }
}

$out = & git -C $DataDir pull --ff-only 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) {
    Log "FEHLER git pull ($LASTEXITCODE): $($out.Trim())"
    Toast "Nihongo Hunter Backup" "git pull fehlgeschlagen, siehe backup\backup.log"
    exit 1
}

# Plausibility: live logs and total minutes should never drop noticeably from one run to the next.
# A drop of more than 1 % warns once (the new values become the reference). Git history and the
# weekly ZIPs still hold the old state.
try {
    $count = 0; $minutes = 0.0
    foreach ($f in Get-ChildItem (Join-Path $DataDir "logs") -Filter "*.json") {
        $j = Get-Content $f.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($l in $j.logs) { if (-not $l.x) { $count++; $minutes += [double]$l.m } }
    }
    $statsFile = Join-Path $BackupDir "stats.json"
    if (Test-Path $statsFile) {
        $prev = Get-Content $statsFile -Raw | ConvertFrom-Json
        if ($count -lt 0.99 * $prev.count -or $minutes -lt 0.99 * $prev.minutes) {
            $msg = "Logs $($prev.count) -> $count, Stunden $([math]::Round($prev.minutes / 60, 1)) -> $([math]::Round($minutes / 60, 1))"
            Log "WARNUNG Daten geschrumpft seit $($prev.date): $msg"
            Toast "Nihongo Hunter: Daten geschrumpft" "$msg. Alte Staende liegen in der Git-Historie und den Wochen-ZIPs."
        }
    }
    @{ date = (Get-Date -Format s); count = $count; minutes = [math]::Round($minutes, 2) } | ConvertTo-Json | Set-Content $statsFile -Encoding UTF8
} catch {
    Log "FEHLER Plausibilitaetscheck: $($_.Exception.Message)"
}

# One snapshot per week, named after that week's Monday.
$today = Get-Date
$monday = $today.AddDays(-(([int]$today.DayOfWeek + 6) % 7)).ToString("yyyy-MM-dd")
$zip = Join-Path $BackupDir "nihongo-data-$monday.zip"
if (-not (Test-Path $zip)) {
    Compress-Archive -Path (Join-Path $DataDir "meta.json"), (Join-Path $DataDir "logs") -DestinationPath $zip
    Log "Snapshot $zip"
}

Get-ChildItem $BackupDir -Filter "nihongo-data-*.zip" | Sort-Object Name -Descending |
    Select-Object -Skip $Keep | Remove-Item -Confirm:$false

Log "OK $($out.Trim() -replace '\s+', ' ')"
