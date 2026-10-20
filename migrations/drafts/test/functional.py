"""Exercise every RPC as Teacher A (role authenticated, JWT sub set), check
what Teacher B and anon can see, and the constraints. Everything runs in
one transaction that is rolled back at the end."""
import os, sys, json, uuid
if os.environ.get('PG8000_PATH'): sys.path.insert(0, os.environ['PG8000_PATH'])
import pg8000.native as pg

A='11111111-1111-1111-1111-111111111111'; B='22222222-2222-2222-2222-222222222222'
COURSE_A='aaaaaaaa-0000-0000-0000-000000000001'; COURSE_B='bbbbbbbb-0000-0000-0000-000000000001'
ENR1='eeeeeeee-1111-0000-0000-000000000001'; ENR2='eeeeeeee-1111-0000-0000-000000000002'; ENR_B='eeeeeeee-2222-0000-0000-000000000001'
STU1='aaaaaaaa-1111-0000-0000-000000000001'; STU_B='bbbbbbbb-2222-0000-0000-000000000001'
passed=[]; failed=[]
def ok(name, cond, detail=''):
    (passed if cond else failed).append(name + ('' if cond else ' :: '+str(detail)[:200]))

c=pg.Connection(os.environ.get('PGUSER', 'postgres'), host=os.environ.get('PGHOST', '127.0.0.1'), port=int(os.environ.get('PGPORT', '5432')), database=os.environ.get('PGDATABASE', 'fv'), password=os.environ.get('PGPASSWORD'))
c.run('begin')
def as_teacher(uid):
    c.run("reset role"); c.run("select set_config('request.jwt.claim.sub', :u, true)", u=uid or ''); c.run("set role authenticated")
def expect_error(name, fn, code=None):
    try:
        fn(); ok(name, False, 'no error raised')
    except Exception as e:
        msg=str(e); ok(name, (code in msg) if code else True, msg)
    finally:
        c.run('rollback to savepoint sp')
def sp(): c.run('savepoint sp')

# ── report_template ──────────────────────────────────────────────
as_teacher(A); sp()
form={'v':3,'front':[{'block':'header'},{'block':'teacher-narrative','room':{'lines':8}}],'back':[]}
r=c.run("select save_report_template(:n, :f::jsonb, null, :k)", n='  Science 8 form ', f=json.dumps(form), k=str(uuid.uuid4()))[0][0]
ok('save_report_template inserts and trims the name', r['name']=='Science 8 form' and r['teacher_id']==A, r)
tid=r['id']
key=str(uuid.uuid4())
r1=c.run("select save_report_template('Humanities', :f::jsonb, null, :k)", f=json.dumps(form), k=key)[0][0]
r2=c.run("select save_report_template('Humanities', :f::jsonb, null, :k)", f=json.dumps(form), k=key)[0][0]
ok('save_report_template replays the same idempotency key', r1['id']==r2['id'], (r1['id'], r2['id']))
form2=dict(form, type='compact')
r3=c.run("select save_report_template('science 8 FORM', :f::jsonb, null, :k)", f=json.dumps(form2), k=str(uuid.uuid4()))[0][0]
ok('same name (case-insensitive) updates instead of duplicating', r3['id']==tid and r3['form']['type']=='compact', r3)
r4=c.run("select save_report_template('Renamed', :f::jsonb, :id, :k)", f=json.dumps(form), id=tid, k=str(uuid.uuid4()))[0][0]
ok('save_report_template with p_id renames', r4['id']==tid and r4['name']=='Renamed', r4)
lst=c.run("select list_report_templates()")[0][0]
ok('list_report_templates lists both (same updated_at inside one transaction, so order is not checked here)', sorted(t['name'] for t in lst)==['Humanities','Renamed'], [t['name'] for t in lst])
sp(); expect_error('form without a front array is refused', lambda: c.run("select save_report_template('Bad', '{\"v\":3}'::jsonb, null, null)"), 'check')
sp(); expect_error('blank name is refused', lambda: c.run("select save_report_template('   ', :f::jsonb, null, null)", f=json.dumps(form)), 'check')
as_teacher(B)
ok('teacher B sees no templates of A', c.run("select list_report_templates()")[0][0]==[], c.run("select list_report_templates()")[0][0])
sp(); expect_error('teacher B cannot update A\'s template by id', lambda: c.run("select save_report_template('Steal', :f::jsonb, :id, null)", f=json.dumps(form), id=tid), 'P0002')
sp(); expect_error('teacher B cannot delete A\'s template', lambda: c.run("select delete_report_template(:id, null)", id=tid), 'P0002')
ok('teacher B cannot select A\'s rows directly (RLS)', c.run("select count(*) from report_template")[0][0]==0)
as_teacher(A)
d=c.run("select delete_report_template(:id, :k)", id=tid, k=str(uuid.uuid4()))[0][0]
ok('delete_report_template deletes', d['deleted'] is True and len(c.run("select list_report_templates()")[0][0])==1)

