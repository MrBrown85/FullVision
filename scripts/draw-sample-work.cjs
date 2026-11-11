// scripts/draw-sample-work.cjs
//
// What it makes: the drawn pages of student work that Demo Mode's sample
// class shows on the Cell Microscope Lab assessment (slice S5-F5, PR 1035).
// Each page is a JPEG under assets/sample-work/ (for example
// cell-lab-jordan-1.jpg), with a 200 px thumbnail beside it
// (cell-lab-jordan-1-thumb.jpg). The pages are synthetic: drawn here, from no
// real student's work.
//
// How to run it: `node scripts/draw-sample-work.cjs`. It prints the name of
// each page it wrote. The two absolute paths just below this header (the
// `require` of playwright and `OUT`) are those of the session that first ran
// it; point them at your own checkout's node_modules/playwright and
// assets/sample-work/ first.
//
// What it needs:
// - The `playwright` package. It is in node_modules because @playwright/test
//   depends on it, but it is not listed in package.json itself.
// - Playwright's Chromium (`npx playwright install chromium`).
// - macOS. `sips` makes the thumbnails (without it the script stops after the
//   first page), and the handwriting fonts (Marker Felt, Bradley Hand,
//   Chalkboard SE, Noteworthy) come with macOS.
//
// Kept as it was when the sample pages were drawn, apart from this header.

// Draws Demo Mode's sample pages of student work (S5-F5) as JPEGs.
// Synthetic: drawn here, no real student's work. Run with node; writes into
// the worktree's assets/sample-work/.
const { chromium } = require('/Users/brown_colin/FullVision/node_modules/playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const OUT = '/Users/brown_colin/FullVision/.claude/worktrees/agent-aed6c9fb048f32b71/assets/sample-work';
fs.mkdirSync(OUT, { recursive: true });

const W = 900;
const H = 1200;

function wobble(cx, cy, rx, ry, seed, n = 18) {
  let s = seed;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280 - 0.5;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push([cx + Math.cos(t) * rx * (1 + rnd() * 0.12), cy + Math.sin(t) * ry * (1 + rnd() * 0.12)]);
  }
  return 'M' + pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L') + ' Z';
}

function onionCells(ox, oy, ink, seed) {
  let out = '';
  let s = seed;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 3; c++) {
      const x = ox - 105 + c * 70 + (r % 2) * 35 + rnd() * 6;
      const y = oy - 95 + r * 46 + rnd() * 4;
      out += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="66" height="42" rx="4" fill="none" stroke="${ink}" stroke-width="2.2"/>`;
      out += `<ellipse cx="${(x + 20 + rnd() * 24).toFixed(1)}" cy="${(y + 21).toFixed(1)}" rx="7" ry="6" fill="${ink}" opacity="0.75"/>`;
    }
  }
  return out;
}

function cheekCells(ox, oy, ink, seed) {
  let out = '';
  const spots = [
    [-60, -50, 46, 36],
    [45, -35, 40, 34],
    [-30, 50, 44, 32],
    [60, 55, 34, 30],
  ];
  spots.forEach((p, i) => {
    out += `<path d="${wobble(ox + p[0], oy + p[1], p[2], p[3], seed + i * 7)}" fill="none" stroke="${ink}" stroke-width="2.2"/>`;
    out += `<circle cx="${ox + p[0] + 4}" cy="${oy + p[1] - 2}" r="7" fill="${ink}" opacity="0.75"/>`;
  });
  return out;
}

function pageOne(p) {
  const ink = p.ink;
  const view = (cx, cy, inner, title, labels) => `
    <circle cx="${cx}" cy="${cy}" r="150" fill="#fffef9" stroke="${ink}" stroke-width="3"/>
    <clipPath id="c${cx}"><circle cx="${cx}" cy="${cy}" r="146"/></clipPath>
    <g clip-path="url(#c${cx})">${inner}</g>
    <text x="${cx - 40}" y="${cy + 200}" text-anchor="middle" font-size="30" fill="${ink}">${title}</text>
    ${labels}`;
  const lab = (x1, y1, x2, y2, text, anchor = 'start') =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${ink}" stroke-width="1.6"/>` +
    `<text x="${x2 + (anchor === 'start' ? 6 : -6)}" y="${y2 + 8}" text-anchor="${anchor}" font-size="24" fill="${ink}">${text}</text>`;
  const onion = view(
    235,
    430,
    onionCells(235, 430, ink, p.seed),
    'Onion skin, 400x',
    lab(200, 340, 120, 250, 'cell wall', 'end') + lab(262, 432, 398, 300, 'nucleus'),
  );
  const cheek = view(
    655,
    430,
    cheekCells(655, 430, ink, p.seed + 3),
    'Cheek cells, 400x',
    lab(610, 380, 540, 250, 'membrane', 'end') + lab(700, 476, 760, 640, 'nucleus'),
  );
  const lines = p.notes
    .map((t, i) => `<text x="70" y="${840 + i * 52}" font-size="28" fill="${ink}">${t}</text>`)
    .join('');
  return `
    <text x="70" y="95" font-size="44" fill="${ink}">Cell Microscope Lab</text>
    <text x="560" y="95" font-size="28" fill="${ink}">Name: ${p.name}</text>
    <text x="70" y="150" font-size="26" fill="${ink}">Purpose: compare a plant cell and an animal cell.</text>
    ${onion}${cheek}
    <text x="70" y="785" font-size="30" fill="${ink}" text-decoration="underline">What I saw</text>
    ${lines}`;
}

