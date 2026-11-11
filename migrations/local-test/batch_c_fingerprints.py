"""Write the function fingerprints Batch C's files carry, from a database, so
no hash is ever copied by hand.

    PGDATABASE=<template built by `batch_c_common.py build`> python3 batch_c_fingerprints.py         # rewrite the files
    PGDATABASE=...                                            python3 batch_c_fingerprints.py check   # change nothing; exit 1 if stale

A list sits between `-- FINGERPRINTS-BEGIN <which>` and `-- FINGERPRINTS-END`,
as rows of a VALUES list. <which>:
    relied     (fn, md5)                 existing functions C1 calls, as the template has them
    new        (fn, becomes, or_c2)      every function C1 makes; or_c2 is what C2 leaves (the
                                         same, except for the three C2 replaces)
    absent     (fn, 'absent')            the same functions: none may exist before C1
    c2relied   (fn, first_run, later_run) what C2's guard compares: the functions it calls and
                                         the three it replaces, after C1 alone and after C2
    c2new      (fn, becomes)             the four functions C2 leaves
    c1stand    (fn, md5)                 the three C2 replaces, as C1 leaves them (C2's undo)

The values come from copies of the template with each file applied, its own
lists stood aside for that apply. md5(pg_get_functiondef) does not depend on them.
"""
from batch_c_common import *

FILES = [C1, C2, 'batch-c1-live-precheck.sql', 'batch-c1-live-postcheck.sql', 'batch-c2-live-precheck.sql',
         'batch-c2-live-postcheck.sql', UNDO_C1, UNDO_C2]
BEGIN = re.compile(r'^([ \t]*)-- FINGERPRINTS-BEGIN[ \t]*(\w*)[^\n]*$', re.M)

def measured():
    d = CDb('fp')
    try:
        relied = fingerprints(d, C1_RELIED)
        r = d.statements(split(neutral(text_at(C1))))
        if r != 'ok': sys.exit('C1 does not apply: ' + r)
        after1 = fingerprints(d, C1_FUNCTIONS + C2_RELIED + C2_NEW)
        r = d.statements(split(neutral(text_at(C2))))
        if r != 'ok': sys.exit('C2 does not apply: ' + r)
        after2 = fingerprints(d, C1_FUNCTIONS + C2_RELIED + C2_NEW)
    finally:
        d.close()
    missing = [k for k, v in list(relied.items()) if v is None] + [k for k in C1_FUNCTIONS + C2_NEW if after2[k] is None]
    if missing: sys.exit('not found: ' + ', '.join(missing))
    a = lambda v: v or 'absent'
    c2fns = C2_RELIED + C2_REPLACES + C2_NEW
    return {
        'relied': [(k, relied[k]) for k in C1_RELIED],
        'new': [(k, after1[k], after2[k]) for k in C1_FUNCTIONS],
        'absent': [(k, 'absent') for k in C1_FUNCTIONS],
        'c2relied': [(k, a(after1[k]), a(after2[k])) for k in dict.fromkeys(c2fns)],
        'c2new': [(k, after2[k]) for k in C2_REPLACES + C2_NEW],
        'c1stand': [(k, after1[k]) for k in C2_REPLACES],
    }

def rewrite(text, lists):
    out = []; pos = 0
    for m in BEGIN.finditer(text):
        end = text.index('-- FINGERPRINTS-END', m.end())
        end_line = text.rfind('\n', 0, end)
        rows = lists[m.group(2) or 'new']
        width = max(len(r[0]) for r in rows) + 3
        body = ',\n'.join('%s(%s %s)' % (m.group(1), ("'%s'," % r[0]).ljust(width), ', '.join("'%s'" % v for v in r[1:])) for r in rows)
        out.append(text[pos:m.end()] + '\n' + body); pos = end_line
    return ''.join(out) + text[pos:]

if __name__ == '__main__':
    lists = measured(); stale = []
    for rel in FILES:
        path = os.path.join(HERE, rel)
        if not os.path.exists(path): continue
        was = open(path).read(); now = rewrite(was, lists)
        if now != was:
            stale.append(rel)
            if sys.argv[1:] != ['check']: open(path, 'w').write(now)
    if sys.argv[1:] == ['check']:
        print('stale: ' + ', '.join(stale) if stale else 'every list is current'); sys.exit(1 if stale else 0)
    print('rewritten: ' + (', '.join(stale) or 'nothing (every list was current)'))
