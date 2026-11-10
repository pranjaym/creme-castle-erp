-- ============================================================
-- Migration 254: INVENTORY MODULE, packaging (build step 2: the screens)
-- 10 November 2026, Pranjay's go ("Yes, apply it"). Staged first in
-- erp-plan/migrations-staging/ (F41). Proven in a rolled-back transaction,
-- then applied and recorded in schema_migrations the same moment.
--
-- Target: the spine Supabase project. Additive only: one new schema
-- (inventory), three small tables with their first rows, one read function.
-- Nothing existing is altered. No begin/commit: the caller owns the transaction.
-- Design record: erp-plan/inventory-module-plan.md.
--
-- What the screens need beyond SupplyNote's own data (252):
--   inventory.settings           the numbers Pranjay may change: past-due
--                                cut-off (10 days, his decision of 10 Nov 2026),
--                                usage window, buffer, default lead time,
--                                order cover, projection horizon.
--   inventory.item_terms         per item: its TYPE (box, sticker and so on;
--                                the ten types Pranjay approved on 10 Nov
--                                2026), and later its own lead time and
--                                minimum order.
--   inventory.vendor_lead_times  the vendor's usual lead time, from Pranjay's
--                                August 2026 lead time sheet, keyed on
--                                SupplyNote's seller_id (never the name).
-- All three keep history the same way as the landing tables: a change inserts
-- a new row and stamps superseded_at on the old one. Nothing is updated in
-- place or deleted (CLAUDE.md rule 6).
--
-- public.inv_packaging_data() hands the portal everything for the packaging
-- screens in one call: stock, usage, 28 days of closing stock, receipt days,
-- vendor, lead time on record, and every purchase order line still open. It
-- does NO judging: status, projection and order quantity are worked out by
-- the portal's engine (portal/lib/inventory-engine.ts), which is plain
-- arithmetic and has its own checks. Scope: Noida Central Warehouse, active
-- items in SupplyNote categories "packaging" and "boxes and bags".
-- Days are IST calendar days.
-- ============================================================

create schema if not exists inventory;

create table if not exists inventory.settings (
  id            bigserial primary key,
  key           text not null,
  value         numeric not null,
  note          text,
  set_by        text not null default 'migration 254',
  set_at        timestamptz not null default now(),
  superseded_at timestamptz
);
create unique index if not exists inventory_settings_key on inventory.settings (key) where superseded_at is null;
comment on table inventory.settings is
  'Inventory module settings. One current row per key; a change inserts a new row and stamps the old one, so every past value is kept with who set it and when.';

create table if not exists inventory.item_terms (
  id              bigserial primary key,
  product_id      text not null,
  item_type       text,
  type_doubt      boolean not null default false,
  lead_days       integer,
  min_order_qty   numeric,
  sku_code_at_set text,
  note            text,
  set_by          text not null default 'migration 254',
  set_at          timestamptz not null default now(),
  superseded_at   timestamptz
);
create unique index if not exists inventory_item_terms_key on inventory.item_terms (product_id) where superseded_at is null;
comment on table inventory.item_terms is
  'Per item facts the module owns: item_type (the ten packaging types), type_doubt (type still to be confirmed by Pranjay), and optionally the item''s own lead time and minimum order. Keyed on SupplyNote product_id. sku_code_at_set is a label for the reader, never a join key.';

create table if not exists inventory.vendor_lead_times (
  id                 bigserial primary key,
  seller_id          text not null,
  seller_name_at_set text,
  lead_days          integer not null,
  source             text,
  set_by             text not null default 'migration 254',
  set_at             timestamptz not null default now(),
  superseded_at      timestamptz
);
create unique index if not exists inventory_vendor_lead_times_key on inventory.vendor_lead_times (seller_id) where superseded_at is null;
comment on table inventory.vendor_lead_times is
  'The vendor''s usual lead time in days, an ESTIMATE from Pranjay''s August 2026 lead time sheet (the most common figure the sheet gives for that vendor). Keyed on SupplyNote seller_id; the name is a label only.';

alter table inventory.settings          enable row level security;
alter table inventory.item_terms        enable row level security;
alter table inventory.vendor_lead_times enable row level security;

