"""The student questionnaire templates, from the Core Competency Reflecting
Brainstorm (Nov 2024): one activity per grade per reporting period, turned
into questions a phone form can ask, plus About Me, Goal Check-In and Reply
to Report.

  python3 scripts/questionnaire_templates.py --sql   # the seed in migrations/20261025_questionnaires_templates.sql
  python3 scripts/questionnaire_templates.py --js    # shared/questionnaire-templates.js (Demo Mode's copy)

Change a template here, regenerate both, and apply the SQL as a new
migration so the database and Demo Mode stay the same."""
import json, sys

def text(prompt, **kw):
    q = {'prompt': prompt, 'kind': 'text'}
    q.update(kw)
    return q

def short_set(prompt, labels):
    return {'prompt': prompt, 'kind': 'short_set', 'options': {'labels': labels}}

def scale(cores):
    return {'prompt': 'How confident do you feel?', 'kind': 'scale4', 'core_ids': cores,
            'options': {'steps': ['Beginning', 'Growing', 'Confident', 'Leading'], 'why': 'Why?'}}

PERIOD = {1: ('November', 'Self-Awareness'), 2: ('March', 'Communication and Thinking'), 3: ('June', 'Collaboration and Responsibility')}

# grade -> period -> (theme, activity title, questions, cores)
CORE = {
    8: {
        1: ('Self-Awareness and Goal Setting', 'Personal Shield',
            [short_set('My Personal Shield: write one word or symbol for each.',
                       ['A strength', 'An interest', 'A goal', 'Something that is me']),
             text('How can these help you do well this year?')], ['PAR', 'PPI']),
        2: ('Growth in Communication Skills', 'Communication Challenge',
            [text('Describe a recent time you had to communicate clearly with someone.'),
             text('What went well, and what could you do better next time?')], ['COM']),
        3: ('Reflecting on Teamwork and Collaboration', 'Teamwork Reflection',
            [short_set('Think of a group project. Write two things you contributed and one way you can work better with others.',
                       ['Something I contributed', 'Something else I contributed', 'One way I can work better with others'])],
            ['COL']),
    },
    9: {
        1: ('Personal Strengths and Identity', 'Strengths Map',
            [short_set('List three strengths you have in and out of school.',
                       ['A strength at school', 'A strength outside school', 'Another strength']),
             text('How do these strengths shape who you are and help you every day?')], ['PPI', 'PAR']),
        2: ('Creative Thinking and Problem-Solving', 'Creative Problem Solving',
            [text('Describe a time you solved a problem in a creative way. What did you do?'),
             text('What was the result?')], ['CT']),
        3: ('Responsibility in Learning and Community Involvement', 'Responsibility Check-In',
            [text('Describe a responsibility you have had this year.'),
             text('How has it helped you grow, and what would you do differently?')], ['PAR', 'SAR']),
    },
    10: {
        1: ('Resilience and Adapting to Change', 'Resilience Timeline',
            [short_set('Write about three challenges you have faced this year. For each, write what you learned or how you grew.',
                       ['First challenge and what I learned', 'Second challenge and what I learned', 'Third challenge and what I learned'])],
            ['PAR']),
        2: ('Critical Thinking in Academics', 'Academic Critical Thinking',
            [text('Pick a recent assignment. Which one did you choose?'),
             text('How did you use critical thinking, like questioning or analyzing, to make your work better?')], ['CRT']),
        3: ('Contributions to the School Community and Future Goals', 'Community Contribution',
            [text('Describe a way you have contributed to your school or community.'),
             text('What difference did it make for others?')], ['SAR', 'PAR']),
    },
    11: {
        1: ('Personal Values and Self-Regulation', 'Values and Actions',
            [short_set('List three personal values. Next to each, write an action that shows this value in your life.',
                       ['A value and an action that shows it', 'A second value and action', 'A third value and action'])],
            ['PPI', 'PAR']),
        2: ('Balancing Perspectives in Decision-Making', 'Balanced Perspective',
            [text('Describe a time you had to make a tough decision.'),
             text('How did you balance different points of view to make a fair choice?')], ['CRT']),
        3: ('Social Responsibility and Leadership Roles', 'Leadership Moment',
            [text('Describe a time you took on a leadership role.'),
             text('What did you learn about responsibility and your effect on others?')], ['SAR', 'COL']),
    },
    12: {
        1: ('Exploring Purpose and Direction', 'Purpose Pathway',
            [text('What drives you? Write about your purpose and goals.'),
             text('How has this shaped your choices this year?')], ['PPI', 'PAR']),
        2: ('Ethical Judgment and Cultural Awareness', 'Ethical Dilemma Reflection',
            [text('Describe an ethical or cultural issue you have come across.'),
             text('How did you approach it, and what did you learn?')], ['CRT', 'SAR']),
        3: ('Preparedness for Post-Secondary Life and Career Exploration', 'Future Goals Plan',
            [text('What are your goals after high school?'),
             text('What is one skill or habit you will build to help you reach them?')], ['PAR']),
    },
}

