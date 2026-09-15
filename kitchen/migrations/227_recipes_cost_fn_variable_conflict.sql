-- 227: fix recipes.cost_of_recipe (226): the OUT column version_id clashed with
-- recipe_line.version_id inside the loop query ("column reference is ambiguous").
-- Same function, columns resolve to the table inside queries.
create or replace function recipes.cost_of_recipe(p_recipe_id bigint, p_depth int default 0)
returns table (batch_cost numeric, unit_cost numeric, packaging_cost numeric, missing_rates int, output_qty numeric, output_unit text, version_id bigint)
language plpgsql stable as $$
#variable_conflict use_column
declare v record; l record; r numeric; sub record;
        b numeric := 0; p numeric := 0; miss int := 0;
begin
  if p_depth > 12 then return; end if;
  select * into v from recipes.recipe_version rv where rv.recipe_id = p_recipe_id and rv.state = 'approved';
  if not found then return; end if;
  for l in select * from recipes.recipe_line rl where rl.version_id = v.id order by rl.line_no loop
    if l.ingredient_sku_id is not null then
      select cr.rate_per_base into r from recipes.current_rate cr where cr.sku_id = l.ingredient_sku_id;
      if r is null then miss := miss + 1; r := 0; end if;
    else
      select * into sub from recipes.cost_of_recipe(l.sub_recipe_id, p_depth + 1);
      if sub.unit_cost is null then miss := miss + 1; r := 0; else r := sub.unit_cost; miss := miss + coalesce(sub.missing_rates, 0); end if;
    end if;
    if l.role = 'packaging' then p := p + l.qty * r; else b := b + l.qty * r; end if;
  end loop;
  return query select b, b / v.output_qty, p, miss, v.output_qty, v.output_unit, v.id;
end $$;
