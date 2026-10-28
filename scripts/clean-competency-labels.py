#!/usr/bin/env python3
"""Readable competency labels for curriculum_by_course.json.

Many labels in the file were cut from the first words of the competency
statement ("Create Thoughtful Engaging", "Formulate Physical or Mental",
"Analyze Respond Dramatic"); the questionnaire's Comment Bank and the printed
Proficiency block put them in sentences. This rewrites only those cut labels:

  - a category with one competency takes the category's own name, BC's
    organizer ("Evaluating", "Cause and Consequence", "Physical Literacy"),
    with a few sentence-like category names shortened (OVERRIDE_CATEGORY);
  - otherwise the statement's first clause as a gerund phrase ("Building and
    Testing Circuits Safely"), trimmed at a sensible boundary;
  - OVERRIDE_LABEL wins where a hand-written label reads better.

Labels that were written by hand ("Comprehension Strategies", "Design
Thinking") are left alone. Existing classes keep the labels they imported;
new imports and the Class Management competencies get these.

Usage: python3 scripts/clean-competency-labels.py [--check]
Writes curriculum_by_course.json and curriculum_data.js; --check only reports.
"""
import json, re, sys

STOP = set('a an the and or of to in for with on by from through about as at that which into'.split())
TAIL_STOP = STOP | {'their', 'own', 'how', 'when', 'while', 'within', 'across', 'among', 'between', 'using'}

OVERRIDE_CATEGORY = {
    'Use Social Studies inquiry processes and skills': 'Inquiry',
    'Examine': 'Examining Influences',
    'Interact': 'Interacting and Mentorship',
    'Experience': 'Workplace Experience',
    'Initiate': 'Career-Life Exploration',
}

OVERRIDE_LABEL = {
    # (course tag, old label): new label, where no rule reads well.
    ('EFPW10', 'Create Writing That Expresses'): 'Creative Writing',
    ('EFPW10', 'Develop Writing That Serves'): 'Writing for a Purpose',
    ('EFPLS10', 'Respond Creatively to Indigenous'): 'Creative Responses to Indigenous Texts',
    ('COMP10', 'Explore How Language Constructs'): 'How Language Constructs Identity',
    ('THPROD12', 'Plan Trajectory Toward'): 'Planning a Career Path',
}

IRREGULAR = {
    'be': 'being', 'see': 'seeing', 'die': 'dying', 'lie': 'lying', 'tie': 'tying', 'practice': 'practising',
    'practise': 'practising', 'model': 'modelling', 'label': 'labelling', 'travel': 'travelling', 'program': 'programming',
    'plan': 'planning', 'run': 'running', 'set': 'setting', 'get': 'getting', 'cut': 'cutting', 'fit': 'fitting',
    'map': 'mapping', 'wrap': 'wrapping', 'drop': 'dropping', 'stop': 'stopping', 'shop': 'shopping', 'ship': 'shipping',
    'format': 'formatting', 'edit': 'editing', 'visit': 'visiting', 'limit': 'limiting', 'exhibit': 'exhibiting',
    'develop': 'developing', 'open': 'opening', 'listen': 'listening', 'enter': 'entering', 'offer': 'offering',
    'order': 'ordering', 'deliver': 'delivering', 'consider': 'considering', 'gather': 'gathering', 'market': 'marketing',
    'budget': 'budgeting', 'audit': 'auditing', 'benefit': 'benefiting', 'interpret': 'interpreting', 'focus': 'focusing',
    'refer': 'referring', 'prefer': 'preferring', 'occur': 'occurring', 'control': 'controlling', 'begin': 'beginning',
    'forget': 'forgetting', 'admit': 'admitting', 'commit': 'committing', 'submit': 'submitting', 'transmit': 'transmitting',
    'quit': 'quitting', 'knit': 'knitting', 'sew': 'sewing', 'weld': 'welding', 'draw': 'drawing', 'sketch': 'sketching',
}
# A phrase that ends on one of these was cut mid-thought.
FRAGMENT_END = set('how use convey address serve express build meet other personal technical oral shared various multiple different new own such more most during associated related based including established proper appropriate toward towards beyond within seo etc'.split())