-- ------------------------------------------------------------
-- First rows. Each insert skips a key that already has a current row, so the
-- file is safe to run twice.
-- ------------------------------------------------------------
insert into inventory.settings (key, value, note)
select v.key, v.value, v.note from (values
  ('usage_days',            28, 'Days of warehouse issues averaged into "used a day".'),
  ('past_due_cutoff_days',  10, 'A PO line more than this many days past due stops counting as stock on the way. Pranjay, 10 Nov 2026.'),
  ('buffer_max_days',        7, 'Buffer on top of the lead time equals the lead time, up to this many days. Proposal.'),
  ('default_lead_days',     15, 'Lead time used when neither the item, the vendor nor the delivery history gives one. Estimate.'),
  ('order_cover_days',      30, 'An order is sized to last this many days beyond lead time plus buffer. Proposal.'),
  ('horizon_days',          60, 'How far forward the projection is drawn.')
) as v(key, value, note)
where not exists (select 1 from inventory.settings s where s.key = v.key and s.superseded_at is null);

insert into inventory.item_terms (product_id, item_type, type_doubt, sku_code_at_set)
select v.product_id, v.item_type, v.type_doubt, v.sku from (values
  ('63259272f806bcf6cf6416ec', 'Cake and pastry box', false, 'BB001'),
  ('63259272f806bcf6cf6416b0', 'Cake and pastry box', false, 'BB002'),
  ('63259272f806bcf6cf6416dc', 'Cake and pastry box', false, 'BB003'),
  ('63259272f806bcf6cf6416f4', 'Jar, tub and cup', true, 'BB004'),
  ('63259272f806bcf6cf6416e8', 'Cake and pastry box', false, 'BB005'),
  ('63259272f806bcf6cf6416d8', 'Cake and pastry box', false, 'BB006'),
  ('63259272f806bcf6cf641718', 'Cake and pastry box', false, 'BB007'),
  ('63259272f806bcf6cf641758', 'Cake and pastry box', false, 'BB008'),
  ('63259272f806bcf6cf641700', 'Cake and pastry box', false, 'BB009'),
  ('633588d7868ecd4fea502560', 'Cake and pastry box', false, 'BB010'),
  ('63259272f806bcf6cf641774', 'Carry bag', false, 'BB011'),
  ('63259272f806bcf6cf6416d4', 'Carry bag', false, 'BB012'),
  ('63259272f806bcf6cf641714', 'Carry bag', false, 'BB013'),
  ('63259272f806bcf6cf641798', 'Sticker', false, 'BB014'),
  ('63259272f806bcf6cf641800', 'Hamper box and filler', false, 'BB015'),
  ('63259272f806bcf6cf64171c', 'Jar, tub and cup', false, 'CB015'),
  ('635b919b91e072d4c9ae2fcd', 'Sticker', false, 'CC00027'),
  ('635b923391e072d4c9ae30f2', 'Jar, tub and cup', false, 'CC00028'),
  ('63720cff0790ab8e9efa0c0b', 'Jar, tub and cup', false, 'CC00038'),
  ('637c8f0bbdc94c25ff9ff6b8', 'Sticker', false, 'CC00044'),
  ('637e0e1573f3d3dd629df27c', 'Sticker', false, 'CC00049'),
  ('63a2c61ba1a795337d2dd9ee', 'Sticker', false, 'CC00077'),
  ('63a5a315d778130bcb34fe52', 'Sticker', false, 'CC00090'),
  ('63d0c4f18a397a79b3ed096a', 'Sticker', false, 'CC00117'),
  ('63d50705bde158d7698c3112', 'Liner, mould and base', false, 'CC00127'),
  ('63e4b300e5eec6193dbb3aa4', 'Cake and pastry box', false, 'CC00140'),
  ('6411da2bafade0c3b7225a29', 'Jar, tub and cup', true, 'CC00233'),
  ('6414469192e1c173e7beec11', 'Sleeve, card and tag', false, 'CC00243'),
  ('64313feaff17223068f9a146', 'Tape, wrap and pouch', false, 'CC00294'),
  ('64314042f1bae23074cb804e', 'Other', true, 'CC00295'),
  ('6433c065e5fad3e56cfe2911', 'Jar, tub and cup', false, 'CC00296'),
  ('64a5194ede349399057470cd', 'Sticker', false, 'CC00352'),
  ('64a519939b408104f58899f5', 'Sticker', false, 'CC00353'),
  ('64edb0eebfac486d27ee8d92', 'Sticker', false, 'CC00377'),
  ('64edb519e6c62c7f9452a491', 'Sticker', false, 'CC00378'),
  ('6515296f4c73929e8aefef10', 'Liner, mould and base', true, 'CC00386'),
  ('6540e081d5b91c3181ff617a', 'Hamper box and filler', false, 'CC00392'),
  ('6566c86e1f85829d35121e40', 'Other', true, 'CC00395'),
  ('656aaffb26d3e249f68a054e', 'Cake and pastry box', false, 'CC00397'),
  ('656ea14ce86f7873a0dae5c3', 'Liner, mould and base', false, 'CC00399'),
  ('656ea257e4ab5473a1718d94', 'Liner, mould and base', false, 'CC00400'),
  ('6578583b896103bbf3d9761c', 'Cake and pastry box', false, 'CC00431'),
  ('6578583b896103bbf3d97620', 'Hamper box and filler', false, 'CC00432'),
  ('6578583b896103bbf3d97628', 'Hamper box and filler', false, 'CC00434'),
  ('6631c8ba7e97a6fed4305d7a', 'Tea cake, cookie and biscuit box', true, 'CC00452'),
  ('6631c8ed86a82074725cf8a5', 'Tea cake, cookie and biscuit box', false, 'CC00453'),
  ('6631c93386a82074725cf8c9', 'Tea cake, cookie and biscuit box', false, 'CC00454'),
  ('6631c959f281aa587cc6e51b', 'Tea cake, cookie and biscuit box', true, 'CC00455'),
  ('6631c9ccf281aa587cc6e555', 'Tea cake, cookie and biscuit box', true, 'CC00456'),
  ('663d9ec24e687e1b3b119e79', 'Tea cake, cookie and biscuit box', false, 'CC00462'),
  ('663d9f030646db1b43c644c0', 'Tea cake, cookie and biscuit box', false, 'CC00463'),
  ('663d9f3fd33686e637281c05', 'Tea cake, cookie and biscuit box', false, 'CC00464'),
  ('663dca629197a046ba3e0cb6', 'Sticker', true, 'CC00465'),
  ('66e01601863368db75ae9e9c', 'Tape, wrap and pouch', false, 'CC00936'),
  ('66fb7b63237a7bc9d1f08b23', 'Liner, mould and base', true, 'CC00950'),
  ('66fd1bfeb23807ea5a5ec7fb', 'Hamper box and filler', false, 'CC00951'),
  ('6707b08dc15fb166cb3eae55', 'Other', true, 'CC00961'),
  ('6722067ae768870451b86ddd', 'Hamper box and filler', false, 'CC00994'),
  ('67220874efe5299e12e078f9', 'Hamper box and filler', false, 'CC00995'),
  ('67220aac26a8ec9e19d5a960', 'Hamper box and filler', false, 'CC00996'),
  ('67261f01d14f4f5a7cabc369', 'Liner, mould and base', false, 'CC00998'),
  ('672a2d2ebcc9efa38dc7bc37', 'Tape, wrap and pouch', false, 'CC00999'),
  ('673d9612e0dfad27776c405a', 'Tea cake, cookie and biscuit box', false, 'CC01017'),
  ('6756984bd8ce2e4e94ce8de2', 'Jar, tub and cup', false, 'CC01027'),
  ('675c387a8c509f6cedbe4c74', 'Jar, tub and cup', false, 'CC01039'),
  ('67627fe8b75f337b3ad78c06', 'Tea cake, cookie and biscuit box', false, 'CC01041'),
  ('6762810cf86d0eab7205dedf', 'Cake and pastry box', false, 'CC01043'),
  ('67690bf04b90ae0cc608b6e2', 'Other', true, 'CC01046'),
  ('67694cb522695152279dd071', 'Tea cake, cookie and biscuit box', false, 'CC01047'),
  ('67738e535c954294979c916f', 'Sleeve, card and tag', false, 'CC01048'),
  ('68b1a4fb88836b72f62846cf', 'Sticker', false, 'CC01115'),
  ('68d11d2eaf664afed99f25ea', 'Sticker', false, 'CC01142'),
  ('68d54df80004e546ce02b95c', 'Tea cake, cookie and biscuit box', false, 'CC01158'),
  ('68d54ecdca61c746be816cde', 'Jar, tub and cup', false, 'CC01159'),
  ('68d54f0dd809f3c0d155a7dd', 'Jar, tub and cup', false, 'CC01160'),
  ('68d54f458da9b9da7ff671c0', 'Jar, tub and cup', false, 'CC01161'),
  ('68dcd3efcdedbb53abcd0170', 'Hamper box and filler', true, 'CC01163'),
  ('68dcd60279119648a7ddf07a', 'Hamper box and filler', true, 'CC01164'),
  ('68dcd8dc5f2fad53aa3e778b', 'Tea cake, cookie and biscuit box', false, 'CC01165'),
  ('68e0dc7c3e9b62ab68de9d3b', 'Sticker', false, 'CC01167'),
  ('68e0dd13a6ce98d7d1722751', 'Sticker', false, 'CC01168'),
  ('68e0de63ab802a0374ce575a', 'Sticker', false, 'CC01169'),
  ('68e0df2fedca615d51be97d5', 'Sticker', false, 'CC01170'),
  ('68e0dfd9e0e74fd7d361bda1', 'Sticker', false, 'CC01171'),
  ('68e0e081ad4b035dad20afbe', 'Sticker', false, 'CC01172'),
  ('68e0e49e7da1b65d4f531ca2', 'Sticker', false, 'CC01174'),
  ('68e0e8fcab802a0374ce72b3', 'Sticker', false, 'CC01175'),
  ('68e0e9de3e9b62ab68debd39', 'Sticker', false, 'CC01176'),
  ('68e0ef705a85e0c5d44463b9', 'Sticker', false, 'CC01179'),
  ('68e0efe21952c45d50109197', 'Sticker', false, 'CC01180'),
  ('68e66c8adf8a8c0b497b3d8a', 'Jar, tub and cup', false, 'CC01184'),
  ('68e66d0fe5d83103358fa793', 'Jar, tub and cup', false, 'CC01185'),
  ('68e66dd79ae7e78ec7bb4d4e', 'Jar, tub and cup', false, 'CC01186'),
  ('68ecfea69626b61c6dfb20d6', 'Carry bag', false, 'CC01188'),
  ('68ed05d1fd43f12e585d131e', 'Hamper box and filler', false, 'CC01192'),
  ('68ed0683fd43f12e585d158b', 'Hamper box and filler', false, 'CC01193'),
  ('68f0adbd2c0c07c6018c0eef', 'Carry bag', false, 'CC01194'),
  ('68f2514ca985a2d423e31a6d', 'Tape, wrap and pouch', false, 'CC01196'),
  ('68f2536caae04ce1dca45f76', 'Tape, wrap and pouch', false, 'CC01197'),
  ('690b615cb5d3ae8e13c5deff', 'Sticker', false, 'CC01201'),
  ('690b6209470b49c18bce909b', 'Sticker', false, 'CC01202'),
  ('69130a638693a053d9f2cf88', 'Sleeve, card and tag', false, 'CC01205'),
  ('69130b328a3ed847ff84e2c1', 'Sleeve, card and tag', false, 'CC01206'),
  ('692be0c64c7bd6124d4e464c', 'Sleeve, card and tag', false, 'CC01219'),
  ('692c263571f2884147753574', 'Sleeve, card and tag', false, 'CC01234'),
  ('6934230259d69f2f49deda70', 'Tape, wrap and pouch', false, 'CC01237'),
  ('6935347589c74465ade0bea4', 'Sticker', false, 'CC01238'),
  ('69353571a83fdb44495a21cc', 'Sticker', false, 'CC01239'),
  ('6937ffea0e6d23dde82156f4', 'Tape, wrap and pouch', false, 'CC01240'),
  ('69413f58b1c7633b82f3c3a1', 'Carry bag', false, 'CC01242'),
  ('6943b001019467737f2157f4', 'Sleeve, card and tag', false, 'CC01250'),
  ('694d3b44c701c163b03a664e', 'Carry bag', true, 'CC01255'),
  ('697df7346c59ecb72847b8fc', 'Cake and pastry box', true, 'CC01260'),
  ('6986eea0d98e95d1ada67f20', 'Cake and pastry box', false, 'CC01263'),
  ('698c7eda408d3e20b2e1ec76', 'Jar, tub and cup', false, 'CC01264'),
  ('69a04b1b65620a933a60033e', 'Cake and pastry box', false, 'CC01286'),
  ('69abcb24ebf98528fb5b7b81', 'Sleeve, card and tag', false, 'CC01291'),
  ('69b010232870271a5f9576b8', 'Sticker', false, 'CC01295'),
  ('69b01094d51933c20b357e9a', 'Sticker', false, 'CC01296'),
  ('69b14888ac098bf52ee01fe1', 'Jar, tub and cup', false, 'CC01297'),
  ('69c7e0d7bf27c23fb00b5325', 'Carry bag', false, 'CC01303'),
  ('69c7e13b62e9ec40c5c40afb', 'Sleeve, card and tag', false, 'CC01304'),
  ('69c7e1ad62e9ec40c5c40cd3', 'Sleeve, card and tag', false, 'CC01305'),
  ('69c7e27efdd3bdb4de99bca4', 'Tea cake, cookie and biscuit box', false, 'CC01306'),
  ('69df334169d96c84dbc1e024', 'Liner, mould and base', false, 'CC01317'),
  ('69f70f19b2b5f09f714040c7', 'Sticker', false, 'CC01334'),
  ('69f70f9bfafdf9ea267b1236', 'Sticker', false, 'CC01335'),
  ('6a0c68d8982f6660a8f7365d', 'Sticker', false, 'CC01337'),
  ('6a0eeb8c706d4e0ea5fc0046', 'Jar, tub and cup', false, 'CC01338'),
  ('6a159deb6244954ed23111a1', 'Sticker', false, 'CC01341'),
  ('6a197f362bc53c05cb703122', 'Jar, tub and cup', false, 'CC01342'),
  ('6a27db7d716a57f5c852f498', 'Sticker', false, 'CC01347'),
  ('6a2ac16e158975e0fa5fa114', 'Jar, tub and cup', false, 'CC01349'),
  ('6a2fcd1c67dd99b6f84f59d6', 'Sticker', false, 'CC01350'),
  ('6a4e38efe551c3ddb5583eaa', 'Cake and pastry box', false, 'CC01361'),
  ('6a53581d09e14ae1fc1a6bd3', 'Sticker', false, 'CC01367'),
  ('6a5dd37cf69c546f5429151b', 'Sticker', false, 'CC01369'),
  ('6a675fe032c8b230ed909c97', 'Jar, tub and cup', false, 'CC01372'),
  ('6a68756239b0a887ae087eeb', 'Sticker', false, 'CC01373'),
  ('6a7c760c5b75083d83895010', 'Liner, mould and base', false, 'CC01376'),
  ('6a7c77b348be6216ffdfd022', 'Liner, mould and base', false, 'CC01377'),
  ('6a7c78700a64ab06db7c5e8f', 'Liner, mould and base', false, 'CC01378'),
  ('6a82f3570409cf60c6313ac5', 'Sticker', false, 'CC01384'),
  ('6a8c27aa68187c15c0eefa90', 'Tea cake, cookie and biscuit box', false, 'CC01389'),
  ('6a8c2ba1894570f537d05632', 'Hamper box and filler', true, 'CC01390'),
  ('6a8c2c52495f52f529bb6fdd', 'Hamper box and filler', true, 'CC01391'),
  ('6a8d64afdde49e3f3116bf2c', 'Sleeve, card and tag', false, 'CC01396'),
  ('6aad483cd6fe2ccec20299d2', 'Tea cake, cookie and biscuit box', false, 'CC01401'),
  ('6abd18d374dc5ef15a2f94f7', 'Hamper box and filler', false, 'CC01407'),
  ('6abd196334dfee54fd7a5562', 'Hamper box and filler', false, 'CC01408'),
  ('6abe30cc8efa51ca8f7a92a8', 'Jar, tub and cup', false, 'CC01409'),
  ('6abe32b5e5c2a4be2ffde9a6', 'Jar, tub and cup', false, 'CC01410'),
  ('6abe33a796dbe8cb0b4be690', 'Jar, tub and cup', false, 'CC01411'),
  ('6ac62d329d277ed8379b8716', 'Tape, wrap and pouch', false, 'CC01412'),
  ('6ac8cc341e71b2db65b56746', 'Jar, tub and cup', true, 'CC01413'),
  ('6ad09a99fef8958269cc4cb6', 'Sticker', false, 'CC01415'),
  ('6ad09b6d5ca6947e89db24e7', 'Sticker', false, 'CC01416'),
  ('6ad09c10d269a482c7ba0376', 'Sticker', false, 'CC01417'),
  ('6ad8731d306028fe723ad211', 'Sticker', false, 'CC01428'),
  ('6ad87398c17feee6db4af07c', 'Sticker', false, 'CC01429'),
  ('6ad87444c549ee25d96a3723', 'Sticker', false, 'CC01430'),
  ('6ad874eaaaa42b25e5415877', 'Sticker', false, 'CC01431'),
  ('6ad875be017181e6d95e0506', 'Sticker', false, 'CC01432'),
  ('6ad87627f6c7c9e5edb1a814', 'Sticker', false, 'CC01433'),
  ('6ad876a6a3fb2726302d082f', 'Sticker', false, 'CC01434'),
  ('6ad87759f6c7c9e5edb1a9b5', 'Sticker', false, 'CC01435'),
  ('6ad8780152818502d5a05852', 'Sticker', false, 'CC01436'),
  ('6ad878f278eef323399ebd20', 'Tea cake, cookie and biscuit box', false, 'CC01437'),
  ('6ad879ff79707b2338edc0e9', 'Tea cake, cookie and biscuit box', false, 'CC01438'),
  ('6ad87b2579707b2338edc275', 'Cake and pastry box', false, 'CC01439'),
  ('6ada11b19eb305e74b18c4a7', 'Hamper box and filler', false, 'CC01440'),
  ('6ada12157c34d52b4657bfcc', 'Carry bag', false, 'CC01441'),
  ('6ae096706658153e2086aab8', 'Sticker', false, 'CC01464'),
  ('6ae1f948a6b9eff9b2616e76', 'Tape, wrap and pouch', false, 'CC01465'),
  ('6ae5d2ef0a0b5c33c133e15c', 'Hamper box and filler', false, 'CC01471'),
  ('6ae5d4b8758a555281242355', 'Tape, wrap and pouch', false, 'CC01472'),
  ('63259272f806bcf6cf6417ec', 'Sticker', false, 'GI002'),
  ('65bf09fb188f4f2ca8673d94', 'Jar, tub and cup', false, 'MOUSE CUP CRISTLE (PS-2 N7) WITH LID'),
  ('6582619729d8c10935d8d651', 'Tea cake, cookie and biscuit box', false, 'PRINTED DUPLEX BOX (CAVITY PLAIN)'),
  ('64ad2575efd77d09cb3b8bf8', 'Tape, wrap and pouch', false, 'ZYX0063'),
  ('64ad2575efd77d09cb3b8d24', 'Other', true, 'ZYX0123')
) as v(product_id, item_type, type_doubt, sku)
where not exists (select 1 from inventory.item_terms t where t.product_id = v.product_id and t.superseded_at is null);

