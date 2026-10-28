# Tsuzuku 続く

Eigener Japanisch-Time-Tracker als Ersatz für LingoTrack: Aktivitäten, Shortcuts, Timer, Heatmap, Graphen, Tages-Streak, eigene Tages-/Wochen-/Monatsziele und eine tägliche Chorus-Pflicht mit Nachholtag. Dunkles, schlichtes Design: fast schwarz mit Mint-Schimmer hinter der Streak, Schrift Sora (liegt unter `fonts/`, SIL Open Font License). Ein erfüllter Tag (Chorus + alle Tagesziele) zeigt „Tag erfüllt ✓“, darunter steht der nächste Stunden-Meilenstein.

**App:** https://hasi-hby.github.io/nihongo-tracker/
Am iPhone/iPad in Safari öffnen → Teilen → „Zum Home-Bildschirm“. Danach läuft die App wie eine normale App, auch offline.

## Wo die Daten liegen

| Ort | Was |
|---|---|
| Jedes Gerät (IndexedDB) | vollständige Kopie, jede Eingabe wird sofort lokal gespeichert, auch offline |
| `Hasi-hby/nihongo-tracker-data` (privat) | Sync zwischen den Geräten; jeder Sync ist ein Commit, also volle Versionshistorie |
| `Desktop\nihongo-tracker-data` | lokaler Klon, täglich per Task aktualisiert |
| `Desktop\nihongo-tracker\backup` | wöchentliche ZIP-Snapshots (12 Wochen) |

Klon und ZIPs liegen nur auf diesem PC (OneDrive synchronisiert hier nicht); außer den Geräten selbst ist das private GitHub-Repo die einzige Kopie außerhalb des PCs.

Dieses Repo enthält nur Code, keine Daten.

## Neuer Name und neues Icon auf dem iPhone/iPad

iOS übernimmt Name und Icon nur beim „Zum Home-Bildschirm“ und aktualisiert sie danach nicht. Die neue Optik kommt mit jedem Update von selbst, nur Icon und Beschriftung bleiben beim alten Stand, bis die App neu hinzugefügt wird. Beim Entfernen löscht iOS den Speicher der Web-App, also auch den Token:

1. In der alten App prüfen, dass die Sync-Pill „synchron“ zeigt.
2. Einen neuen Fine-grained Token erstellen (siehe unten).
3. Alte App vom Home-Bildschirm löschen, die Seite in Safari öffnen, Teilen → „Zum Home-Bildschirm“, Token einfügen.

## Gerät verbinden (einmal pro Gerät)

