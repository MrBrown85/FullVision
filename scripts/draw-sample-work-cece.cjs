// scripts/draw-sample-work-cece.cjs: draws three synthetic sample pages for Demo Mode (energy-lab-cece-1, cell-quiz-cece-1 and -2 in assets/sample-work/), from no real student work. Run: node scripts/draw-sample-work-cece.cjs assets/sample-work (needs playwright). No thumbnails: the student page shows these pages full size only.
const { chromium } = require('playwright');
const path = require('path');
const OUT = process.argv[2];
const W = 900,
  H = 1200;
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
      ${p.ruled === false ? '' : `<line x1="58" y1="0" x2="58" y2="${H}" stroke="#e7a0a0" stroke-width="1.5"/>` + lines}${body}
    </svg></div></body></html>`;
}
const ink = '#1f3a8a';
const T = (x, y, s, t, extra = '') => `<text x="${x}" y="${y}" font-size="${s}" fill="${ink}" ${extra}>${t}</text>`;
const P = (x, y, t) =>
  `<text x="${x}" y="${y}" font-size="26" fill="#222" font-family="Helvetica, Arial, sans-serif">${t}</text>`;
function energy() {
  const rows = [
    ['Light bulb', 'electrical', 'light + heat', 'hot glass'],
    ['Kettle', 'electrical', 'heat', 'steam'],
    ['Bike', 'chemical', 'motion', 'warm legs'],
    ['Solar panel', 'light', 'electrical', 'warm panel'],
  ];
  let t = '';
  const xs = [70, 260, 440, 640];
  ['Thing', 'Energy in', 'Energy out', 'Wasted as heat?'].forEach(
    (h, i) => (t += T(xs[i], 300, 26, h, 'font-weight="700"')),
  );
  t += `<line x1="60" y1="312" x2="850" y2="312" stroke="${ink}" stroke-width="2"/>`;
  rows.forEach((r, j) => r.forEach((c, i) => (t += T(xs[i], 360 + j * 52, 25, c))));
  t += T(70, 640, 30, 'Bulb diagram', 'text-decoration="underline"');
  t +=
    `<rect x="90" y="680" width="170" height="90" rx="10" fill="none" stroke="${ink}" stroke-width="2.4"/>` +
    T(118, 735, 26, 'electrical');
  t += `<path d="M262 725 L420 690 M262 725 L420 770" stroke="${ink}" stroke-width="2.4" fill="none"/>`;
  t += `<path d="M408 684 L422 690 L410 700 M408 762 L422 770 L408 778" stroke="${ink}" stroke-width="2.4" fill="none"/>`;
  t += T(432, 698, 26, 'light (useful)') + T(432, 780, 26, 'heat (wasted)');
  const notes = [
    'Every machine wasted some energy as heat.',
    'The kettle wasted the least: we wanted heat.',
    'Pattern: energy is never lost, it spreads out.',
  ];
  t += T(70, 870, 30, 'What I found', 'text-decoration="underline"');
  notes.forEach((n, i) => (t += T(70, 925 + i * 52, 27, n)));
  return (
    T(70, 95, 40, 'Energy Transfer Investigation') +
    T(600, 150, 28, 'Name: Cece A.') +
    T(70, 210, 26, 'Question: where does the energy go?') +
    t
  );
}
function quiz(page) {
  const qs =
    page === 1
      ? [
          ['Which part controls the cell?', 'the nucleus'],
          ['Name one part only plant cells have.', 'cell wall (and chloroplasts)'],
          ['What does the membrane do?', 'lets things in and out'],
          ['Where is energy made?', 'mitochondria'],
        ]
      : [
          ['Draw and label an animal cell.', ''],
          ['Why do plant cells keep their shape?', 'the cell wall is stiff'],
        ];
  let t =
    `<text x="70" y="95" font-size="40" fill="#222" font-family="Helvetica, Arial, sans-serif" font-weight="700">Cell Structure Quiz</text>` +
    T(600, 160, 28, 'Name: Cece A.');
  t += `<text x="70" y="160" font-size="22" fill="#666" font-family="Helvetica, Arial, sans-serif">Page ${page} of 2</text>`;
  qs.forEach((q, i) => {
    const y = 250 + i * (page === 1 ? 220 : 520);
    t += P(70, y, (page === 1 ? i + 1 : i + 5) + '. ' + q[0]);
    if (q[1]) t += T(110, y + 70, 30, q[1]);
  });
  if (page === 2) {
    t += `<ellipse cx="330" cy="470" rx="190" ry="130" fill="none" stroke="${ink}" stroke-width="2.6"/>`;
    t += `<circle cx="320" cy="465" r="44" fill="none" stroke="${ink}" stroke-width="2.4"/><circle cx="320" cy="465" r="13" fill="${ink}" opacity=".7"/>`;
    t += `<ellipse cx="430" cy="525" rx="28" ry="13" fill="none" stroke="${ink}" stroke-width="2"/>`;
    t += `<line x1="364" y1="462" x2="570" y2="400" stroke="${ink}" stroke-width="1.6"/>` + T(576, 408, 24, 'nucleus');
    t += `<line x1="510" y1="470" x2="590" y2="476" stroke="${ink}" stroke-width="1.6"/>` + T(596, 484, 24, 'membrane');
    t +=
      `<line x1="458" y1="525" x2="590" y2="556" stroke="${ink}" stroke-width="1.6"/>` +
      T(596, 564, 24, 'mitochondria');
  }
  return t;
}
const PAGES = [
  { file: 'energy-lab-cece-1', body: energy(), font: 'Noteworthy', desk: '#8b6b4a', tilt: 0.9, inset: 26 },
  { file: 'cell-quiz-cece-1', body: quiz(1), font: 'Noteworthy', desk: '#ffffff', tilt: 0.3, inset: 14, ruled: false },
  { file: 'cell-quiz-cece-2', body: quiz(2), font: 'Noteworthy', desk: '#ffffff', tilt: -0.4, inset: 14, ruled: false },
];
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  for (const p of PAGES) {
    await page.setContent(html(p, p.body));
    await page.evaluate(() => document.fonts.ready);
    const full = path.join(OUT, p.file + '.jpg');
    await page.screenshot({ path: full, type: 'jpeg', quality: 62 });
    console.log(p.file);
  }
  await browser.close();
})();