function pageTwo(p) {
  const ink = p.ink;
  const rows = p.answers
    .map(
      (qa, i) =>
        `<text x="70" y="${230 + i * 250}" font-size="28" fill="${ink}">${i + 1}. ${qa[0]}</text>` +
        qa[1]
          .map((t, j) => `<text x="100" y="${285 + i * 250 + j * 50}" font-size="27" fill="${ink}">${t}</text>`)
          .join(''),
    )
    .join('');
  return `
    <text x="70" y="95" font-size="40" fill="${ink}">Analysis (page 2)</text>
    <text x="560" y="95" font-size="28" fill="${ink}">Name: ${p.name}</text>
    ${rows}`;
}

function html(p, body) {
  const lines = Array.from(
    { length: 24 },
    (_, i) => `<line x1="40" y1="${180 + i * 46}" x2="860" y2="${180 + i * 46}" stroke="#b9cfe6" stroke-width="1.2"/>`,
  ).join('');
  return `<!doctype html><html><head><style>
    html,body{margin:0;background:${p.desk};}
    .sheet{position:absolute;left:${p.inset}px;top:${p.inset}px;width:${W - p.inset * 2}px;height:${H - p.inset * 2}px;
      transform:rotate(${p.tilt}deg);box-shadow:0 6px 18px rgba(0,0,0,.35);background:#fbfaf3;overflow:hidden}
    svg{font-family:'${p.font}', 'Noteworthy', cursive}
  </style></head><body><div class="sheet">
    <svg width="${W - p.inset * 2}" height="${H - p.inset * 2}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <line x1="58" y1="0" x2="58" y2="${H}" stroke="#e7a0a0" stroke-width="1.5"/>
      ${lines}${body}
    </svg></div></body></html>`;
}

