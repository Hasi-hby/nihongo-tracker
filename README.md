# Nihongo Hunter

Eigener Japanisch-Time-Tracker als Ersatz für LingoTrack: Activities, Shortcuts, Timer, Heatmap, Graphen, Tages-Streak mit Streak-Freeze, Daily/Weekly Quests und ein Hunter-Rang-System im Solo-Leveling-Stil.

**App:** https://hasi-hby.github.io/nihongo-tracker/
Am iPhone/iPad in Safari öffnen → Teilen → „Zum Home-Bildschirm“. Danach läuft die App wie eine normale App, auch offline.

## Wo die Daten liegen

| Ort | Was |
|---|---|
| Jedes Gerät (IndexedDB) | vollständige Kopie, jede Eingabe wird sofort lokal gespeichert, auch offline |
| `Hasi-hby/nihongo-tracker-data` (privat) | Sync zwischen den Geräten; jeder Sync ist ein Commit, also volle Versionshistorie |
| `Desktop\nihongo-tracker-data` (OneDrive) | lokaler Klon, täglich per Task aktualisiert |
| `Desktop\nihongo-tracker\backup` (OneDrive) | wöchentliche ZIP-Snapshots (12 Wochen) |

Dieses Repo enthält nur Code, keine Daten.

## Gerät verbinden (einmal pro Gerät)

1. [Fine-grained Token erstellen](https://github.com/settings/personal-access-tokens/new):
   Repository access → *Only select repositories* → `nihongo-tracker-data`, Permissions → *Contents: Read and write*.
2. In der App: Einstellungen → Sync → Token einfügen → „Verbinden & testen“.

Der Token bleibt nur auf dem Gerät. Ein Token pro Gerät, damit man ein verlorenes Gerät einzeln sperren kann.

## Sync

- `meta.json`: Aktivitäten, Shortcuts, Quests, Einstellungen, Timer
- `logs/<jahr>.json`: Logs, ein Eintrag pro Zeile

Jeder Eintrag hat `u` (letzte Änderung). Beim Zusammenführen gewinnt der neuere, Löschungen sind Tombstones (`x: 1`). Pull fragt zuerst nur per ETag nach Änderungen (304 = nichts zu tun), Push nutzt den letzten bekannten `sha`. Bei einem Konflikt wird neu gezogen, zusammengeführt und erneut gepusht.

## LingoTrack-Import

```bash
python tools/import_lingotrack.py lingotrack-export.zip ../nihongo-tracker-data
```

Den Export gibt es auf LingoTrack unter Settings → Preferences → „Export my data“. Der Import ist idempotent (IDs `lt-<id>`), er kann also nach weiterem Loggen in LingoTrack einfach wiederholt werden. Danach im Daten-Klon committen und pushen.

## Entwicklung

```bash
npm test
```

Keine Abhängigkeiten, kein Build. Lokal starten: `python -m http.server` im Ordner und `http://localhost:8000` öffnen.

Backup-Task einrichten: `powershell -File tools/register_backup_task.ps1`
