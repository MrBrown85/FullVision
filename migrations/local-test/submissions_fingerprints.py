"""Write the function fingerprints Batch B's files carry, from a database, so
no hash is ever copied by hand.

    PGDATABASE=<template built by `submissions_common.py build`> python3 submissions_fingerprints.py          # rewrite the files
    PGDATABASE=...                                               python3 submissions_fingerprints.py check    # change nothing; exit 1 if a list is stale

A list sits between two comment lines, `-- FINGERPRINTS-BEGIN <which>` and
`-- FINGERPRINTS-END`, as rows of a VALUES list: ('<signature>', '<md5>').
<which> says what the list holds:
    new      every function the first file makes, as it leaves them
    absent   the same functions, each 'absent': none may exist yet
    policy   the three functions the storage policies call
    relied   the live functions the new ones call, as the harness built as
             live has them (the values the read-only pre-check compares
             gradebook-prod with)
    names    the signatures of the functions the first file makes, with no
             fingerprint: rows of a list of text

The values come from a copy of the template with the first file applied
(its own lists stood aside for that one apply, since they are what is being
worked out). md5(pg_get_functiondef) does not depend on them.
"""
from submissions_common import *

FILES = [M1, M2, 'batch-b-live-precheck.sql', 'batch-b-live-postcheck.sql', UNDO_B]
BEGIN = re.compile(r'^([ \t]*)-- FINGERPRINTS-BEGIN[ \t]*(\w*)[^\n]*$', re.M)

def neutral(text):
    """The file with every list stood aside: one row that is absent before and after."""
    return MARK.sub(lambda m: m.group(1) + "            ('public.no_such_function_at_all()', 'absent')" + m.group(3), text)

def measured():
    d = WorkDb('fp')
    try:
        r = d.statements(split(neutral(text_of(M1))))
        if r != 'ok': sys.exit('the first file does not apply: ' + r)
        new = fingerprints(d, B_FUNCTIONS)
        relied = fingerprints(d, RELIED_ON)
        missing = [k for k, v in list(new.items()) + list(relied.items()) if v is None]
        if missing: sys.exit('not found after the apply: ' + ', '.join(missing))
        return {'new': new, 'absent': {k: 'absent' for k in B_FUNCTIONS}, 'policy': {k: new[k] for k in POLICY_FUNCTIONS}, 'relied': relied}
    finally:
        d.close()

def rewrite(text, lists):
    out = []; pos = 0
    for m in BEGIN.finditer(text):
        end = text.index('-- FINGERPRINTS-END', m.end())
        end_line = text.rfind('\n', 0, end)
        which = m.group(2) or 'new'
        if which == 'names':     # only the signatures, as a list of text
            body = ',\n'.join("%s'%s'" % (m.group(1), k) for k in lists['new'])
        else:
            rows = lists[which]
            width = max(len(k) for k in rows) + 3
            body = ',\n'.join("%s(%s '%s')" % (m.group(1), ("'%s'," % k).ljust(width), v) for k, v in rows.items())
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