insert into inventory.vendor_lead_times (seller_id, seller_name_at_set, lead_days, source)
select v.seller_id, v.name, v.lead_days, v.source from (values
  ('667a49697c0244fac66ab9e7', 'ABN ENTERPRISES', 10, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('69492da314f03c4d14bf0bb3', 'ADARSH TRADE VENTURES PRIVATE LIMITED', 7, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('68f2233e0b6b36a48f144034', 'ALLESPACK SYSTEMS PVT. LTD.', 10, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('63257439f4fb34f6e889a3ee', 'ARS FOODS INGREDIENTS PVT LTD', 2, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('6863dcecad4655ddc9195c27', 'ASHISH MARKETING', 3, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('63257547ff5021f6c35161f1', 'BANGLA FOODS', 3, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('68135d65534834b19e7a6eff', 'CHANDANMAL KANHAIYALAL', 7, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('68132de37454546abc3286df', 'COMPASSIONATE CHOICE PVT.LTD', 2, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('687107778d8c418ae9c71a4e', 'CRESCENT DOTS-N-LINES PRIVATE LIMITED', 15, 'Lead time sheet Aug 2026 (CRESCENT / CANPAC)'),
  ('65eeb9ad7d853749743890c4', 'DEEPANKU ENTERPRISES', 2, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('66e01787432c3ef4fc3a8913', 'DUPLETS ELECTRONICS PVT LTD', 7, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('66eb9e43183a25911aa12fd0', 'FRESHGEN INTERNATIONAL', 15, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('6325796e31248ef70c41595f', 'HEALTH HUNT', 3, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('684184deb994025cbf516e39', 'HILLTAKE ENTERPRISES', 15, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('632576a6ff5021f6c3516415', 'HINDUSTAN DRUG HOUSE', 3, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('6540df95ba3bb93037487983', 'Indi Colour Prints', 15, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('6368cd7212aa44a6ec9543e2', 'KARUN SALES CORPORATION', 2, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('66f38e18453dd617563faee9', 'KRISHNA TRADERS', 5, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('634ba90dfbb2bbd41b368aa9', 'Local vendor', 2, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('683fdae7f6a1dacfa2d49904', 'MAHALAXMI FLEXIBLE PACKAGING', 7, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('632577c4ff5021f6c35166bb', 'MAHALUXMI STORE', 1, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('675d60fea2e4832542f084dc', 'MAHAVIRA MARKETING', 2, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('666d07c4938053653a425e33', 'MJ GLOBAL PRIVATE LIMITED', 15, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('6a1a91c93d2d65d35b2202e4', 'MONDELEZ INDIA FOODS PRIVATE LIMITED', 5, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('65f7f4336a1ad44d80728b9a', 'OM ENTERPRISES', 2, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('67a61c617c12fb40dbbfaedd', 'OSWAL AGENCIES FOODS PVT. LTD.', 3, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('655ad007226d9417241bd78e', 'Om Procurements', 5, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('677d1ea16bbb355c9a17851c', 'PRATIBHA ENTERPRISES', 7, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('63257907ff5021f6c3516906', 'QUALITY FOOD PRODUCTS', 2, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('66b45efcd1ed1bec21b90565', 'RAJ TRADERS', 2, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('6325794df806bcf6cf63d9a9', 'RAMSON GRAPHICS PVT LTD', 10, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('64045119d701b7cc7ae0ab20', 'Roshan Enterprises', 15, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('6936b0ab0f9a6161703a5777', 'S S MARKETING', 2, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('696b8172c637c849fd47918a', 'SAI FOOD HOUSE', 7, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('63257a08f4fb34f6e889af51', 'SAMPOORN MARKETING', 2, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('67adde34c0856fb914a1bd30', 'SATYA SALES AGENCIES', 3, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('6645e12f94c6d9a6252f94d4', 'SB Design and Manufacturers', 3, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('686e5848c02f3a7c467ef248', 'SHIV ENTERPRISES', 10, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('63257a42ff5021f6c3516bec', 'SHREE SHYAM ENTERPRISES', 2, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('63257a6031248ef70c415bc9', 'SHREE SHYAM FOODS', 3, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('674d91b6e9428587f76a4e01', 'SHRIJI DAIRY AND SWEETS', 2, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('67866c3c9c9d36c87eeed25d', 'STEEPLE RESOURCES PVT LTD', 2, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('64144617f479568001782210', 'SUGAR SHINE INDIA', 7, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('67eba469c30afd693e22aa86', 'THAKUR &amp; COMPANY', 3, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('64313f60520082a489794aa3', 'THE FANCY FROSTING (Sandeep)', 1, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('681b6b58e726ad6d8c43442b', 'TWF TECHNOLOGIES PVT. LTD', 2, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('68135b2a223cf030590036c0', 'VASUDEV IMPEX', 3, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('63257af431248ef70c415d0a', 'VINOD EGG STORE', 2, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('63257b51f806bcf6cf63ddad', 'WOW DECORATIVES', 2, 'Lead time sheet Aug 2026, vendor''s usual figure'),
  ('63257bb4f806bcf6cf63de9c', 'ZOMATO HYPERPURE PVT. LTD. (NOIDA SPOKE)', 1, 'Lead time sheet Aug 2026, vendor''s usual figure')
) as v(seller_id, name, lead_days, source)
where not exists (select 1 from inventory.vendor_lead_times t where t.seller_id = v.seller_id and t.superseded_at is null);

-- ------------------------------------------------------------
-- The read function. One call, one JSON document.
-- ------------------------------------------------------------
create or replace function public.inv_packaging_data()
returns jsonb language sql stable security definer set search_path = inventory, landing, public as $fn$
with cfg as (
  select (now() at time zone 'Asia/Kolkata')::date as today,
         '5dd9015b742a4b9b20c45677'::text as wh,          -- Noida-Central Warehouse (outlet_id)
         (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from inventory.settings where superseded_at is null) as settings
), c2 as (
  select cfg.*, coalesce((cfg.settings->>'usage_days')::int, 28) as usage_days from cfg
), snap as (
  select max(s.snapshot_date) as d from landing.supplynote_stock_daily s, c2 where s.superseded_at is null and s.outlet_id = c2.wh
), items as (
  select p.product_id, p.sku_code, btrim(p.product_title) as title, p.base_unit,
         s.current_stock, coalesce(s.last_weighted_average_price, 0) as price, s.pulled_at
    from landing.supplynote_products p
    join c2 on true
    join snap on true
    join landing.supplynote_stock_daily s
      on s.product_id = p.product_id and s.outlet_id = c2.wh and s.snapshot_date = snap.d and s.superseded_at is null
   where p.superseded_at is null and p.is_active and lower(btrim(p.category)) in ('packaging', 'boxes and bags')
), led as (
  select l.product_id, (l.transaction_at at time zone 'Asia/Kolkata')::date as d, l.quantity_adjusted as q,
         (l.transaction_type = 'StockOut' and l.reference_no like 'GD-TRN-%') as is_out,
         (l.transaction_type = 'StockIn'  and l.reference_no like 'GR-INV%')  as is_receipt
    from landing.supplynote_inventory_log l
    join c2 on true
    join items i on i.product_id = l.product_id
   where l.superseded_at is null and l.outlet_id = c2.wh and l.transaction_at is not null
), agg as (
  select led.product_id,
         min(led.d) as first_seen,
         max(led.d) filter (where led.is_out) as last_out,
         coalesce(sum(-led.q) filter (where led.is_out and led.d >= c2.today - c2.usage_days and led.d < c2.today), 0) as out_window,
         count(distinct led.d) filter (where led.is_out and led.d >= c2.today - c2.usage_days and led.d < c2.today) as days_moved,
         coalesce(sum(-led.q) filter (where led.is_out and led.d >= c2.today - 7 and led.d < c2.today), 0) as out7,
         coalesce(array_agg(distinct led.d) filter (where led.is_receipt), '{}') as receipt_days
    from led join c2 on true
   group by led.product_id
), hist as (
  select i.product_id,
         jsonb_agg(coalesce(b.stock_after, a.stock_before, i.current_stock) order by g.d) as h
    from items i
    join c2 on true
    cross join lateral generate_series(c2.today - c2.usage_days, c2.today - 1, interval '1 day') as g(d)
    left join lateral (
      select l.stock_after from landing.supplynote_inventory_log l
       where l.product_id = i.product_id and l.outlet_id = c2.wh and l.superseded_at is null
         and l.transaction_at < ((g.d::date + 1)::timestamp at time zone 'Asia/Kolkata')
       order by l.transaction_at desc limit 1) b on true
    left join lateral (
      select l.stock_before from landing.supplynote_inventory_log l
       where l.product_id = i.product_id and l.outlet_id = c2.wh and l.superseded_at is null
         and l.transaction_at >= ((g.d::date + 1)::timestamp at time zone 'Asia/Kolkata')
       order by l.transaction_at asc limit 1) a on b.stock_after is null
   group by i.product_id
), pol as (
  select l.product_id, o.purchase_order_no, o.seller_id, o.seller_name,
         (coalesce(o.po_saved_at, o.po_dated_at, o.source_created_at) at time zone 'Asia/Kolkata')::date as saved,
         coalesce(o.po_saved_at, o.po_dated_at, o.source_created_at) as saved_at,
         (o.delivery_due_at at time zone 'Asia/Kolkata')::date as due,
         coalesce(l.unit_conversion, 1) as conv, l.quantity_ordered, l.quantity_received, l.quantity_cancelled,
         coalesce(l.unit_price, 0) as price, o.is_closed
    from landing.supplynote_purchase_order_lines l
    join landing.supplynote_purchase_orders o on o.purchase_order_id = l.purchase_order_id and o.superseded_at is null
    join items i on i.product_id = l.product_id
   where l.superseded_at is null and l.direction = 'purchase' and not coalesce(o.is_void, false)
), lastv as (
  select distinct on (product_id) product_id, seller_id, seller_name
    from pol order by product_id, saved desc, saved_at desc, purchase_order_no desc
), pos as (
  select product_id,
         jsonb_agg(jsonb_build_object(
           'po', purchase_order_no, 'vendor', seller_name, 'saved', saved, 'due', coalesce(due, saved),
           'ordered', quantity_ordered * conv, 'received', coalesce(quantity_received, 0) * conv,
           'open', (quantity_ordered - coalesce(quantity_cancelled, 0) - coalesce(quantity_received, 0)) * conv,
           'price', price) order by coalesce(due, saved), purchase_order_no) as pos
    from pol
   where not coalesce(is_closed, false) and quantity_ordered > 0
     and (quantity_ordered - coalesce(quantity_cancelled, 0) - coalesce(quantity_received, 0)) > 0
   group by product_id
)
select jsonb_build_object(
  'today', c2.today,
  'stock_day', (select d from snap),
  'stock_as_of', (select max(pulled_at) from items),
  'settings', c2.settings,
  'items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'product_id', i.product_id, 'sku', i.sku_code, 'title', i.title, 'unit', i.base_unit,
      'type', coalesce(t.item_type, 'Other'), 'doubt', coalesce(t.type_doubt, false),
      'stock', i.current_stock, 'price', i.price,
      'out_window', coalesce(a.out_window, 0), 'days_moved', coalesce(a.days_moved, 0), 'out7', coalesce(a.out7, 0),
      'first_seen', a.first_seen, 'last_out', a.last_out, 'receipt_days', to_jsonb(coalesce(a.receipt_days, '{}')),
      'vendor', lv.seller_name,
      'lead_days', coalesce(t.lead_days, vl.lead_days),
      'lead_src', case when t.lead_days is not null then 'item' when vl.lead_days is not null then 'vendor' end,
      'min_order_qty', t.min_order_qty,
      'hist', case when a.product_id is null then null else h.h end,
      'pos', coalesce(p.pos, '[]'::jsonb)) order by i.sku_code)
    from items i
    left join agg a on a.product_id = i.product_id
    left join hist h on h.product_id = i.product_id
    left join pos p on p.product_id = i.product_id
    left join lastv lv on lv.product_id = i.product_id
    left join inventory.item_terms t on t.product_id = i.product_id and t.superseded_at is null
    left join inventory.vendor_lead_times vl on vl.seller_id = lv.seller_id and vl.superseded_at is null
  ), '[]'::jsonb))
from c2
$fn$;

revoke all on function public.inv_packaging_data() from public, anon, authenticated;
grant execute on function public.inv_packaging_data() to service_role;
