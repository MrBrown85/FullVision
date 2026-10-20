"""Run SQL files statement by statement against the local Postgres (pg8000
speaks the extended protocol, one statement at a time). Splits on
semicolons outside quotes, dollar-quoted bodies and comments."""
import os, sys, re
if os.environ.get('PG8000_PATH'): sys.path.insert(0, os.environ['PG8000_PATH'])
import pg8000.native as pg

def split(sql):
    out, buf, i, n = [], [], 0, len(sql)
    dollar = None
    while i < n:
        c = sql[i]
        if dollar:
            if sql.startswith(dollar, i):
                buf.append(dollar); i += len(dollar); dollar = None; continue
            buf.append(c); i += 1; continue
        if c == '-' and sql.startswith('--', i):
            j = sql.find('\n', i); j = n if j < 0 else j
            buf.append(sql[i:j]); i = j; continue
        if c == '/' and sql.startswith('/*', i):
            j = sql.find('*/', i); j = n if j < 0 else j + 2
            buf.append(sql[i:j]); i = j; continue
        if c == "'":
            j = i + 1
            while j < n:
                if sql[j] == "'" and sql[j+1:j+2] == "'": j += 2; continue
                if sql[j] == "'": break
                j += 1
            buf.append(sql[i:j+1]); i = j + 1; continue
        m = re.match(r'\$[A-Za-z_]*\$', sql[i:i+64])
        if c == '$' and m:
            dollar = m.group(0); buf.append(dollar); i += len(dollar); continue
        if c == ';':
            stmt = ''.join(buf).strip()
            if stmt: out.append(stmt)
            buf = []; i += 1; continue
        buf.append(c); i += 1
    tail = ''.join(buf).strip()
    if tail and not all(l.strip().startswith('--') or not l.strip() for l in tail.splitlines()): out.append(tail)
    return out

def connect():
    return pg.Connection(os.environ.get('PGUSER', 'postgres'), host=os.environ.get('PGHOST', '127.0.0.1'), port=int(os.environ.get('PGPORT', '5432')), database=os.environ.get('PGDATABASE', 'fv'), password=os.environ.get('PGPASSWORD'))

if __name__ == '__main__':
    c = connect()
    for path in sys.argv[1:]:
        stmts = split(open(path).read())
        for k, st in enumerate(stmts):
            try:
                c.run(st)
            except Exception as e:
                print(f'FAILED in {path} statement {k+1}:\n{st[:300]}\n-> {e}')
                sys.exit(1)
        print(f'{path}: {len(stmts)} statements ok')
    c.close()