1. [Fine-grained Token erstellen](https://github.com/settings/personal-access-tokens/new):
   Repository access → *Only select repositories* → `nihongo-tracker-data`, Permissions → *Contents: Read and write*.
2. In der App: Einstellungen → Sync → Token einfügen → „Verbinden & testen“.

Der Token bleibt nur auf dem Gerät. Ein Token pro Gerät, damit man ein verlorenes Gerät einzeln sperren kann.

## Sync

- `meta.json`: Aktivitäten, Shortcuts, Ziele (`quests`), Einstellungen, Timer
- `logs/<jahr>.json`: Logs, ein Eintrag pro Zeile

- `inbox/<name>.json`: Logs von außerhalb der App (siehe unten), werden beim Sync übernommen und gelöscht

Jeder Eintrag hat `u` (letzte Änderung). Beim Zusammenführen gewinnt der neuere, Löschungen sind Tombstones (`x: 1`). Pull fragt zuerst nur per ETag nach Änderungen (304 = nichts zu tun), Push nutzt den letzten bekannten `sha`. Bei einem Konflikt wird neu gezogen, zusammengeführt und erneut gepusht.

## Loggen ohne App

Alles, was eine neue Datei in `inbox/` im Daten-Repo anlegt, wird beim nächsten Sync eines Geräts ein normaler Log. Eine neue Datei braucht keinen `sha`, kann also nie mit etwas kollidieren.

```json
{"a":"Immersion","m":20,"md":"Frieren S1E03","t":"2026-10-19T20:15:00+02:00","src":"siri"}
```

Pflicht sind nur `a` (Aktivität, Groß-/Kleinschreibung egal) und `m` (Minuten, auch `"1:30"`). `t` ist ein ISO-Datum oder ein Unix-Zeitstempel; fehlt er, gilt ein Zeitstempel am Anfang des Dateinamens, sonst der Zeitpunkt des Syncs. `d` (Tag), `n` (Notiz), `md` (Medium) und `src` (Quelle) sind optional. Mehrere Einträge in einer Datei: `{"logs":[…]}`.

Die App übernimmt die Einträge mit fester ID `ib-<dateiname>` (zwei Geräte erzeugen also denselben Log), schreibt sie in `logs/<jahr>.json` und löscht die Inbox-Datei erst danach. Unlesbare Dateien bleiben liegen und werden in der Sync-Zeile gemeldet.

### Vom PC

```bash
python tools/log.py Immersion 25 --md "Frieren S1E03"
```

Schreibt die Datei in den Daten-Klon und pusht sie mit dem normalen Git-Login. Aus anderen Python-Skripten: `from log import log`, dann `log("Immersion", 24, md="…", src="watch")`.

### iOS-Kurzbefehl (Siri, Widget, Apple Watch, NFC)

1. [Fine-grained Token](https://github.com/settings/personal-access-tokens/new) „Tsuzuku Kurzbefehl“: nur `nihongo-tracker-data`, *Contents: Read and write*.
2. Kurzbefehle-App → neuer Kurzbefehl, z. B. „Japanisch loggen“:
   1. **Nach Eingabe fragen** (Zahl, „Wie viele Minuten?“). Für einen 1-Tipp-Log stattdessen eine feste Zahl.
   2. **Wörterbuch**: `a` = Immersion (Text), `m` = Eingabe (Zahl), `t` = Aktuelles Datum im Format ISO 8601 (Text), `src` = siri, optional `md`.
   3. **Base64-Codierung** auf das Wörterbuch, Zeilenumbrüche *Keine*. (Liefert das keinen JSON-Text, davor eine Aktion **Text** mit dem Wörterbuch einfügen.)
   4. **Inhalt von URL abrufen**: `https://api.github.com/repos/Hasi-hby/nihongo-tracker-data/contents/inbox/` + Aktuelles Datum (Benutzerdefiniert `yyyyMMdd-HHmmss`) + `.json`; Methode **PUT**; Header `Authorization` = `Bearer <Token>` und `Accept` = `application/vnd.github+json`; Hauptteil **JSON** mit `message` = Kurzbefehl und `content` = Base64-Text.
3. Starten per Siri (Name des Kurzbefehls), Kurzbefehle-Widget auf dem Home-Bildschirm, Apple Watch („Auf Apple Watch anzeigen“) oder Automation → NFC.

Antwortet GitHub mit `201 Created`, liegt der Eintrag in der Inbox.

## Anki-Empfehlungen (nur am PC)

Auf dem Windows-PC zeigt „Heute“ eine Karte **Anki-Empfehlungen**: YouTube-, TVer- und Netflix-Content, in dem die Anki-Wörter, mit denen du gerade kämpfst, oft vorkommen, plus Buttons für einen neuen Lauf (Alles aktualisieren, ohne TVer, Neu sortieren, Geschmack auffrischen) und ein Link zum ganzen Bericht. „✓ gesehen“ (bzw. „Serie“ bei TVer/Netflix) blendet einen Vorschlag dauerhaft aus; was im YouTube-/TVer-/Netflix-Verlauf steht, schlägt das Skript ohnehin nicht mehr vor.

Eine Webseite darf keine Programme starten, deshalb macht das ein kleiner Helfer im jp-Ordner: `jp\technical\scripts\tsuzuku_helper.py` (Port 8796, nur `127.0.0.1`, nur vier feste Befehle, nimmt sie nur von dieser App an). Er startet mit `jp\technical\scripts\register_helper_task.ps1` bei jeder Anmeldung ohne Fenster, sonst über `Anki-Empfehlungen.bat` auf dem Desktop → Taste 7. Fragt der Browser beim ersten Mal, ob Tsuzuku auf Apps auf diesem Gerät zugreifen darf: erlauben. Am iPhone/iPad und ohne Helfer bleibt die Karte weg (bzw. zeigt am PC, wie man ihn startet). Code: `js/pc.js`, Karte in `ankiCard()` in `js/app.js`.

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

Backup-Task einrichten: `powershell -File tools/register_backup_task.ps1`. Er zieht täglich das Daten-Repo, legt wöchentliche ZIPs an und warnt per Windows-Benachrichtigung, wenn Logs oder Stunden gegenüber dem letzten Lauf um mehr als 1 % geschrumpft sind (Vergleichswerte in `backup\stats.json`).