def fragment(w):
    lw = w.lower()
    return lw in FRAGMENT_END or (len(lw) > 5 and lw.endswith(('ary', 'ous', 'ive', 'ical', 'ional', 'ural', 'ual')))
# Words that start a competency statement and are not verbs.
NOT_VERB = {'daily', 'regular', 'safe', 'personal', 'social', 'physical', 'mental', 'health', 'self', 'community'}


def gerund(v):
    w = v.lower()
    if w in IRREGULAR:
        return IRREGULAR[w]
    if w.endswith('ie'):
        return w[:-2] + 'ying'
    if w.endswith('e') and not w.endswith(('ee', 'ye', 'oe')):
        return w[:-1] + 'ing'
    if re.search(r'^[a-z]*[^aeiouy][aeiou][bdgmnprtv]$', w) and len(w) <= 5:
        return w + w[-1] + 'ing'
    return w + 'ing'


# Verbs whose endings look like nouns or adjectives.
VERB_OK = {'convey', 'shape', 'portray', 'challenge', 'reflect', 'construct', 'create', 'serve', 'use', 'affect', 'influence', 'support', 'inform', 'guide', 'document', 'implement', 'experiment', 'comment', 'present', 'represent', 'invent', 'prevent', 'assess', 'express', 'address', 'process', 'access', 'discuss', 'focus', 'balance', 'influence', 'experience', 'reference', 'advance', 'enhance', 'finance', 'sequence', 'practise', 'practice', 'question', 'position', 'function', 'mention', 'caution', 'partition', 'audition', 'champion', 'fashion', 'envision', 'commission', 'compose', 'suppose', 'propose', 'oppose', 'expose', 'close', 'choose', 'use', 'diagnose', 'analyse', 'revise', 'devise', 'supervise', 'exercise', 'improvise', 'advertise', 'organise', 'utilise', 'realise', 'recognise', 'summarise', 'emphasise', 'prioritise', 'specialise', 'visualise', 'optimise', 'customise', 'maximise', 'minimise', 'critique', 'value', 'signal', 'total', 'model', 'label', 'travel', 'control', 'fulfil', 'install', 'recall', 'enrol', 'appeal', 'reveal', 'deal', 'heal', 'seal', 'steal', 'kneel', 'feel', 'peel', 'wheel', 'drive', 'arrive', 'survive', 'thrive', 'achieve', 'believe', 'receive', 'perceive', 'conceive', 'relieve', 'retrieve', 'give', 'live', 'forgive', 'strive', 'derive', 'dive', 'revive', 'deliver', 'consider', 'discover', 'recover', 'uncover', 'remember', 'gather', 'further', 'offer', 'suffer', 'differ', 'transfer', 'prefer', 'refer', 'infer', 'confer', 'defer', 'register', 'administer', 'master', 'foster', 'monitor', 'mentor', 'tailor', 'honour', 'honor', 'colour', 'color', 'favour', 'favor', 'flavour', 'harbour', 'labour', 'author', 'anchor', 'sponsor', 'tutor', 'edit', 'audit', 'credit', 'exhibit', 'inhibit', 'prohibit', 'limit', 'visit', 'benefit', 'profit', 'submit', 'commit', 'transmit', 'omit', 'permit', 'admit', 'emit'}


# The words that begin competency statements, read from the file itself: a
# word that never starts one is not treated as a verb.
LEXICON = set()


