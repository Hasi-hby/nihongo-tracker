"""Log Japanese time without opening the app.

    python tools/log.py Immersion 25 --md "Frieren S1E03"
    python tools/log.py Anki 1:30 --date 2026-10-18 --note "nachgetragen"

Writes one file into inbox/ of the data repo clone, commits and pushes it with the clone's
normal git login. The app picks it up on its next sync, moves it into logs/<year>.json and
deletes the inbox file. From other scripts:

    sys.path.insert(0, r"C:\\Users\\Nico\\OneDrive\\Desktop\\nihongo-tracker\\tools")
    from log import log
    log("Immersion", 24, md="Frieren S1E03", src="watch")
"""

import argparse
import json
import re
import secrets
import subprocess
import sys
import time
from datetime import date as Date
from pathlib import Path

DATA = Path(r"C:\Users\Nico\OneDrive\Desktop\nihongo-tracker-data")


def parse_minutes(text):
    """'25', '1:30', '1.5h', '1h30', '90min' -> minutes (same rules as the app)."""
    t = str(text).strip().lower().replace(",", ".")
    m = re.fullmatch(r"(\d+):(\d{1,2})", t)
    if m:
        return int(m[1]) * 60 + int(m[2])
    m = re.fullmatch(r"(\d+(?:\.\d+)?)\s*h(?:\s*(\d+)\s*(?:m|min)?)?", t)
    if m:
        return round(float(m[1]) * 60 + (int(m[2]) if m[2] else 0))
    m = re.fullmatch(r"(\d+(?:\.\d+)?)\s*(?:m|min)?", t)
    if m:
        v = float(m[1])
        return int(v) if v.is_integer() else v
    raise ValueError(f"Dauer nicht lesbar: {text!r} (z. B. 25, 1:30 oder 1.5h)")


def git(data, *args):
    return subprocess.run(["git", "-C", str(data), *args], check=True, capture_output=True, text=True, encoding="utf-8")


def log(a, m, *, md=None, note=None, date=None, src="cli", data=DATA):
    """Write one inbox entry and push it. Returns the entry. Raises on invalid input or git errors."""
    a = str(a).strip()
    if not a:
        raise ValueError("Aktivität fehlt")
    minutes = parse_minutes(m) if isinstance(m, str) else m
    if not 0 < minutes <= 1440:
        raise ValueError(f"Dauer muss zwischen 1 und 1440 Minuten liegen, nicht {minutes}")
    t = int(time.time() * 1000)
    entry = {"a": a, "m": minutes, "t": t, "src": src}
    if date:
        try:
            Date.fromisoformat(date)
        except ValueError:
            raise ValueError(f"Datum bitte als YYYY-MM-DD, nicht {date!r}") from None
        entry["d"] = date
    if md:
        entry["md"] = md
    if note:
        entry["n"] = note

    data = Path(data)
    name = f"{t}-{secrets.token_hex(3)}.json"
    rel = f"inbox/{name}"
    (data / "inbox").mkdir(exist_ok=True)
    (data / rel).write_text(json.dumps(entry, ensure_ascii=False) + "\n", encoding="utf-8")
    git(data, "add", rel)
    git(data, "commit", "--quiet", "-m", f"PC: +{minutes} min {a}", "--", rel)
    for attempt in range(3):
        try:
            git(data, "pull", "--rebase", "--autostash", "--quiet")
            git(data, "push", "--quiet")
            return entry
        except subprocess.CalledProcessError:
            if attempt == 2:
                raise
            time.sleep(2)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    p = argparse.ArgumentParser(description="Tsuzuku: Zeit loggen, ohne die App zu öffnen.")
    p.add_argument("activity", help="z. B. Immersion, Anki, Output")
    p.add_argument("minutes", help="z. B. 25, 1:30 oder 1.5h")
    p.add_argument("--md", help="Medium, z. B. 'Frieren S1E03'")
    p.add_argument("--note", help="Notiz")
    p.add_argument("--date", help="Tag (YYYY-MM-DD), Standard: jetzt")
    p.add_argument("--src", default="cli", help="Quelle, Standard: cli")
    p.add_argument("--data", default=str(DATA), help="Pfad zum Daten-Klon")
    args = p.parse_args()
    try:
        e = log(args.activity, args.minutes, md=args.md, note=args.note, date=args.date, src=args.src, data=args.data)
    except ValueError as err:
        sys.exit(f"Fehler: {err}")
    except subprocess.CalledProcessError as err:
        sys.exit(f"git {' '.join(err.cmd[3:])} fehlgeschlagen:\n{(err.stderr or err.stdout or '').strip()}\n"
                 "Der Eintrag ist lokal committet; ein späteres 'git push' im Daten-Klon holt ihn nach.")
    print(f"+{e['m']} min {e['a']}{' · ' + e['md'] if 'md' in e else ''} → inbox (wird beim nächsten Sync übernommen)")


if __name__ == "__main__":
    main()
