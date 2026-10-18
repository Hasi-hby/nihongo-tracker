// Rank badge: a faceted crystal in the rank's colour inside rotating rune rings.
// Higher ranks gain ornaments: studs from C, side blades from A, a crown from S,
// a second dark aura for the Shadow Monarch. Pure SVG, no assets.

let uid = 0;

function rgb(hex) {
  const x = parseInt(hex.slice(1), 16);
  return [(x >> 16) & 255, (x >> 8) & 255, x & 255];
}

/** amt < 0 darkens toward black, amt > 0 lightens toward white (|amt| <= 1). */
export function shade(hex, amt) {
  const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
  const [r, g, b] = rgb(hex).map((v) => Math.round(v + (t - v) * p));
  return `rgb(${r},${g},${b})`;
}

const C = 60; // viewBox centre
const pt = (r, deg) => [C + r * Math.cos((deg * Math.PI) / 180), C + r * Math.sin((deg * Math.PI) / 180)];
const hexagon = (r) => Array.from({ length: 6 }, (_, i) => pt(r, 60 * i - 90));
const poly = (ps) => ps.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');

// light comes from the top left
const FACET_LIGHT = [0.22, -0.12, -0.42, -0.3, 0.04, 0.42];

export function rankBadge(rank, tier, { size = 96, animated = true, title = true } = {}) {
  const id = `bdg${++uid}`, c = rank.color;
  const outer = hexagon(34), inner = hexagon(21);
  const anim = (cls) => (animated ? ` class="${cls}"` : '');
  const parts = [];

  parts.push(`<defs>
    <radialGradient id="${id}a"><stop offset="0" stop-color="${c}" stop-opacity=".6"/><stop offset=".55" stop-color="${c}" stop-opacity=".18"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>
    <linearGradient id="${id}t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${shade(c, 0.55)}"/><stop offset=".5" stop-color="${c}"/><stop offset="1" stop-color="${shade(c, -0.45)}"/></linearGradient>
    <linearGradient id="${id}w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(c, 0.35)}"/><stop offset="1" stop-color="${shade(c, -0.55)}"/></linearGradient>
    <linearGradient id="${id}l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="${shade(c, 0.7)}"/></linearGradient>
    <radialGradient id="${id}r"><stop offset=".3" stop-color="${shade(c, 0.5)}" stop-opacity=".9"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>
    <filter id="${id}g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <clipPath id="${id}c"><polygon points="${poly(outer)}"/></clipPath>
  </defs>`);

  // aura (+ a dark smoke ring for the Monarch)
  if (tier >= 7) parts.push(`<circle cx="60" cy="60" r="59" fill="none" stroke="#1e0b33" stroke-width="10" opacity=".8"/>`);
  parts.push(`<circle${anim('bdg-aura')} cx="60" cy="60" r="58" fill="url(#${id}a)"/>`);

  // light rays behind the crystal from B-rank on
  if (tier >= 3) {
    const rays = Array.from({ length: 12 }, (_, i) => {
      const a = i * 30;
      return `<polygon points="${poly([[C, C], pt(57, a - 4), pt(57, a + 4)])}"/>`;
    }).join('');
    parts.push(`<g${anim('bdg-spin-slow')} fill="url(#${id}r)" opacity="${tier >= 5 ? 0.5 : 0.32}">${rays}</g>`);
  }

  // rune rings
  parts.push(`<g${anim('bdg-spin')}><circle cx="60" cy="60" r="51" fill="none" stroke="${c}" stroke-width="2" stroke-dasharray="1.6 4.3" opacity=".75"/></g>`);
  parts.push(`<g${anim('bdg-spin-rev')}><circle cx="60" cy="60" r="46" fill="none" stroke="${shade(c, 0.3)}" stroke-width="1" stroke-dasharray="24 5 3 5" opacity=".55"/></g>`);

  // studs on the ring from C-rank on
  if (tier >= 2) {
    for (const a of tier >= 4 ? [90, 270] : [0, 90, 180, 270]) {
      const [x, y] = pt(51, a);
      parts.push(`<polygon points="${poly([[x, y - 4], [x + 3, y], [x, y + 4], [x - 3, y]])}" fill="${shade(c, 0.45)}" filter="url(#${id}g)"/>`);
    }
  }

  // crown spikes from S-rank on (behind the crystal)
  if (tier >= 5) {
    parts.push(`<polygon points="44,30 47,12 53,22 60,4 67,22 73,12 76,30" fill="url(#${id}w)" stroke="${shade(c, 0.5)}" stroke-width=".8" stroke-linejoin="round"/>`);
  }

  // side blades from A-rank on
  if (tier >= 4) {
    // two bevelled halves per blade: lit top, shaded bottom
    for (const s of [1, -1]) {
      const top = poly([[C + s * 26, 50], [C + s * 56, 39], [C + s * 45, 60], [C + s * 26, 60]]);
      const bottom = poly([[C + s * 26, 60], [C + s * 45, 60], [C + s * 56, 81], [C + s * 26, 70]]);
      parts.push(`<polygon points="${top}" fill="${shade(c, 0.28)}"/>`);
      parts.push(`<polygon points="${bottom}" fill="${shade(c, -0.38)}"/>`);
      parts.push(`<polygon points="${poly([[C + s * 26, 50], [C + s * 56, 39], [C + s * 45, 60], [C + s * 56, 81], [C + s * 26, 70]])}" fill="none" stroke="${shade(c, 0.55)}" stroke-width=".8" stroke-linejoin="round"/>`);
    }
  }

  // crystal: six facets around a gradient table
  parts.push(`<g filter="url(#${id}g)">`);
  outer.forEach((p, i) => {
    const q = outer[(i + 1) % 6], ip = inner[i], iq = inner[(i + 1) % 6];
    parts.push(`<polygon points="${poly([p, q, iq, ip])}" fill="${shade(c, FACET_LIGHT[i])}"/>`);
  });
  parts.push(`</g>`);
  parts.push(`<polygon points="${poly(inner)}" fill="url(#${id}t)"/>`);
  outer.forEach((p, i) => parts.push(`<line x1="${p[0].toFixed(2)}" y1="${p[1].toFixed(2)}" x2="${inner[i][0].toFixed(2)}" y2="${inner[i][1].toFixed(2)}" stroke="#fff" stroke-opacity=".22" stroke-width=".7"/>`));
  parts.push(`<polygon points="${poly(outer)}" fill="none" stroke="${shade(c, 0.6)}" stroke-width="1.4" stroke-linejoin="round"/>`);
  parts.push(`<polygon points="${poly(inner)}" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width=".8"/>`);

  // light sweep across the crystal
  if (animated) {
    parts.push(`<g clip-path="url(#${id}c)"><rect class="bdg-shine" x="0" y="10" width="14" height="100" fill="#fff" opacity=".35"/></g>`);
  }

  // rank letter
  parts.push(`<text x="60" y="61" text-anchor="middle" dominant-baseline="central" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif"
    font-weight="900" font-size="${rank.id.length > 1 ? 18 : 27}" fill="url(#${id}l)" stroke="${shade(c, -0.65)}" stroke-width="2.6" paint-order="stroke"
    filter="url(#${id}g)">${rank.id}</text>`);

  // twinkles
  if (animated) {
    const spark = (x, y, s, delay) => `<path class="bdg-spark" style="animation-delay:${delay}s" d="M${x} ${y - s}L${x + s * 0.28} ${y - s * 0.28}L${x + s} ${y}L${x + s * 0.28} ${y + s * 0.28}L${x} ${y + s}L${x - s * 0.28} ${y + s * 0.28}L${x - s} ${y}L${x - s * 0.28} ${y - s * 0.28}Z" fill="#fff"/>`;
    parts.push(spark(84, 30, 5, 0), spark(33, 84, 3.5, 1.4));
  }

  const label = title ? `<title>${rank.name}</title>` : '';
  // small badges zoom in on the crystal so the letter stays readable
  const view = size < 64 ? '14 14 92 92' : '0 0 120 120';
  return `<svg class="badge" viewBox="${view}" width="${size}" height="${size}" role="img" aria-label="${rank.name}">${label}${parts.join('')}</svg>`;
}