def is_verb(w):
    w = w.lower()
    if w in VERB_OK or w in IRREGULAR:
        return True
    if LEXICON:
        return w in LEXICON and w not in NOT_VERB and w not in STOP
    return (
        re.match(r"^[a-z]+$", w)
        and w not in STOP
        and w not in NOT_VERB
        and not w.endswith(('ing', 'ly', 'ness', 'tion', 'sion', 'ity', 'ment', 'ance', 'ence', 'ship', 'ism', 'ics', 'ogy', 'ure', 'ous', 'ive', 'ful', 'al'))
    )


def title(w, first):
    lw = w.lower()
    if not first and lw in STOP:
        return lw
    if w.isupper() or (len(w) > 1 and any(ch.isupper() for ch in w[1:])):
        return w  # acronyms, proper mixes
    return w[0].upper() + w[1:]


def gerund_phrase(raw, limit=5):
    first = re.split(r'[;:\u2014\u2013]| - ', raw)[0].strip()
    first = re.sub(r'\s*\([^)]*\)', '', first)
    first = re.sub(r',?\s+(e\.g\.|i\.e\.|such as|including|in order to)\b.*$', '', first, flags=re.I)
    words = re.findall(r"[A-Za-z0-9][A-Za-z0-9'\-/]*|,", first)
    # Leading adverbs ("Collaboratively and individually plan") go.
    i = 0
    while i < len(words) and ((words[i].lower().endswith('ly') and not is_verb(words[i])) or words[i].lower() in ('and', 'or')):
        i += 1
    if i < len(words) and is_verb(words[i]):
        out = [gerund(words[i])]
        j = i + 1
        # "plan and conduct" -> "planning and conducting"
        # "Develop and embody…": the word paired with the first verb is one too.
        while (
            j + 1 < len(words)
            and words[j].lower() in ('and', 'or', ',')
            and (is_verb(words[j + 1]) or (j == i + 1 and words[j + 1].lower() not in STOP and not words[j + 1].lower().endswith(('ing', 's'))))
        ):
            out += [words[j], gerund(words[j + 1])]
            j += 2
        out += words[j:]
        words = out
    # A clause that explains the purpose ("to build shared understanding",
    # "that meet customer needs") goes once the phrase has two content words.
    cut = []
    content = 0
    for k, w in enumerate(words):
        lw = w.lower()
        if content >= 2 and lw in ('that', 'which', 'so', 'because', 'while', 'when', ','):
            break
        if content >= 3 and lw in ('to', 'for', 'with', 'by', 'through', 'using', 'within', 'toward', 'towards', 'across'):
            break
        # A second clause ("…and understand their role") goes with its verb;
        # "and design processes" is part of the first and stays.
        # "…and understand their role" starts a new clause and goes;
        # "…and design principles" is a noun in the first and stays.
        if lw in ('and', 'or') and k + 1 < len(words) and is_verb(words[k + 1]) and not words[k + 1].lower().endswith('ing'):
            nxt = words[k + 2].lower() if k + 2 < len(words) else ''
            if content >= 2 and (not nxt.endswith('s') or nxt in ('this', 'these', 'those', 'his', 'its', 'towards')):
                break
        if lw == ',':
            continue
        cut.append(w)
        if lw not in STOP:
            content += 1
    words = cut
    # "Analyze how Indigenous writers use language": keep through the inner
    # verb and its object, which the trims below would cut.
    lows = [w.lower() for w in words]
    if 'how' in lows:
        h = lows.index('how')
        v = next((k for k in range(h + 1, len(words)) if is_verb(words[k]) or (words[k].lower().endswith('s') and is_verb(words[k][:-1]))), None)
        if v is not None:
            end = v + 1
            got = 0
            while end < len(words) and got < 2 and lows[end] not in ('to', 'that', 'which', 'for', 'and', 'or', ','):
                if lows[end] not in STOP:
                    got += 1
                end += 1
            out = ' '.join(title(w, k == 0) for k, w in enumerate(words[:end]))
            if len(out) > 60 and end > v + 2:
                out = ' '.join(title(w, k == 0) for k, w in enumerate(words[: v + 2]))
            return out
    # Trim to `limit` content words at a boundary that is not a stop word.
    kept = []
    content = 0
    for w in words:
        if content >= limit and w.lower() not in STOP:
            break
        kept.append(w)
        if w.lower() not in STOP:
            content += 1
    while kept and (kept[-1].lower() in TAIL_STOP or fragment(kept[-1])):
        kept.pop()
    # The trim cut inside a pair ("…and Diverse |Traditions"): drop the pair.
    if len(kept) < len(words) and len(kept) >= 3 and kept[-2].lower() in ('and', 'or'):
        kept = kept[:-2]
    # Still long: one content word fewer.
    if len(' '.join(kept)) > 60 and limit > 3:
        return gerund_phrase(raw, limit - 1)
    return ' '.join(title(w, k == 0) for k, w in enumerate(kept))