MYED = ('We are pleased to highlight the Core Competencies as an integral part of our curriculum in British Columbia. '
        'Your student has reflected on the Core Competency of {heading} and has given thought to {theme}. '
        'You are encouraged to speak with your student about their self-reflection.')

rows = []
for grade, periods in CORE.items():
    for period, (theme, activity, qs, cores) in periods.items():
        month, heading = PERIOD[period]
        rows.append({
            'id': 'core-%d-%d' % (grade, period), 'kind': 'core_reflection', 'grade': grade, 'period': period,
            'title': '%s Reflection' % month, 'theme': theme, 'core_heading': heading,
            'myed_comment': MYED.format(heading=heading, theme=theme.lower()),
            'questions': qs + [scale(cores)],
        })

LANGS = ['English', 'Punjabi', 'Mandarin', 'Cantonese', 'Hindi', 'Arabic', 'Tagalog', 'Korean', 'Vietnamese',
         'Spanish', 'French', 'Farsi', 'Urdu']
rows.append({
    'id': 'about-me', 'kind': 'about_me', 'grade': None, 'period': None, 'title': 'About Me', 'theme': None,
    'core_heading': None, 'myed_comment': None,
    'questions': [
        text('How do you say your name?'),
        {'prompt': 'What languages do you speak at home?', 'kind': 'choice',
         'options': {'choices': LANGS, 'multiple': True, 'other': True}},
        {'prompt': 'I learn best when I work…', 'kind': 'choice',
         'options': {'choices': ['Alone', 'With a partner', 'In a group'], 'multiple': False}},
        text('What do you like to do outside school?'),
        text('What am I good at as a learner?', repeated_key='good_at',
             options={'starters': ['I am good at…', 'People say I…', 'I feel proud when…']}),
        text('What is hard for me right now?', repeated_key='hard'),
        text('What do I want to get better at in this class, and how?', repeated_key='better_at'),
        text('Is there anything else you want me to know?', teacher_only=True, options={'optional': True}),
    ],
})
rows.append({
    'id': 'goal-checkin', 'kind': 'goal_checkin', 'grade': None, 'period': None, 'title': 'Goal Check-In',
    'theme': None, 'core_heading': None, 'myed_comment': None,
    'questions': [
        {'prompt': 'How is your goal going?', 'kind': 'goal_status',
         'options': {'choices': ['Not Started', 'Working On It', 'Mostly There', 'Done']}},
        text('What will you do next?'),
        {'prompt': 'Which Core Competency do you want to grow?', 'kind': 'core_pick',
         'core_ids': ['COM', 'COL', 'CT', 'CRT', 'PPI', 'PAR', 'SAR']},
        text('My goal'),
        text('One thing I will do this week'),
    ],
})
rows.append({
    'id': 'report-reply', 'kind': 'report_reply', 'grade': None, 'period': None, 'title': 'Reply to Your Report',
    'theme': None, 'core_heading': None, 'myed_comment': None,
    'questions': [
        text('What are you most proud of?'),
        text('Was anything a surprise?'),
        {'prompt': 'Your goal: keep it or change it?', 'kind': 'choice',
         'options': {'choices': ['Keep It', 'Change It'], 'multiple': False}},
        text('One thing you will do before the next report'),
        text('Anything you want your teacher to know?'),
    ],
})

def lit(v):
    if v is None:
        return 'null'
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def sql():
    print('-- ── Templates ───────────────────────────────────────────────────────────')
    print('-- Seeded from "Core Competency Reflecting Brainstorm" (Nov 2024): one')
    print('-- activity per grade per reporting period. "Draw" prompts are written as')
    print('-- "write" for the phone form. Re-running updates them in place.')
    for r in rows:
        print(
            'insert into public.questionnaire_template (id, kind, grade, period, year, title, theme, core_heading, myed_comment, questions)\n'
            'values (%s, %s, %s, %s, 2026, %s, %s, %s, %s, %s::jsonb)\n'
            'on conflict (id) do update set kind = excluded.kind, grade = excluded.grade, period = excluded.period,\n'
            '  year = excluded.year, title = excluded.title, theme = excluded.theme, core_heading = excluded.core_heading,\n'
            '  myed_comment = excluded.myed_comment, questions = excluded.questions, updated_at = now();'
            % (lit(r['id']), lit(r['kind']), lit(r['grade']), lit(r['period']), lit(r['title']), lit(r['theme']),
               lit(r['core_heading']), lit(r['myed_comment']), lit(json.dumps(r['questions'], ensure_ascii=False))))


def js():
    out = [dict(r, year=2026) for r in rows]
    print('/* Generated by scripts/questionnaire_templates.py --js. Do not edit by hand.')
    print('   The same templates the database seeds (questionnaire_template); Demo Mode')
    print('   and a signed-out page read them from here. */')
    print('// prettier-ignore')
    print('const QUESTIONNAIRE_TEMPLATES = ' + json.dumps(out, ensure_ascii=False, indent=2) + ';')


if __name__ == '__main__':
    (js if '--js' in sys.argv else sql)()
