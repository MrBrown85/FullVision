/**
 * A Date whose local getters read as Pacific Daylight Time (UTC-7) in any
 * runner zone. Node fixes the process timezone when the worker starts, so
 * setting process.env.TZ inside a test file does not move local time.
 *
 *   vi.stubGlobal('Date', PdtDate);  // then vi.unstubAllGlobals()
 */
const RealDate = Date;
const PDT_MS = 7 * 3600000;

export class PdtDate extends RealDate {
  _pdt() {
    return new RealDate(this.getTime() - PDT_MS);
  }
  getFullYear() {
    return this._pdt().getUTCFullYear();
  }
  getMonth() {
    return this._pdt().getUTCMonth();
  }
  getDate() {
    return this._pdt().getUTCDate();
  }
  getHours() {
    return this._pdt().getUTCHours();
  }
}

/* The runner's own local day for a timestamp, read with the real Date. */
export function runnerLocalDay(iso) {
  const d = new RealDate(iso);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
