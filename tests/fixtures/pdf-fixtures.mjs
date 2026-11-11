/**
 * Small, real PDFs made here for the PDF reader's tests (shared/photo-readers.js):
 * nothing is downloaded. Each is built byte by byte with a correct cross-
 * reference table, so any PDF reader opens it as it would a file from Word.
 *
 *   pagesPdf(n)   n Letter pages (612 × 792 pt), each with a black box at
 *                 the top left and "Page n" in Helvetica
 *   lockedPdf()   two pages, locked with the user password "secret" (the
 *                 standard 40-bit RC4 security handler, revision 2)
 *   damagedPdf()  a PDF header followed by bytes that are not a PDF
 *
 * Each returns a Uint8Array.
 */
import { createHash } from 'node:crypto';

const enc = s => Buffer.from(s, 'latin1');

function pageContent(n) {
  // A black box 144 pt square, 36 pt in from the top left, and a label.
  return `0 0 0 rg 36 612 144 144 re f BT /F1 36 Tf 36 300 Td (Page ${n}) Tj ET`;
}

/* A PDF from its object bodies (1-based), with an optional trailer extra. */
function assemble(bodies, trailerExtra = '') {
  const parts = [enc('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')];
  let at = parts[0].length;
  const offsets = [];
  bodies.forEach((body, i) => {
    offsets.push(at);
    const head = enc(`${i + 1} 0 obj\n`);
    const tail = enc('\nendobj\n');
    const chunk = Buffer.concat([head, Buffer.isBuffer(body) ? body : enc(body), tail]);
    parts.push(chunk);
    at += chunk.length;
  });
  const xref = [`xref\n0 ${bodies.length + 1}\n`, '0000000000 65535 f \n'];
  offsets.forEach(o => xref.push(String(o).padStart(10, '0') + ' 00000 n \n'));
  parts.push(
    enc(
      xref.join('') + `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R ${trailerExtra}>>\nstartxref\n${at}\n%%EOF\n`,
    ),
  );
  return new Uint8Array(Buffer.concat(parts));
}

/* Object bodies for n pages: 1 catalog, 2 pages, 3 font, then a page and
   its content stream for each page. streamBytes(objNum, bytes) may encrypt. */
function bodiesFor(n, streamBytes = (num, b) => b) {
  const kids = [];
  const bodies = ['<< /Type /Catalog /Pages 2 0 R >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for (let i = 1; i <= n; i++) {
    const pageNum = 4 + (i - 1) * 2;
    const contentNum = pageNum + 1;
    kids.push(`${pageNum} 0 R`);
    bodies.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNum} 0 R >>`,
    );
    const data = streamBytes(contentNum, enc(pageContent(i)));
    bodies.push(Buffer.concat([enc(`<< /Length ${data.length} >>\nstream\n`), data, enc('\nendstream')]));
  }
  bodies[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${n} >>`;
  return bodies;
}

export function pagesPdf(n) {
  return assemble(bodiesFor(n));
}

const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex');
const md5 = (...bufs) => createHash('md5').update(Buffer.concat(bufs)).digest();

function rc4(key, data) {
  const s = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

const padded = pw => Buffer.concat([enc(pw), PAD]).subarray(0, 32);

export function lockedPdf(userPassword = 'secret', ownerPassword = 'teacher') {
  // PDF Reference 1.7, algorithms 3.2 to 3.4, revision 2 (40-bit key).
  const id = Buffer.from('46756c6c566973696f6e2d746573742d', 'hex');
  const P = -44; // print allowed, nothing else
  const pBytes = Buffer.alloc(4);
  pBytes.writeInt32LE(P);
  const O = rc4(md5(padded(ownerPassword)).subarray(0, 5), padded(userPassword));
  const key = md5(padded(userPassword), O, pBytes, id).subarray(0, 5);
  const U = rc4(key, PAD);
  const objectKey = num =>
    md5(key, Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, 0, 0])).subarray(0, 10);
  const bodies = bodiesFor(2, (num, bytes) => rc4(objectKey(num), bytes));
  const encryptNum = bodies.length + 1;
  bodies.push(`<< /Filter /Standard /V 1 /R 2 /O <${O.toString('hex')}> /U <${U.toString('hex')}> /P ${P} >>`);
  return assemble(bodies, `/Encrypt ${encryptNum} 0 R /ID [<${id.toString('hex')}> <${id.toString('hex')}>] `);
}

export function damagedPdf() {
  const junk = Buffer.alloc(4096);
  // The same "random" bytes every run.
  for (let i = 0, x = 7; i < junk.length; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    junk[i] = x >>> 24;
  }
  return new Uint8Array(Buffer.concat([enc('%PDF-1.4\n'), junk]));
}