# ── report_issue ─────────────────────────────────────────────────
as_teacher(A)
students=[{'enrollment_id':ENR1,'sheets':1,'hash':'h1','html':'<div class="report-sheet">Cece</div>'},
          {'enrollment_id':ENR2,'sheets':2,'hash':'h2','html':'<div class="report-sheet">Marcus</div>'}]
key=str(uuid.uuid4())
i1=c.run("select create_report_issue(:c, 2, 'Nov Report Card', 'letter', :f::jsonb, :s::jsonb, :k)", c=COURSE_A, f=json.dumps(form), s=json.dumps(students), k=key)[0][0]
i2=c.run("select create_report_issue(:c, 2, 'Nov Report Card', 'letter', :f::jsonb, :s::jsonb, :k)", c=COURSE_A, f=json.dumps(form), s=json.dumps(students), k=key)[0][0]
ok('create_report_issue returns id, issued_at, count; replays on the same key', i1['student_count']==2 and i1['id']==i2['id'], (i1,i2))
lst=c.run("select list_report_issues(:c, 2)", c=COURSE_A)[0][0]
ok('list_report_issues gives hashes per enrollment and no html', len(lst)==1 and lst[0]['hashes']=={ENR1:'h1',ENR2:'h2'} and 'html' not in json.dumps(lst), lst)
ok('list_report_issues for another term is empty', c.run("select list_report_issues(:c, 1)", c=COURSE_A)[0][0]==[])
ok('list_report_issues with no term lists all', len(c.run("select list_report_issues(:c, null)", c=COURSE_A)[0][0])==1)
g=c.run("select get_report_issue(:i)", i=i1['id'])[0][0]
ok('get_report_issue returns students in roster order with html', [s['enrollment_id'] for s in g['students']]==[ENR1,ENR2] and g['students'][1]['html'].endswith('Marcus</div>') and g['students'][1]['sheets']==2, g)
sp(); expect_error('an enrollment from another course is refused', lambda: c.run("select create_report_issue(:c, 2, 'x', 'letter', null, :s::jsonb, null)", c=COURSE_A, s=json.dumps([{'enrollment_id':ENR_B,'sheets':1,'hash':'h','html':'x'}])), '22023')
sp(); expect_error('an empty student list is refused', lambda: c.run("select create_report_issue(:c, 2, 'x', 'letter', null, '[]'::jsonb, null)", c=COURSE_A), '22023')
sp(); expect_error('a term outside 1..6 is refused', lambda: c.run("select create_report_issue(:c, 9, 'x', 'letter', null, :s::jsonb, null)", c=COURSE_A, s=json.dumps(students)), 'check')
sp(); expect_error('a paper other than letter/legal is refused', lambda: c.run("select create_report_issue(:c, 2, 'x', 'a4', null, :s::jsonb, null)", c=COURSE_A, s=json.dumps(students)), 'check')
as_teacher(B)
sp(); expect_error('teacher B cannot list A\'s issues', lambda: c.run("select list_report_issues(:c, null)", c=COURSE_A), 'P0002')
sp(); expect_error('teacher B cannot get A\'s issue', lambda: c.run("select get_report_issue(:i)", i=i1['id']), 'P0002')
sp(); expect_error('teacher B cannot delete A\'s issue', lambda: c.run("select delete_report_issue(:i, null)", i=i1['id']), 'P0002')
ok('teacher B sees no issue rows directly (RLS)', c.run("select count(*) from report_issue")[0][0]==0 and c.run("select count(*) from report_issue_student")[0][0]==0)
sp(); expect_error('teacher B cannot issue into A\'s course', lambda: c.run("select create_report_issue(:c, 2, 'x', 'letter', null, :s::jsonb, null)", c=COURSE_A, s=json.dumps(students)), 'P0002')
as_teacher(A)
d=c.run("select delete_report_issue(:i, :k)", i=i1['id'], k=str(uuid.uuid4()))[0][0]
ok('delete_report_issue cascades to the students', d['deleted'] is True and c.run("select count(*) from report_issue_student")[0][0]==0)

