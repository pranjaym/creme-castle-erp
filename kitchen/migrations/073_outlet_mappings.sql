-- 073: outlet mappings for the five names missing from the location master,
-- per Pranjay, 16 Aug 2026, checked against order timelines in core.orders.
--
--   CC-PB-Ludhiana: new outlet, launched 11 Aug 2026. New location row.
--   CC-DL-South Campus: per Pranjay the Udyog Vihar store shifted here, but
--     the data shows both names active concurrently Feb to Jul 2026, so it is
--     kept as its own location with a lineage note (covenant: live data wins,
--     the conflict is surfaced, nothing is merged destructively).
--   CC-GGN-Sector 37: shifted to CC-GGN-Sector 52 in Feb 2026 (10 day
--     overlap, clean transition). Alias to the Sector 52 location so the
--     store's history reads as one thread.
--   CC-ND-Gaur City 1: became CC-ND-Diamond Plaza in Feb 2026 (2 day
--     overlap). Alias to the Diamond Plaza location.
--   'Creme Castle' (15 stray orders, Feb 2025 to Feb 2026): left unmapped on
--     purpose, keeps appearing in refresh exceptions until identified.

insert into public.locations (code, name, type, city, region, active, lifecycle, notes)
values
  ('CC-DL-South Campus', 'CC-DL-South Campus', 'dark_store', 'Delhi', 'Delhi NCR',
   true, 'active',
   'Successor of CC-GGN-Udyog Vihar per Pranjay 16 Aug 2026. Data shows both names active Feb to Jul 2026, so kept as a separate location with this lineage note. Udyog Vihar last order 20 Jul 2026.'),
  ('CC-PB-Ludhiana', 'CC-PB-Ludhiana', 'dark_store', 'Ludhiana', 'Punjab',
   true, 'active', 'Launched 11 Aug 2026.');

insert into public.location_aliases (location_id, system, external_name, note)
select id, 'petpooja', 'CC-GGN-Sector 37',
  'Sector 37 shifted to Sector 52, Feb 2026, per Pranjay 16 Aug 2026. History merged into the Sector 52 location.'
from public.locations where name = 'CC-GGN-Sector 52';

insert into public.location_aliases (location_id, system, external_name, note)
select id, 'petpooja', 'CC-ND-Gaur City 1',
  'Gaur City 1 became Diamond Plaza, Feb 2026, per Pranjay 16 Aug 2026. History merged into the Diamond Plaza location.'
from public.locations where name = 'CC-ND-Diamond Plaza';
