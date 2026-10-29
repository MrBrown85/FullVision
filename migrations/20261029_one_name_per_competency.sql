-- One name per competency for Colin's four live classes (20th Century World
-- History 12, Humanities 8, Philosophy 12, Social Studies 10).
--
-- Each competency had two names: its Title (tag.label) and its section name,
-- which the app cuts to 18 characters as the "short name" shown in the
-- gradebook name hover, dashboards, reports and the phone app. Most section
-- names were the category ("Comprehend and Connect" five times) and several
-- titles were cut-off sentences ("Explain and Infer Different") or the wrong
-- concept ("Social Analysis" for Continuity and Change). Both now hold one
-- plain name of 20 characters or fewer, so nothing is cut off. Codes,
-- wording, I Can statements, folders and scores are untouched.
--
-- A row changes only while it still holds the old section name and title, and
-- the migration stops unless all 42 competencies match. Applied with Colin's OK
-- on 2026-10-28.

do $names$
declare
    _n integer;
begin
    create temp table _nm (section_id uuid, old_section text, old_title text, new_name text) on commit drop;
    insert into _nm values
        -- 20th Century World History 12
        ('4cd42af7-783c-44cd-8d00-9a5c465df16f', 'Use historical inquiry processes and skills', 'Historical Inquiry', 'Historical Inquiry'),
        ('939a8499-1ec6-4aab-aed5-b63babd7a053', 'Significance', 'Historical Development', 'Significance'),
        ('2d06aa65-b069-4fa9-90c5-3c0902d26552', 'Evidence', 'Analyze Sources', 'Evidence'),
        ('7ab0acdb-8d57-4958-a78f-c7249c5924fb', 'Continuity and Change', 'Social Analysis', 'Continuity & Change'),
        ('b8095b92-2e39-4823-81bc-aa34e4fcfa4d', 'Cause and Consequence', 'Historical Cause and Effect', 'Cause & Consequence'),
        ('b8bb58d3-f7c4-42a5-83f4-435583cbdd25', 'Perspective', 'Historical Perspective', 'Perspective'),
        ('b0fa8e99-0c6e-4c91-bb5b-f82ff24a7bde', 'Ethical Judgment', 'Ethical Judgment', 'Ethical Judgment'),
        -- Humanities 8
        ('0f53803e-7987-4ec3-bd37-a9cd87241222', 'Text Types & Genres', 'Text Types & Genres', 'Text Types & Genres'),
        ('7b03d68d-10e4-4447-8f30-77b022b53793', 'Evaluating Information', 'Evaluating Information', 'Judging Information'),
        ('fd3f6a70-5cd2-4e9c-b965-aa6470dd5683', 'Reading & Writing Strategies', 'Reading & Writing Strategies', 'Reading & Writing'),
        ('0931bbcb-6850-43bf-899f-0696e7b6ec35', 'Literacy Skills', 'Language & Style', 'Language & Style'),
        ('7ae5b5f7-28b7-4743-9f05-296b67ae6ae5', 'Literacy Skills', 'Conventions & Presentation', 'Conventions'),
        ('e5767007-4df4-456e-80d1-ac39b43ff59c', 'Comprehend and Connect', 'Access & Assess Information', 'Finding Information'),
        ('998a338a-cdcc-424d-bdfc-201e218ea4ce', 'Comprehend and Connect', 'Comprehension & Synthesis', 'Comprehension'),
        ('9b002c5f-d54e-4c26-a400-8f3dcc890b73', 'Comprehend and Connect', 'Appreciate Texts', 'Appreciate Texts'),
        ('42fe8a3b-8aed-467f-ac9f-2a70e1806e9f', 'Comprehend and Connect', 'Personal Connections', 'Personal Connections'),
        ('7f8772f1-0c14-467f-be77-a810054aa41c', 'Comprehend and Connect', 'First Peoples Perspectives', 'First Peoples Texts'),
        ('6ecdfb94-c4f9-4e8c-b008-b6f3ac24d54a', 'Create and Communicate', 'Exchange Ideas', 'Exchange Ideas'),
        ('ec2c4425-1e29-4c48-87b1-da15d1181075', 'Create and Communicate', 'Writing & Design Process', 'Writing Process'),
        ('71ee6845-ecb9-449e-8481-1eb800ab42e5', 'Create and Communicate', 'Assess & Refine', 'Assess & Refine'),
        ('0bffb259-b962-4987-8e48-3c46270af6d4', 'Create and Communicate', 'Spelling & Grammar', 'Spelling & Grammar'),
        ('fa0d1785-4ed5-46f2-bd08-a5b5819eb6ce', 'Create and Communicate', 'Oral Storytelling & Composition', 'Oral Storytelling'),
        ('c581fe90-5f3c-4346-a437-98ce72fb8212', 'Historical Thinking Skills', 'Inquiry Skills', 'Inquiry Skills'),
        ('864a39d9-ed92-44fb-819a-853e36cf9207', 'Historical Thinking Skills', 'Historical Significance', 'Significance'),
        ('5ab8ca6b-fbb5-402c-9e55-9c2214d94878', 'Historical Thinking Skills', 'Interpreting Accounts', 'Reading Accounts'),
        ('bd361e55-3cf6-4d24-889e-51e37210c7ec', 'Historical Thinking Skills', 'Source Reliability', 'Source Reliability'),
        ('3b49529e-d284-4650-a671-261d69bb518e', 'Historical Thinking Skills', 'Continuity & Change', 'Continuity & Change'),
        ('4caa2916-13c5-4d1b-8260-75504f277afc', 'Historical Thinking Skills', 'Cause & Consequence', 'Cause & Consequence'),
        ('116ecff1-aca7-4664-b857-35fdb945f491', 'Historical Thinking Skills', 'Perspective', 'Perspective'),
        ('4d97588f-e2d4-4d00-a200-aee1dd1336ac', 'Historical Thinking Skills', 'Ethical Judgment', 'Ethical Judgment'),
        -- Philosophy 12
        ('3ff0bca8-bb64-411c-b44f-8683235347c1', 'Reasoning and Inquiry', 'Critical Inquiry', 'Reasoning & Inquiry'),
        ('cdaad6d8-4dab-49b9-bcda-d4b8e61c015f', 'Application', 'Evaluate Evidence', 'Application'),
        ('60debec9-fbe2-494d-ab80-afa98206b756', 'Analysis and Assessment', 'Compare Perspectives', 'Analyzing Ideas'),
        ('7613f1d2-e778-47d9-ad3b-f06f41380445', 'Historical Understanding', 'Social Analysis', 'History of Ideas'),
        ('4a16a27a-07e3-4f53-9e91-60d900f25d06', 'Perspective', 'Multiple Perspectives', 'Perspective'),
        -- Social Studies 10
        ('2efc388b-d55f-48b2-90e4-e1f90d3af0a5', 'Use Social Studies inquiry processes and skills', 'Use Social Studies Inquiry', 'Inquiry'),
        ('3e4b60ae-7a81-467b-bf3a-91797907f626', 'Significance', 'Assess the Significance', 'Significance'),
        ('08f0663e-f5f0-4138-8eff-c77263bbb7b7', 'Evidence', 'Assess Competing Accounts', 'Evidence'),
        ('da3dc770-ca49-4169-b483-2dda38c03cda', 'Continuity and Change', 'Compare and Contrast Continuities', 'Continuity & Change'),
        ('327ec470-34e6-4436-b04d-22185f2c10ae', 'Cause and Consequence', 'Assess How Underlying Conditions', 'Cause & Consequence'),
        ('cb62c653-af96-4d0b-8368-f664f960a75a', 'Perspective', 'Explain and Infer Different', 'Perspective'),
        ('d2530a7e-fa30-47d4-96e8-ddc9d2d21c1b', 'Ethical Judgment', 'Make Reasoned Ethical Judgments', 'Ethical Judgment');

    select count(*) into _n
      from _nm join public.section s on s.id = _nm.section_id
      join public.tag t on t.section_id = s.id
     where s.name = _nm.old_section and t.label = _nm.old_title;
    if _n <> 42 then
        raise exception 'expected 42 competencies with their old names, found %', _n;
    end if;

    update public.section s
       set name = _nm.new_name, updated_at = now()
      from _nm
     where s.id = _nm.section_id and s.name is distinct from _nm.new_name;

    update public.tag t
       set label = _nm.new_name, updated_at = now()
      from _nm
     where t.section_id = _nm.section_id and t.label is distinct from _nm.new_name;
end
$names$;