const PAGES = [
  {
    file: 'cell-lab-cece-1',
    name: 'Cece A.',
    font: 'Noteworthy',
    ink: '#1f3a8a',
    desk: '#8b6b4a',
    tilt: -1.2,
    inset: 26,
    seed: 11,
    notes: [
      'The onion cells look like bricks in rows.',
      'Each one has a dark dot, the nucleus.',
      'Cheek cells are round and floppy, no wall.',
      'Iodine made the nucleus easier to see.',
    ],
  },
  {
    file: 'cell-lab-noor-1',
    name: 'Noor A.',
    font: 'Bradley Hand',
    ink: '#222222',
    desk: '#d9d4c7',
    tilt: 0.8,
    inset: 22,
    seed: 23,
    notes: [
      'Plant cells have straight walls and fit together.',
      'Animal cells are rounder and spread out.',
      'Both have a nucleus and cytoplasm.',
      'At 400x I had to use the fine focus only.',
    ],
  },
  {
    file: 'cell-lab-noor-2',
    page: 2,
    name: 'Noor A.',
    font: 'Bradley Hand',
    ink: '#222222',
    desk: '#d9d4c7',
    tilt: -0.6,
    inset: 22,
    seed: 29,
    answers: [
      ['Which cell had a cell wall?', ['The onion cell. It keeps the', 'cell stiff and the same shape.']],
      ['Why did we add iodine?', ['To stain the cells so the parts', 'show up against the light.']],
      ['One thing I would change:', ['Use a thinner piece of onion,', 'mine was two layers thick.']],
      ['Sources of error:', ['Air bubbles under the cover slip.']],
    ],
  },
  {
    file: 'cell-lab-sam-1',
    name: 'Sam B.',
    font: 'Chalkboard SE',
    ink: '#4b4b4b',
    desk: '#5f6b73',
    tilt: 1.8,
    inset: 34,
    seed: 37,
    notes: [
      'Onion: rectangles with a nucleus.',
      'Cheek: blobs, hard to find at first.',
      'I drew this at home from my notes.',
      '',
    ],
  },
  {
    file: 'cell-lab-liam-1',
    name: 'Liam C.',
    font: 'Noteworthy',
    ink: '#14532d',
    desk: '#a38a6d',
    tilt: -0.4,
    inset: 24,
    seed: 41,
    notes: [
      'Onion cells: long, in neat rows, thick walls.',
      'Cheek cells: no wall, thin membrane, overlap.',
      'Nucleus is darker in the onion (more stain).',
      'Plant cells have walls; animal cells do not.',
    ],
  },
  {
    file: 'cell-lab-mateo-1',
    name: 'Mateo C.',
    font: 'Marker Felt',
    ink: '#1e3a5f',
    desk: '#3f3a36',
    tilt: 3.2,
    inset: 48,
    seed: 53,
    notes: ['Onion = boxes', 'Cheek = circles', 'Both have a nucleus', ''],
  },
  {
    file: 'cell-lab-jas-1',
    name: 'Jas G.',
    font: 'Bradley Hand',
    ink: '#312e81',
    desk: '#c9bfae',
    tilt: -2.0,
    inset: 30,
    seed: 61,
    notes: [
      'The onion skin was see-through until iodine.',
      'I counted about 12 cells across the view.',
      'Cheek cells were spread out and folded.',
      'The nucleus was near the middle in most.',
    ],
  },
  {
    file: 'cell-lab-fatima-1',
    name: 'Fatima H.',
    font: 'Noteworthy',
    ink: '#7c2d12',
    desk: '#94a3b8',
    tilt: 1.0,
    inset: 24,
    seed: 71,
    notes: [
      'Onion cells are stacked like a brick wall.',
      'Cheek cells look like fried eggs.',
      'Cell wall vs. cell membrane is the big difference.',
      'See page 2 for my answers.',
    ],
  },
  {
    file: 'cell-lab-fatima-2',
    page: 2,
    name: 'Fatima H.',
    font: 'Noteworthy',
    ink: '#7c2d12',
    desk: '#94a3b8',
    tilt: 0.4,
    inset: 24,
    seed: 79,
    answers: [
      ['Which cell had a cell wall?', ['Onion. Plants need walls', 'to hold them up.']],
      ['Why did we add iodine?', ['It stains starch and the nucleus', 'so we can see them.']],
      ['One thing I would change:', ['Start at 40x and go up slowly.']],
      ['Sources of error:', ['My slide dried out a bit.']],
    ],
  },
  {
    file: 'cell-lab-priya-1',
    name: 'Priya K.',
    font: 'Chalkboard SE',
    ink: '#0f172a',
    desk: '#b08968',
    tilt: -0.9,
    inset: 22,
    seed: 83,
    notes: [
      'Plant cells: rigid wall, regular shape, in rows.',
      'Animal cells: flexible membrane, irregular.',
      'Both: nucleus, cytoplasm, membrane.',
      'Onion has no chloroplasts, it grows underground.',
    ],
  },
  {
    file: 'cell-lab-jordan-1',
    name: 'Jordan K.',
    font: 'Marker Felt',
    ink: '#1d4ed8',
    desk: '#d6ccc2',
    tilt: 1.4,
    inset: 28,
    seed: 97,
    notes: [
      'Onion cells were in lines like a wall.',
      'Cheek cells were hard to focus on.',
      'I saw the nucleus in both kinds.',
      '',
    ],
  },
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const made = [];
  for (const p of PAGES) {
    const body = p.page === 2 ? pageTwo(p) : pageOne(p);
    await page.setContent(html(p, body));
    await page.evaluate(() => document.fonts.ready);
    const full = path.join(OUT, p.file + '.jpg');
    await page.screenshot({ path: full, type: 'jpeg', quality: 62 });
    const thumb = path.join(OUT, p.file + '-thumb.jpg');
    execFileSync('sips', ['-Z', '200', '-s', 'format', 'jpeg', '-s', 'formatOptions', '60', full, '--out', thumb], {
      stdio: 'ignore',
    });
    made.push(p.file);
  }
  await browser.close();
  console.log(made.join('\n'));
})();
