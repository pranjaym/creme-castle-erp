-- Migration 005: SEED locations + aliases (generated, schema v2)
-- Canonical CK/dispatch/spoke/warehouse set with SupplyNote legacy names as
-- aliases, plus the CC-... dark stores. Regenerate: scripts/gen_seed_sql.py.

insert into locations (code, name, type, city, region) values
  ('CK', 'Central Kitchen (Noida)', 'central_kitchen'::location_type, null, 'Delhi NCR'),
  ('CK-SPONGE', 'Sponge and Ganache Dept', 'kitchen_department'::location_type, null, 'Delhi NCR'),
  ('CK-DESSERT', 'Dessert Dept', 'kitchen_department'::location_type, null, 'Delhi NCR'),
  ('CK-CAKE', 'Cake Dept', 'kitchen_department'::location_type, null, 'Delhi NCR'),
  ('FREEZER-CK', 'Central Kitchen Freezer', 'freezer'::location_type, null, 'Delhi NCR'),
  ('CDIS', 'Central Dispatch', 'central_dispatch'::location_type, null, 'Delhi NCR'),
  ('CWH', 'Central Warehouse', 'central_warehouse'::location_type, null, 'Delhi NCR'),
  ('SK-ND-Sector 67', 'Spoke: Noida Sector 67', 'assembly_spoke'::location_type, null, 'Delhi NCR'),
  ('SK-DL-Janakpuri', 'Spoke: Janakpuri', 'assembly_spoke'::location_type, null, 'Delhi NCR'),
  ('SK-GGN-Sikanderpur', 'Spoke: Sikanderpur', 'assembly_spoke'::location_type, null, 'Delhi NCR'),
  ('CC-CHD-Industrial Area', 'CC-CHD-Industrial Area', 'dark_store'::location_type, 'Chandigarh', 'Chandigarh'),
  ('CC-CHD-Mohali', 'CC-CHD-Mohali', 'dark_store'::location_type, 'Chandigarh', 'Chandigarh'),
  ('CC-CHD-Sector 16', 'CC-CHD-Sector 16', 'dark_store'::location_type, 'Chandigarh', 'Chandigarh'),
  ('CC-CHD-Zirakpur', 'CC-CHD-Zirakpur', 'dark_store'::location_type, 'Chandigarh', 'Chandigarh'),
  ('CC-DL-Dwarka', 'CC-DL-Dwarka', 'dark_store'::location_type, 'Delhi', 'Delhi NCR'),
  ('CC-DL-Dwarka Mor', 'CC-DL-Dwarka Mor', 'dark_store'::location_type, 'Delhi', 'Delhi NCR'),
  ('CC-DL-Janakpuri', 'CC-DL-Janakpuri', 'dark_store'::location_type, 'Delhi', 'Delhi NCR'),
  ('CC-DL-Karol Bagh', 'CC-DL-Karol Bagh', 'dark_store'::location_type, 'Delhi', 'Delhi NCR'),
  ('CC-DL-Krishna Nagar', 'CC-DL-Krishna Nagar', 'dark_store'::location_type, 'Delhi', 'Delhi NCR'),
  ('CC-DL-Mayur Vihar Ph 3', 'CC-DL-Mayur Vihar Ph 3', 'dark_store'::location_type, 'Delhi', 'Delhi NCR'),
  ('CC-DL-NFC', 'CC-DL-NFC', 'dark_store'::location_type, 'Delhi', 'Delhi NCR'),
  ('CC-DL-Paschim Vihar', 'CC-DL-Paschim Vihar', 'dark_store'::location_type, 'Delhi', 'Delhi NCR'),
  ('CC-DL-Rohini', 'CC-DL-Rohini', 'dark_store'::location_type, 'Delhi', 'Delhi NCR'),
  ('CC-DL-Sarita Vihar', 'CC-DL-Sarita Vihar', 'dark_store'::location_type, 'Delhi', 'Delhi NCR'),
  ('CC-DL-Shahpurjat', 'CC-DL-Shahpurjat', 'd2c_fulfillment'::location_type, 'Delhi', 'Delhi NCR'),
  ('CC-DL-Shalimar Bagh', 'CC-DL-Shalimar Bagh', 'dark_store'::location_type, 'Delhi', 'Delhi NCR'),
  ('CC-DL-Vasant Kunj', 'CC-DL-Vasant Kunj', 'dark_store'::location_type, 'Delhi', 'Delhi NCR'),
  ('CC-FBD-Sector 15', 'CC-FBD-Sector 15', 'd2c_fulfillment'::location_type, 'Faridabad', 'Delhi NCR'),
  ('CC-FBD-Sector 37', 'CC-FBD-Sector 37', 'dark_store'::location_type, 'Faridabad', 'Delhi NCR'),
  ('CC-GGN-DLF Ph 4', 'CC-GGN-DLF Ph 4', 'dark_store'::location_type, 'Gurgaon', 'Delhi NCR'),
  ('CC-GGN-Sector 4', 'CC-GGN-Sector 4', 'dark_store'::location_type, 'Gurgaon', 'Delhi NCR'),
  ('CC-GGN-Sector 49', 'CC-GGN-Sector 49', 'dark_store'::location_type, 'Gurgaon', 'Delhi NCR'),
  ('CC-GGN-Sector 52', 'CC-GGN-Sector 52', 'dark_store'::location_type, 'Gurgaon', 'Delhi NCR'),
  ('CC-GGN-Sector 60', 'CC-GGN-Sector 60', 'dark_store'::location_type, 'Gurgaon', 'Delhi NCR'),
  ('CC-GGN-Sector 86', 'CC-GGN-Sector 86', 'dark_store'::location_type, 'Gurgaon', 'Delhi NCR'),
  ('CC-GGN-Udyog Vihar', 'CC-GGN-Udyog Vihar', 'dark_store'::location_type, 'Gurgaon', 'Delhi NCR'),
  ('CC-GZB-Raj Nagar', 'CC-GZB-Raj Nagar', 'dark_store'::location_type, 'Ghaziabad', 'Delhi NCR'),
  ('CC-GZB-Vasundhara', 'CC-GZB-Vasundhara', 'dark_store'::location_type, 'Ghaziabad', 'Delhi NCR'),
  ('CC-JP-Bais Godam', 'CC-JP-Bais Godam', 'dark_store'::location_type, 'Jaipur', 'Jaipur'),
  ('CC-JP-Malviya Nagar', 'CC-JP-Malviya Nagar', 'dark_store'::location_type, 'Jaipur', 'Jaipur'),
  ('CC-JP-Pratap Nagar', 'CC-JP-Pratap Nagar', 'dark_store'::location_type, 'Jaipur', 'Jaipur'),
  ('CC-JP-Vaishali Nagar', 'CC-JP-Vaishali Nagar', 'dark_store'::location_type, 'Jaipur', 'Jaipur'),
  ('CC-LKO-Ashiyana', 'CC-LKO-Ashiyana', 'dark_store'::location_type, 'Lucknow', 'Lucknow'),
  ('CC-LKO-Gomti Nagar', 'CC-LKO-Gomti Nagar', 'dark_store'::location_type, 'Lucknow', 'Lucknow'),
  ('CC-LKO-Hazratganj', 'CC-LKO-Hazratganj', 'dark_store'::location_type, 'Lucknow', 'Lucknow'),
  ('CC-LKO-Jankipuram', 'CC-LKO-Jankipuram', 'dark_store'::location_type, 'Lucknow', 'Lucknow'),
  ('CC-ND-Alpha 2', 'CC-ND-Alpha 2', 'd2c_fulfillment'::location_type, 'Noida', 'Delhi NCR'),
  ('CC-ND-Diamond Plaza', 'CC-ND-Diamond Plaza', 'dark_store'::location_type, 'Noida', 'Delhi NCR'),
  ('CC-ND-Gaur City', 'CC-ND-Gaur City', 'dark_store'::location_type, 'Noida', 'Delhi NCR'),
  ('CC-ND-Sector 116', 'CC-ND-Sector 116', 'dark_store'::location_type, 'Noida', 'Delhi NCR'),
  ('CC-ND-Sector 45', 'CC-ND-Sector 45', 'dark_store'::location_type, 'Noida', 'Delhi NCR'),
  ('CC-ND-Sector 68', 'CC-ND-Sector 68', 'dark_store'::location_type, 'Noida', 'Delhi NCR'),
  ('CC-ND-Sector141', 'CC-ND-Sector141', 'dark_store'::location_type, 'Noida', 'Delhi NCR'),
  ('CC-UP-Meerut', 'CC-UP-Meerut', 'd2c_fulfillment'::location_type, 'Meerut', 'Meerut')
