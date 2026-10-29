-- Wording for one teacher's two live classes (English Studies 12 d2243ab2…,
-- Humanities 8 688ec2ad…), ahead of the assignment picker showing each
-- competency's wording instead of its category name.
--
-- The picker used to print section.name on every row. That teacher typed each
-- competency's full curriculum wording into section.name so the rows could be
-- told apart, and left tag.i_can_text (the wording field) blank on 29 of them.
-- Six more in Humanities 8 hold the wrong competency's wording, shifted down a
-- row ("Determining Causes" reads "Transform ideas and information…"), and 14
-- carry the curriculum wording with small differences from the name. Copying
-- section.name into i_can_text keeps the picker showing exactly what the
-- teacher sees today once it reads the wording.
--
-- Sections with a blank name (two "Standard" rows) are left alone; the picker
-- keeps showing "Standard" for them. A row changes only while its section name
-- and wording differ, and the migration stops unless all 49 rows change.

do $wording$
declare
    _n integer;
begin
    update public.tag t
       set i_can_text = s.name, updated_at = now()
      from public.section s
     where s.id = t.section_id
       and s.course_id in ('d2243ab2-fcf8-4104-9a8d-eb1ee7753081',
                           '688ec2ad-f5b9-4150-bc39-55d39633b216')
       and s.name <> ''
       and t.i_can_text is distinct from s.name;
    get diagnostics _n = row_count;
    if _n <> 49 then
        raise exception 'expected 49 competencies to change, got %', _n;
    end if;
end
$wording$;
