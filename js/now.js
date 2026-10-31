// The "Jetzt 5 Minuten?" card: one prepared thing to open right away, and a smaller swap for the
// excuse of the moment. The picks are the Anki recommendations (pc.js) plus the Radio-Abo episodes
// on the phone; the PC uploads both to the data repo as picks.json, so every device has them.

const WEB = ['youtube', 'tver', 'netflix']; // local files (file://) do not open from a web page
const MAX = 40;
const SHORT = 25; // minutes: "no time right now"
const expired = (p, now) => !!p.until && p.until * 1000 <= now;

/**
 * VLC on the phone streams an episode straight from its OneDrive link (radio_abo.py shares each file).
 * Without a link it can only be brought up: VLC has no address for a file in its own library.
 */
export const vlcUrl = (url) => (url ? `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(url)}` : 'vlc-x-callback://x-callback-url/');
export const streams = (p) => p.url.includes('/stream?');

/** The recommendations as they go into picks.json: playable on every device, a few fields each. */
export function slimPicks(data, now = Date.now(), radio = null) {
  const picks = (data?.picks || [])
    .filter((p) => p.id && p.url && !p.hidden && WEB.includes(p.source) && !expired(p, now))
    .slice(0, MAX)
    .map(({ id, source, series, title, url, minutes, coverage, until }) => ({ id, source, series, title, url, minutes, coverage, until: until || null }));
  const eps = (radio || []).filter((e) => e.id)
    .map((e) => ({ id: `radio:${e.id}`, source: 'radio', series: e.show, title: e.title, url: vlcUrl(e.url), minutes: e.minutes }));
  return { updated: data?.updated || '', picks, ...(eps.length && { radio: eps }) };
}

export const NOW_REASONS = [
  { id: 'time', label: 'Keine Zeit gerade' },
  { id: 'else', label: 'Erst noch kurz was anderes' },
  { id: 'what', label: 'Weiß nicht, was' },
  { id: 'radio', label: 'Bin unterwegs / nur hören' },
];

/**
 * One pick for the card, skipping the ids in `skip` (started or turned down) and expired ones.
 * No reason: the best one, in the script's order. 'time': the best one of at most 25 min, else the
 * shortest. 'else': the easiest YouTube video (highest coverage), the closest swap for "just a bit
 * of YouTube first". 'what': the best one from another series than `shown`. 'radio': the oldest
 * Radio-Abo episode; every other reason leaves the episodes out.
 */
export function choosePick(picks, { reason = '', skip = [], shown = null, now = Date.now() } = {}) {
  const skipped = new Set(skip), radio = reason === 'radio';
  const list = (picks || []).filter((p) => (p.source === 'radio') === radio && !skipped.has(p.id) && !expired(p, now));
  if (!list.length) return null;
  if (reason === 'time') return list.find((p) => p.minutes <= SHORT) || [...list].sort((a, b) => a.minutes - b.minutes)[0];
  if (reason === 'else') {
    const yt = list.filter((p) => p.source === 'youtube');
    return [...(yt.length ? yt : list)].sort((a, b) => b.coverage - a.coverage)[0];
  }
  if (reason === 'what' && shown) {
    const series = (p) => p.series || p.title;
    return list.find((p) => series(p) !== series(shown)) || list[0];
  }
  return list[0];
}