on conflict (code) do nothing;

-- department + freezer sit under the Central Kitchen umbrella
update locations set parent_id = (select id from locations where code = 'CK') where code = 'CK-SPONGE';
update locations set parent_id = (select id from locations where code = 'CK') where code = 'CK-DESSERT';
update locations set parent_id = (select id from locations where code = 'CK') where code = 'CK-CAKE';
update locations set parent_id = (select id from locations where code = 'CK') where code = 'FREEZER-CK';

-- aliases: SupplyNote/Petpooja legacy names -> canonical location
insert into location_aliases (location_id, system, external_code, external_name, note)
  select id, 'supplynote'::source_system, 'ND-CK', 'ND-CK-Bread Dept', 'sponge and ganache dept (legacy name)' from locations where code = 'CK-SPONGE'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_code, external_name, note)
  select id, 'supplynote'::source_system, 'ND-CK', 'ND-CK-Desserts Dept', 'dessert dept (legacy name)' from locations where code = 'CK-DESSERT'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_code, external_name, note)
  select id, 'supplynote'::source_system, null, 'Central Kitchen Noida', 'cake dept; rename to ND-CK-Cake Dept later is just another alias, no migration' from locations where code = 'CK-CAKE'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_code, external_name, note)
  select id, 'supplynote'::source_system, 'CDN', 'Central Dispatach-Noida', 'SupplyNote misspelling' from locations where code = 'CDIS'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_code, external_name, note)
  select id, 'petpooja'::source_system, null, 'Central Dispatch Noida', 'Petpooja spelling' from locations where code = 'CDIS'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_code, external_name, note)
  select id, 'supplynote'::source_system, '01', 'Store Noida', 'all vendor purchases land here' from locations where code = 'CWH'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_code, external_name, note)
  select id, 'supplynote'::source_system, 'DCCK', 'SK-ND-Sector 67', null from locations where code = 'SK-ND-Sector 67'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_code, external_name, note)
  select id, 'supplynote'::source_system, 'JK', 'SK-DL-Janakpuri', null from locations where code = 'SK-DL-Janakpuri'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_code, external_name, note)
  select id, 'supplynote'::source_system, null, 'SK-GGN-Sikanderpur', null from locations where code = 'SK-GGN-Sikanderpur'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;

