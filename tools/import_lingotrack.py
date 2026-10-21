"""Import a LingoTrack export ZIP into the Tsuzuku data folder.

Usage:
    python tools/import_lingotrack.py <lingotrack-export.zip> <data-dir>

<data-dir> is the local clone of the private data repo (nihongo-tracker-data).
The import is idempotent: every log gets the stable id "lt-<LingoTrack id>",
and existing files are merged by id (newer "u" wins), so running it again
after more LingoTrack logging only adds what is new. Logs edited in the app
keep their edits, because imported logs carry u = their original timestamp.

Prints the same check values as the LingoTrack dashboard so they can be
compared before committing.
"""

import csv
import datetime as dt
import io
import json
import sys
import zipfile
from collections import Counter
from pathlib import Path

UTC = dt.timezone.utc

# LingoTrack names (trimmed, lower-case) -> (activity name, note)
ACTIVITY_MAP = {
    "immersion": ("Immersion", None),
    "passive immersion": ("passive immersion", None),
    "anki": ("Anki", None),
    "anki-may": ("Anki", "Sammel-Log Mai 2025 (LingoTrack: Anki-May)"),
    "anki-june": ("Anki", "Sammel-Log Juni 2025 (LingoTrack: Anki-June)"),
    "anki/immersion": ("Anki/immersion", None),
    "phonetic training": ("phonetic training", None),
    "sentence mining": ("sentence mining", None),
    "output": ("Output", None),
}

# name, color, attribute (LingoTrack "types" in the export)
DEFAULT_ACTIVITIES = [
    ("Immersion", "#165e83", "listen"),
    ("passive immersion", "#89c3eb", "listen"),
    ("Anki", "#d0af4c", "memory"),
    ("Output", "#e16b8c", "output"),
    ("phonetic training", "#7058a3", "pron"),
    ("Anki/immersion", "#7ebea5", "listen"),
    ("sentence mining", "#c39143", "memory"),
]

DEFAULT_SHORTCUTS = [("Anki", 15), ("Immersion", 20), ("Output", 15),
                     ("passive immersion", 20), ("phonetic training", 10)]


def last_sunday(year, month):
    d = (dt.datetime(year, month + 1, 1, tzinfo=UTC) - dt.timedelta(days=1)
         if month < 12 else dt.datetime(year, 12, 31, tzinfo=UTC))
    while d.weekday() != 6:
        d -= dt.timedelta(days=1)
    return d.replace(hour=1)


def to_berlin(t):
    """UTC -> Europe/Berlin wall time (EU DST rule), without needing tzdata."""
    start, end = last_sunday(t.year, 3), last_sunday(t.year, 10)
    return t + dt.timedelta(hours=2 if start <= t < end else 1)


def read_logs(zip_path):
    with zipfile.ZipFile(zip_path) as z:
        raw = z.read("activity_logs.csv").decode("utf-8-sig")
        media = z.read("media_logs.csv").decode("utf-8-sig") if "media_logs.csv" in z.namelist() else ""
    rows = list(csv.DictReader(io.StringIO(raw)))
    media_rows = list(csv.DictReader(io.StringIO(media))) if media else []

    logs, unknown = [], Counter()
    for r in rows:
        key = r["action"].strip().lower()
        name, note = ACTIVITY_MAP.get(key, (r["action"].strip(), None))
        if key not in ACTIVITY_MAP:
            unknown[name] += 1
        logs.append(make_log("lt-" + r["id"], r["timestamp_utc"], name, r["minutes"], note))
    for r in media_rows:
        log = make_log("ltm-" + r["id"], r["timestamp_utc"], "Immersion", r["minutes"], None)
        log["md"] = r["media_name"]
        logs.append(log)
    return logs, unknown