# ── guardian ─────────────────────────────────────────────────────
as_teacher(A)
g1=c.run("select upsert_guardian(:s, ' Amara Adeyemi ', 'mother', ' A.Adeyemi@Telus.net ', null, 'en', null, null, null, :k)", s=STU1, k=str(uuid.uuid4()))[0][0]
ok('upsert_guardian inserts, trims, lower-cases the email, no consent by default', g1['name']=='Amara Adeyemi' and g1['email']=='a.adeyemi@telus.net' and g1['consent_at'] is None, g1)
g2=c.run("select upsert_guardian(:s, 'Amara Adeyemi', 'mother', 'a.adeyemi@telus.net', '604-555-0100', 'fr', now(), 'form', :id, :k)", s=STU1, id=g1['id'], k=str(uuid.uuid4()))[0][0]
ok('upsert_guardian with p_id updates and records consent with its source', g2['id']==g1['id'] and g2['consent_source']=='form' and g2['consent_at'] is not None and g2['language']=='fr', g2)
sp(); expect_error('consent_at without a source is refused', lambda: c.run("select upsert_guardian(:s, 'X', null, null, null, 'en', now(), null, null, null)", s=STU1), 'check')
sp(); expect_error('a bad email is refused', lambda: c.run("select upsert_guardian(:s, 'X', null, 'not-an-email', null, 'en', null, null, null, null)", s=STU1), 'check')
sp(); expect_error('the same email twice for one student is refused', lambda: c.run("select upsert_guardian(:s, 'Dup', null, 'A.ADEYEMI@telus.net', null, 'en', null, null, null, null)", s=STU1), 'unique')
sp(); expect_error('an unknown consent source is refused', lambda: c.run("select upsert_guardian(:s, 'X', null, null, null, 'en', now(), 'email', null, null)", s=STU1), 'check')
g3=c.run("select upsert_guardian(:s, 'Kofi Adeyemi', 'father', null, null, 'en', null, null, null, :k)", s=STU1, k=str(uuid.uuid4()))[0][0]
ok('a second guardian without an email is fine', g3['email'] is None)
lst=c.run("select list_course_guardians(:c)", c=COURSE_A)[0][0]
ok('list_course_guardians joins through enrollment and carries enrollment_id', len(lst)==2 and all(x['enrollment_id']==ENR1 for x in lst) and [x['name'] for x in lst]==['Amara Adeyemi','Kofi Adeyemi'], lst)
as_teacher(B)
sp(); expect_error('teacher B cannot add a guardian to A\'s student', lambda: c.run("select upsert_guardian(:s, 'X', null, null, null, 'en', null, null, null, null)", s=STU1), 'P0002')
sp(); expect_error('teacher B cannot update A\'s guardian', lambda: c.run("select upsert_guardian(:s, 'X', null, null, null, 'en', null, null, :id, null)", s=STU1, id=g1['id']), 'P0002')
sp(); expect_error('teacher B cannot delete A\'s guardian', lambda: c.run("select delete_guardian(:id, null)", id=g1['id']), 'P0002')
sp(); expect_error('teacher B cannot list A\'s course guardians', lambda: c.run("select list_course_guardians(:c)", c=COURSE_A), 'P0002')
ok('teacher B sees no guardian rows directly (RLS)', c.run("select count(*) from guardian")[0][0]==0)
as_teacher(A)
d=c.run("select delete_guardian(:id, :k)", id=g1['id'], k=str(uuid.uuid4()))[0][0]
ok('delete_guardian deletes', d['deleted'] is True and len(c.run("select list_course_guardians(:c)", c=COURSE_A)[0][0])==1)
c.run("reset role"); c.run("select set_config('request.jwt.claim.sub', '', true)"); c.run("set role authenticated")
ok('with no JWT a plain read returns an empty list', c.run("select list_report_templates()")[0][0]==[])
sp(); expect_error('with no JWT a write raises PT401', lambda: c.run("select save_report_template('X', :f::jsonb, null, null)", f=json.dumps(form)), 'PT401')
sp(); expect_error('with no JWT create_report_issue raises PT401', lambda: c.run("select create_report_issue(:c, 2, 'x', 'letter', null, :s::jsonb, null)", c=COURSE_A, s=json.dumps(students)), 'PT401')
sp(); expect_error('with no JWT upsert_guardian raises PT401', lambda: c.run("select upsert_guardian(:s, 'X', null, null, null, 'en', null, null, null, null)", s=STU1), 'PT401')
c.run("reset role"); c.run("set role anon")
sp(); expect_error('anon has no execute on the RPCs', lambda: c.run("select list_report_templates()"), 'permission denied')
c.run("reset role")
c.run("rollback")
c.close()
print(f'{len(passed)} passed, {len(failed)} failed')
for p in passed: print('  ok   ', p)
for f in failed: print('  FAIL ', f)
sys.exit(1 if failed else 0)
