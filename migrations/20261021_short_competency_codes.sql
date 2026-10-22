-- Short codes for Colin's four live classes (20th Century World History 12,
-- Humanities 8, Philosophy 12, Social Studies 10).
--
-- Classes made before 2026-10-21 saved the competency's category name as its
-- code ("Application", "Historical Underst…", "Literacy Skills" five times), so
-- gradebook column headers ran into each other and several columns read the
-- same. Each competency gets the code the curriculum file gives its title, or
-- its title's initials where the file has none (or only a nonsense code, as
-- for World History 12's LF / LF1). Approved by Colin on 2026-10-21; the other
-- account's classes are left as they are.
--
-- A row changes only while it still holds the old code, so a code a teacher
-- changed since is kept. The migration stops unless all 42 rows change.

do $codes$
declare
    _n integer;
begin
    update public.tag t
       set code = v.new_code, updated_at = now()
      from (values
        -- 20th Century World History 12
        ('a93b4221-3521-4e95-a4a9-4fe7be69ce7c', 'USEHISTORI', 'HI'),
        ('36abaa1b-aa42-41d1-8b47-bd1d85000f31', 'Significance', 'HD'),
        ('6d4c7c03-af87-4433-887b-b92e95b71849', 'Evidence', 'AS'),
        ('528a9111-6f3f-4967-b7be-7953c07c30bf', 'Continuity', 'SA'),
        ('4d74befc-65e4-41af-ae40-6264ea004141', 'Cause', 'HCE'),
        ('837acbb9-3e00-42c2-b9ec-3f8192fc7040', 'Perspective', 'HP'),
        ('07b513c3-4655-4f05-b7ca-0d69d9feff7f', 'Ethical Judgment', 'AS2'),
        -- Humanities 8
        ('da5dd7e9-67a0-489b-be26-40712188e549', 'LITERACYSK', 'LS-TG'),
        ('79e223c8-34d1-46ec-a8d6-d8b1053e63e2', 'Literacy Skills', 'LS-EI'),
        ('997ed000-21f1-45ea-9b58-d9e453152445', 'Literacy Skills', 'LS-RW'),
        ('2d9f3d6d-ed6b-4ee6-8aa0-d67304932836', 'Literacy Skills', 'LS-LS'),
        ('b591db8b-b644-4eed-8236-3d7bba08d867', 'Literacy Skills', 'LS-CP'),
        ('cafc9b3d-5b5b-4a68-b5dc-66fcc576434d', 'Comprehend', 'CC-AA'),
        ('36f6108f-b410-4944-86c0-ff26e3a09e06', 'Comprehend', 'CC-CS'),
        ('296b37cd-fad5-4ad0-b878-b075c03bb00a', 'Comprehend', 'CC-AT'),
        ('d1e68b92-fd25-477d-87a0-5f2c666db9cc', 'Comprehend', 'CC-PC'),
        ('cbc96030-f83b-41fd-80b9-9eef5faf9a1f', 'Comprehend', 'CC-FP'),
        ('24f4014b-d986-47fb-a337-e57639133b97', 'Create', 'CM-EX'),
        ('62e70055-0cfb-4dea-a1a1-57bce027072d', 'Create', 'CM-WD'),
        ('0b7eab87-ff26-4f17-ad8b-79c683b94083', 'Create', 'CM-AR'),
        ('714269d9-7652-476e-91bd-2fdc46a27a68', 'Create', 'CM-SG'),
        ('b90d10d0-fce4-448f-8171-3f58fb273fcf', 'Create', 'CM-OS'),
        ('49d57cf8-0832-4f42-8d2a-a883ef67038e', 'Historical Thinkin…', 'HT-IS'),
        ('8d7b6fc5-8f43-4a46-a73d-5a6dc5166b69', 'Historical Thinkin…', 'HT-HS'),
        ('ec36b198-57c2-4f80-abbd-fbc2cadb70c6', 'Historical Thinkin…', 'HT-IA'),
        ('c26a4f15-de55-4ccb-b4e3-30a418efc21f', 'Historical Thinkin…', 'HT-SR'),
        ('44675298-5aef-467e-9a70-65f0c23aa084', 'Historical Thinkin…', 'HT-CC'),
        ('5477529b-5f2b-43eb-a9c9-f99c4451084b', 'Historical Thinkin…', 'HT-CQ'),
        ('e0069c45-86d1-4b0f-ac6f-e84af1b0be48', 'Historical Thinkin…', 'HT-PE'),
        ('5d9fc436-f760-45fc-a451-8fd50679c390', 'Historical Thinkin…', 'HT-EJ'),
        -- Philosophy 12
        ('77862aba-7584-49a6-aa9b-e19d35616f16', 'REASONING', 'CI'),
        ('70e6957c-cb2a-464f-ba2f-72926eb223f4', 'Application', 'EE'),
        ('4a0ca977-ca91-4c6e-8fe7-4193d2497c77', 'Analysis', 'CP'),
        ('87e01894-d0d3-4e52-b646-7b0a93a8a51d', 'Historical Underst…', 'SA'),
        ('35c152c2-83f0-47ff-8f8b-8a6b056ed1f0', 'Perspective', 'MP'),
        -- Social Studies 10
        ('4c94a9a2-93f3-4665-a61d-8af99f6291c0', 'Use Social Studies…', 'USS'),
        ('8630e22a-71bf-47fe-a9f8-a69da08ce909', 'Significance', 'AS'),
        ('e98ce8f8-cd30-4dbd-87b0-7d414dd1a44b', 'Evidence', 'ACA'),
        ('e20518da-0687-45d5-83ab-b2e180387553', 'Continuity', 'CCC'),
        ('90762a49-380e-487e-8e87-935775f8192d', 'Cause', 'AHU'),
        ('ab7b2002-5b22-449f-876e-71c24aec19d7', 'Perspective', 'EID'),
        ('029bd449-d382-460d-a714-8acb25fa0ade', 'Ethical Judgment', 'MRE')
      ) as v(id, old_code, new_code)
     where t.id = v.id::uuid and t.code = v.old_code;
    get diagnostics _n = row_count;
    if _n <> 42 then
        raise exception 'expected 42 codes to change, % would', _n;
    end if;
end
$codes$;