def content_words(t):
    return [w for w in re.findall(r"[a-z][a-z'\-]*", t.lower()) if w not in STOP]


DANGLING = ('and', 'or', 'of', 'to', 'in', 'for', 'with', 'using', 'how', 'about', 'on', 'by', 'from', 'through')


def dangles(label):
    return label.split()[-1].lower() in DANGLING


def was_cut(label, raw):
    lw, rw = content_words(label), content_words(raw)
    if dangles(label):
        return True
    return bool(lw) and rw[:len(lw)] == lw and label.split()[0].lower() == raw.split()[0].lower()


def clean(data):
    LEXICON.update(c['raw'].split()[0].lower() for course in data.values() for cat in course['categories'] for c in cat['competencies'] if c['raw'].strip())
    LEXICON.discard('daily')
    changes = []
    for tag, course in data.items():
        seen = set()
        for cat in course['categories']:
            n = len(cat['competencies'])
            for c in cat['competencies']:
                old = c['short_label']
                key = (tag, old)
                if key in OVERRIDE_LABEL:
                    new = OVERRIDE_LABEL[key]
                elif not was_cut(old, c['raw']):
                    new = old
                elif n == 1:
                    new = OVERRIDE_CATEGORY.get(cat['name'], cat['name'])
                elif len(content_words(old)) < 3 and not dangles(old):
                    # "Access Information", "Design Products": short and whole.
                    new = old
                else:
                    new = gerund_phrase(c['raw'])
                if new in seen and new != old:
                    new = gerund_phrase(c['raw'], 7)
                seen.add(new)
                if new != old:
                    changes.append((tag, cat['name'], old, new, c['raw']))
                    c['short_label'] = new
    return changes


def main():
    check = '--check' in sys.argv
    data = json.load(open('curriculum_by_course.json'))
    changes = clean(data)
    # Category names are BC's own ("Comprehend and Connect") and pass as they are.
    cats = {cat['name'] for course in data.values() for cat in course['categories']} | set(OVERRIDE_CATEGORY.values())
    bad = [
        c
        for c in changes
        if c[3] not in cats
        and (len(c[3]) > 60 or (is_verb(c[3].split()[0]) and not c[3].split()[0].lower().endswith('ing')) or c[3].split()[-1].lower() in TAIL_STOP)
    ]
    print(f'{len(changes)} labels rewritten; {len(bad)} look wrong')
    for c in bad[:40]:
        print('  ', c[0], repr(c[2]), '->', repr(c[3]))
    if check:
        for c in changes:
            print(f'{c[0]:10} {c[2]!r:45} -> {c[3]!r}')
        return
    json.dump(data, open('curriculum_by_course.json', 'w'), ensure_ascii=False, indent=2)
    js = open('curriculum_data.js').read()
    head = js[: js.index('{')]
    tail = js[js.rindex('}') + 1 :]
    open('curriculum_data.js', 'w').write(head + json.dumps(data, ensure_ascii=False) + tail)


if __name__ == '__main__':
    main()