-- dark stores: console + Petpooja both name the store by the canonical CC-... string
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-CHD-Industrial Area' from locations where code = 'CC-CHD-Industrial Area'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-CHD-Industrial Area' from locations where code = 'CC-CHD-Industrial Area'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-CHD-Mohali' from locations where code = 'CC-CHD-Mohali'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-CHD-Mohali' from locations where code = 'CC-CHD-Mohali'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-CHD-Sector 16' from locations where code = 'CC-CHD-Sector 16'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-CHD-Sector 16' from locations where code = 'CC-CHD-Sector 16'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-CHD-Zirakpur' from locations where code = 'CC-CHD-Zirakpur'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-CHD-Zirakpur' from locations where code = 'CC-CHD-Zirakpur'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-DL-Dwarka' from locations where code = 'CC-DL-Dwarka'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-DL-Dwarka' from locations where code = 'CC-DL-Dwarka'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-DL-Dwarka Mor' from locations where code = 'CC-DL-Dwarka Mor'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-DL-Dwarka Mor' from locations where code = 'CC-DL-Dwarka Mor'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-DL-Janakpuri' from locations where code = 'CC-DL-Janakpuri'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-DL-Janakpuri' from locations where code = 'CC-DL-Janakpuri'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-DL-Karol Bagh' from locations where code = 'CC-DL-Karol Bagh'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-DL-Karol Bagh' from locations where code = 'CC-DL-Karol Bagh'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-DL-Krishna Nagar' from locations where code = 'CC-DL-Krishna Nagar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-DL-Krishna Nagar' from locations where code = 'CC-DL-Krishna Nagar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-DL-Mayur Vihar Ph 3' from locations where code = 'CC-DL-Mayur Vihar Ph 3'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-DL-Mayur Vihar Ph 3' from locations where code = 'CC-DL-Mayur Vihar Ph 3'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-DL-NFC' from locations where code = 'CC-DL-NFC'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-DL-NFC' from locations where code = 'CC-DL-NFC'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-DL-Paschim Vihar' from locations where code = 'CC-DL-Paschim Vihar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-DL-Paschim Vihar' from locations where code = 'CC-DL-Paschim Vihar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-DL-Rohini' from locations where code = 'CC-DL-Rohini'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-DL-Rohini' from locations where code = 'CC-DL-Rohini'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-DL-Sarita Vihar' from locations where code = 'CC-DL-Sarita Vihar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-DL-Sarita Vihar' from locations where code = 'CC-DL-Sarita Vihar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-DL-Shahpurjat' from locations where code = 'CC-DL-Shahpurjat'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-DL-Shahpurjat' from locations where code = 'CC-DL-Shahpurjat'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-DL-Shalimar Bagh' from locations where code = 'CC-DL-Shalimar Bagh'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-DL-Shalimar Bagh' from locations where code = 'CC-DL-Shalimar Bagh'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-DL-Vasant Kunj' from locations where code = 'CC-DL-Vasant Kunj'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-DL-Vasant Kunj' from locations where code = 'CC-DL-Vasant Kunj'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-FBD-Sector 15' from locations where code = 'CC-FBD-Sector 15'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-FBD-Sector 15' from locations where code = 'CC-FBD-Sector 15'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-FBD-Sector 37' from locations where code = 'CC-FBD-Sector 37'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-FBD-Sector 37' from locations where code = 'CC-FBD-Sector 37'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-GGN-DLF Ph 4' from locations where code = 'CC-GGN-DLF Ph 4'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-GGN-DLF Ph 4' from locations where code = 'CC-GGN-DLF Ph 4'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-GGN-Sector 4' from locations where code = 'CC-GGN-Sector 4'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-GGN-Sector 4' from locations where code = 'CC-GGN-Sector 4'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-GGN-Sector 49' from locations where code = 'CC-GGN-Sector 49'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-GGN-Sector 49' from locations where code = 'CC-GGN-Sector 49'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-GGN-Sector 52' from locations where code = 'CC-GGN-Sector 52'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-GGN-Sector 52' from locations where code = 'CC-GGN-Sector 52'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-GGN-Sector 60' from locations where code = 'CC-GGN-Sector 60'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-GGN-Sector 60' from locations where code = 'CC-GGN-Sector 60'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-GGN-Sector 86' from locations where code = 'CC-GGN-Sector 86'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-GGN-Sector 86' from locations where code = 'CC-GGN-Sector 86'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-GGN-Udyog Vihar' from locations where code = 'CC-GGN-Udyog Vihar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-GGN-Udyog Vihar' from locations where code = 'CC-GGN-Udyog Vihar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-GZB-Raj Nagar' from locations where code = 'CC-GZB-Raj Nagar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-GZB-Raj Nagar' from locations where code = 'CC-GZB-Raj Nagar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-GZB-Vasundhara' from locations where code = 'CC-GZB-Vasundhara'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-GZB-Vasundhara' from locations where code = 'CC-GZB-Vasundhara'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-JP-Bais Godam' from locations where code = 'CC-JP-Bais Godam'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-JP-Bais Godam' from locations where code = 'CC-JP-Bais Godam'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-JP-Malviya Nagar' from locations where code = 'CC-JP-Malviya Nagar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-JP-Malviya Nagar' from locations where code = 'CC-JP-Malviya Nagar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-JP-Pratap Nagar' from locations where code = 'CC-JP-Pratap Nagar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-JP-Pratap Nagar' from locations where code = 'CC-JP-Pratap Nagar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-JP-Vaishali Nagar' from locations where code = 'CC-JP-Vaishali Nagar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-JP-Vaishali Nagar' from locations where code = 'CC-JP-Vaishali Nagar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-LKO-Ashiyana' from locations where code = 'CC-LKO-Ashiyana'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-LKO-Ashiyana' from locations where code = 'CC-LKO-Ashiyana'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-LKO-Gomti Nagar' from locations where code = 'CC-LKO-Gomti Nagar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-LKO-Gomti Nagar' from locations where code = 'CC-LKO-Gomti Nagar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-LKO-Hazratganj' from locations where code = 'CC-LKO-Hazratganj'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-LKO-Hazratganj' from locations where code = 'CC-LKO-Hazratganj'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-LKO-Jankipuram' from locations where code = 'CC-LKO-Jankipuram'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-LKO-Jankipuram' from locations where code = 'CC-LKO-Jankipuram'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-ND-Alpha 2' from locations where code = 'CC-ND-Alpha 2'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-ND-Alpha 2' from locations where code = 'CC-ND-Alpha 2'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-ND-Diamond Plaza' from locations where code = 'CC-ND-Diamond Plaza'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-ND-Diamond Plaza' from locations where code = 'CC-ND-Diamond Plaza'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-ND-Gaur City' from locations where code = 'CC-ND-Gaur City'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-ND-Gaur City' from locations where code = 'CC-ND-Gaur City'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-ND-Sector 116' from locations where code = 'CC-ND-Sector 116'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-ND-Sector 116' from locations where code = 'CC-ND-Sector 116'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-ND-Sector 45' from locations where code = 'CC-ND-Sector 45'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-ND-Sector 45' from locations where code = 'CC-ND-Sector 45'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-ND-Sector 68' from locations where code = 'CC-ND-Sector 68'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-ND-Sector 68' from locations where code = 'CC-ND-Sector 68'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-ND-Sector141' from locations where code = 'CC-ND-Sector141'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-ND-Sector141' from locations where code = 'CC-ND-Sector141'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-UP-Meerut' from locations where code = 'CC-UP-Meerut'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-UP-Meerut' from locations where code = 'CC-UP-Meerut'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;

-- OMS outlet-code aliases for the four D2C fulfillment stores
insert into location_aliases (location_id, system, external_code, external_name, note)
  select id, 'oms'::source_system, 'FBD', 'CC-FBD-Sector 15', 'D2C fulfillment store' from locations where code = 'CC-FBD-Sector 15'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_code, external_name, note)
  select id, 'oms'::source_system, 'GN', 'CC-ND-Alpha 2', 'D2C fulfillment store' from locations where code = 'CC-ND-Alpha 2'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_code, external_name, note)
  select id, 'oms'::source_system, 'Meerut', 'CC-UP-Meerut', 'D2C fulfillment store' from locations where code = 'CC-UP-Meerut'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_code, external_name, note)
  select id, 'oms'::source_system, 'SPJ', 'CC-DL-Shahpurjat', 'D2C fulfillment store' from locations where code = 'CC-DL-Shahpurjat'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;