def make_log(log_id, ts, activity, minutes, note):
    t = dt.datetime.fromisoformat(ts.replace("Z", "+00:00"))
    ms = int(t.timestamp() * 1000)
    log = {"id": log_id, "d": to_berlin(t).date().isoformat(), "t": ms,
           "a": activity, "m": round(float(minutes), 2), "src": "lt", "u": ms}
    if log["m"] == int(log["m"]):
        log["m"] = int(log["m"])
    if note:
        log["n"] = note
    return log


def write_log_file(path, logs):
    logs = sorted(logs, key=lambda l: (l["t"], l["id"]))
    lines = [json.dumps(l, ensure_ascii=False, separators=(",", ":")) for l in logs]
    path.write_text('{"v":1,"logs":[\n' + ",\n".join(lines) + "\n]}\n", encoding="utf-8")


def merge_into(existing, incoming):
    by_id = {l["id"]: l for l in existing}
    for l in incoming:
        cur = by_id.get(l["id"])
        if cur is None or l["u"] > cur["u"]:
            by_id[l["id"]] = l
    return list(by_id.values())


def default_meta(now_ms):
    return {
        "v": 1,
        "activities": [{"id": n, "name": n, "color": c, "attr": a, "o": i, "u": now_ms}
                       for i, (n, c, a) in enumerate(DEFAULT_ACTIVITIES)],
        "shortcuts": [{"id": f"s{i + 1}", "a": a, "m": m, "o": i, "u": now_ms}
                      for i, (a, m) in enumerate(DEFAULT_SHORTCUTS)],
        "quests": [],
        "settings": {"dayEnd": 0, "weekStart": 1, "u": now_ms},
        "timer": {"state": "idle", "u": 0},
    }


def check_values(logs):
    live = [l for l in logs if not l.get("x")]
    per_day = Counter()
    for l in live:
        per_day[l["d"]] += l["m"]
    days = sorted(dt.date.fromisoformat(d) for d in per_day)
    longest = cur = 1 if days else 0
    for a, b in zip(days, days[1:]):
        cur = cur + 1 if (b - a).days == 1 else 1
        longest = max(longest, cur)
    current = 1 if days else 0
    for i in range(len(days) - 1, 0, -1):
        if (days[i] - days[i - 1]).days != 1:
            break
        current += 1
    total = sum(l["m"] for l in live)
    print(f"Logs:            {len(live)}")
    print(f"Gesamtzeit:      {total / 60:,.1f} h".replace(",", "X").replace(".", ",").replace("X", "."))
    print(f"Tage geloggt:    {len(days)}")
    print(f"Längster Streak: {longest}")
    print(f"Streak bis {days[-1] if days else '-'}: {current}")
    acts = Counter()
    for l in live:
        acts[l["a"]] += l["m"]
    for a, m in acts.most_common():
        print(f"  {a:<20} {m / 60:8.1f} h")


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    zip_path, data_dir = Path(sys.argv[1]), Path(sys.argv[2])
    logs, unknown = read_logs(zip_path)
    if unknown:
        print("Hinweis: unbekannte Aktivitäten übernommen:", dict(unknown))

    (data_dir / "logs").mkdir(parents=True, exist_ok=True)
    by_year = {}
    for l in logs:
        by_year.setdefault(l["d"][:4], []).append(l)

    all_logs = []
    for year, year_logs in sorted(by_year.items()):
        path = data_dir / "logs" / f"{year}.json"
        existing = json.loads(path.read_text(encoding="utf-8"))["logs"] if path.exists() else []
        merged = merge_into(existing, year_logs)
        write_log_file(path, merged)
        all_logs.extend(merged)
        print(f"{path.name}: {len(merged)} Einträge")

    meta_path = data_dir / "meta.json"
    if not meta_path.exists():
        now_ms = int(dt.datetime.now(UTC).timestamp() * 1000)
        meta_path.write_text(json.dumps(default_meta(now_ms), ensure_ascii=False, indent=1) + "\n",
                             encoding="utf-8")
        print("meta.json angelegt")

    print()
    check_values(all_logs)


if __name__ == "__main__":
    main()
