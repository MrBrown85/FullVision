/**
 * A made-up scan for the Add Work specs, built in the browser from the
 * sample pages in assets/sample-work/ (made-up work): `n` pages, each a
 * little shorter than the one before so a page can be told by its shape,
 * as one PDF of JPEG pages in window.__scan. Run with page.evaluate:
 *   const shapes = await page.evaluate(madeUpScan, 6);
 * → each page's width over height, times 1000, rounded.
 */
export async function madeUpScan(n) {
  const files = ['cece-1', 'fatima-1', 'jas-1', 'jordan-1', 'liam-1', 'mateo-1'];
  const jpegs = [];
  for (let k = 1; k <= n; k++) {
    const img = await createImageBitmap(
      await (await fetch('/assets/sample-work/cell-lab-' + files[(k - 1) % 6] + '.jpg')).blob(),
    );
    const c = document.createElement('canvas');
    c.width = 900;
    c.height = 1200 - k * 24;
    c.getContext('2d').drawImage(img, 0, 0, 900, 1200);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.6));
    jpegs.push({ bytes: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height });
  }
  const enc = new TextEncoder();
  const parts = [];
  const offs = [];
  let len = 0;
  const push = x => {
    const b = typeof x === 'string' ? enc.encode(x) : x;
    parts.push(b);
    len += b.length;
  };
  const obj = (id, body) => {
    offs[id] = len;
    push(id + ' 0 obj\n' + body + '\nendobj\n');
  };
  push('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [' + jpegs.map((_, i) => 3 + i * 3 + ' 0 R').join(' ') + '] /Count ' + n + ' >>');
  const shapes = [];
  jpegs.forEach((j, i) => {
    const [pid, cs, iid] = [3 + i * 3, 4 + i * 3, 5 + i * 3];
    const H = Math.round((612 * j.h) / j.w);
    shapes.push(Math.round((612 / H) * 1000));
    const draw = 'q 612 0 0 ' + H + ' 0 0 cm /Im0 Do Q';
    obj(
      pid,
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 ' +
        H +
        '] /Resources << /XObject << /Im0 ' +
        iid +
        ' 0 R >> >> /Contents ' +
        cs +
        ' 0 R >>',
    );
    obj(cs, '<< /Length ' + draw.length + ' >>\nstream\n' + draw + '\nendstream');
    offs[iid] = len;
    push(
      iid +
        ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' +
        j.w +
        ' /Height ' +
        j.h +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' +
        j.bytes.length +
        ' >>\nstream\n',
    );
    push(j.bytes);
    push('\nendstream\nendobj\n');
  });
  const size = 3 + n * 3;
  const xref = len;
  let x = 'xref\n0 ' + size + '\n0000000000 65535 f \n';
  for (let id = 1; id < size; id++) x += String(offs[id]).padStart(10, '0') + ' 00000 n \n';
  push(x + 'trailer\n<< /Size ' + size + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
  window.__scan = new File(parts, 'Two Blocks 2026-11-24 0815.pdf', { type: 'application/pdf' });
  return shapes;
}
