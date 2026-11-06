# Reviewing One Batch of Course-Set Wording

You are an independent reviewer. Another agent wrote `data/course-sets/<batch>.json` following `WRITE-BRIEF.md` (read it: it is the spec). The approved quality bar is `docs/course-sets/approved-sample.md`. Your job is to make every line something Colin (a Surrey BC teacher, the owner) would put in a report card for a family, and to fix in place what isn't.

## Read Every Set and Check

1. **Read-aloud test.** Would a parent reading this cold understand it, and why it's said about their child? Colin flagged "The next step for her is to suggest fitting ways to remember or respond to a past wrong" and "At home, you can ask her whether a decision from the past was fair, given what people knew then" as "a super-weird thing to say to someone". Lines like "She is ready to explain who should take action on a past wrong today and what it could be" fail the same way. Rewrite them as a plain thinking skill.
2. **Next steps are skills or work habits, never content.** No topic, text, unit, product or set activity. Not "This term, …" (grades are year to date; drop it).
3. **True to the Ministry wording and I Can statements** of that set's courses (in `curriculum_by_course.json`). Cut invented specifics a teacher couldn't stand behind (named tools, materials, routines, examples the Ministry doesn't name), unless they are ordinary for every course in the set.
4. **Grade level.** Grade 8–9 wording reads clearly younger than 10–12.
5. **Specific, not generic.** Colin wants each course set's own wording, longer and richer, never plainer. If a set's lines would fit any course, make them about this one.
6. **Sensitive topics** (health, abuse, substance use, identity, bullying, residential schools, genocide, historical wrongs): nothing that asks a family to probe or judge; home lines stay gentle and optional.
7. **Partition.** Courses grouped together really ask for the same thing; split a set only if it's clearly wrong (keep every competency id in exactly one set).
8. Canadian spelling, Indigenous terms, voice rules, slots and `[s-form|plain]` verbs as in the write brief.

## Fix and Log

Edit `data/course-sets/<batch>.json` in place (git keeps the earlier version). Then run `node scripts/check-course-sets.mjs data/course-sets/<batch>.json` until it prints `clean`. The app's lint bans phrasal verbs like "work on", "get in", "look for", "set out", "work through", and words like "creative", "sound", "kind", "classmates".

Write `docs/course-sets/review/<batch>.md`: counts (sets read, lines changed), then every change as `set id · field: old → new · why` (one line each), and anything Colin must decide. Reply in under 6 lines: lines changed, the checker's last line, and the most important fixes.
