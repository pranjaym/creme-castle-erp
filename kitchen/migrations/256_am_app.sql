-- ============================================================
-- 256: Area Manager app (plan, check-in, visit, audit, stock audit, to-dos)
-- 13 Nov 2026, on Pranjay's go to take it live for a test with Rishabh and Pawan.
-- Design record: erp-plan/store-scorecard-plan.md sections 25 to 31.
--
-- Rules this follows (erp-plan/CLAUDE.md):
--   * Nothing is ever deleted. Every row carries is_test; rows written during
--     the test stay true and every view used for KPIs excludes them. Going live
--     flips the default to false (one ALTER per table, migration 257+).
--   * Answers are appended, never overwritten: the latest row per visit and
--     item is the current answer, earlier rows are the trail.
--   * The checklist itself is data (am.audit_item, version 1 = 28 items with
--     X4 first), so a later change to the list keeps old scores reproducible.
-- The portal writes these tables directly through its server routes (service
-- connection); no table here is exposed to anon or authenticated.
-- ============================================================

create schema if not exists am;
revoke all on schema am from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('am-photos', 'am-photos', false, 5242880,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do nothing;

-- ---------- the checklist (version 1, 13 Nov 2026) ----------
create table if not exists am.audit_item (
  version    int  not null,
  code       text not null,
  sort       int  not null,
  grp        text not null,
  title      text not null,
  pass_line  text not null,
  critical   boolean not null default false,
  primary key (version, code)
);
insert into am.audit_item (version, code, sort, grp, title, pass_line, critical) values
 (1,'X4', 1,'On arrival, before going in','Door closed, handover through the window only','When you arrive, the door is closed, riders collect orders through the window, and no rider or outsider is inside. Check this before the door is opened for you.',false),
 (1,'P1', 2,'Personal hygiene','Hairnet, apron and gloves','Everyone handling food or packing wears all three. Hair fully inside the net.',false),
 (1,'P2', 3,'Personal hygiene','Clean uniform, no jewellery','Uniform without stains. No ring, watch, bangle or bracelet in the packing area.',false),
 (1,'P3', 4,'Personal hygiene','No unwell staff handling food','Nobody with an open cut, wound, cough or cold handles food.',false),
 (1,'P4', 5,'Personal hygiene','Handwash point stocked','Water running. Soap and sanitiser present and not empty. Tissue or dryer present.',false),
 (1,'P5', 6,'Personal hygiene','Handwashing done properly','One staff member shows the handwash routine correctly.',false),
 (1,'E1', 7,'Cleaning and equipment','Counters and work surfaces','No residue, crumbs or sticky patches. Sanitiser spray at hand.',false),
 (1,'E2', 8,'Cleaning and equipment','Floor, walls, ceiling, corners','No cobwebs, standing water, or dirt in corners or under racks.',false),
 (1,'E3', 9,'Cleaning and equipment','Bins','Every bin has a lid and a liner and is not overflowing.',false),
 (1,'E4',10,'Cleaning and equipment','Chillers and freezers clean','Inside and outside clean, door seals clean, no spills or heavy ice.',false),
 (1,'E5',11,'Cleaning and equipment','Microwave clean','Walls, turntable and door clean. No food residue or smell.',false),
 (1,'E6',12,'Cleaning and equipment','Air fryer and oven clean','Basket, tray and inside clean. No burnt residue or old oil.',false),
 (1,'E7',13,'Cleaning and equipment','Tools clean and rust-free','Knives, spatulas, scoops and cake lifters clean, dry, rust-free.',false),
 (1,'T1',14,'Temperature and pests','Chiller and freezer temperature','Chillers 1 to 5 °C, freezers -18 °C or colder right now.',true),
 (1,'T2',15,'Temperature and pests','Flycatcher working','Switched on, tube lit, tray not full.',false),
 (1,'T3',16,'Temperature and pests','No pest activity','No cockroach, rodent, droppings or fly cluster. Drains covered.',true),
 (1,'F1',17,'Food safety','No expired or spoiled product','Ten items from shelf and chiller, all within expiry.',true),
 (1,'F2',18,'Food safety','MRD sticker on every product','The same ten items each carry a readable make and expiry sticker.',false),
 (1,'F3',19,'Food safety','Covered and free of foreign matter','All food covered. No hair, pin, rubber band or plastic.',false),
 (1,'F4',20,'Food safety','Egg and eggless kept apart','Eggless items on their own marked shelf. Separate knife or scoop.',false),
 (1,'F5',21,'Food safety','FIFO and FEFO','Older stock in front. No newer batch in use before an older one.',false),
 (1,'F6',22,'Food safety','Rejects tagged DO NOT USE','Expired, damaged or returned items in a separate marked box.',false),
 (1,'S1',23,'Storage and packaging','Packaging off the floor','Boxes, containers and bags on clean racks. Nothing on the floor.',false),
 (1,'S2',24,'Storage and packaging','Opened packs sealed','No open packet on any rack. Opened items clipped or closed.',false),
 (1,'S3',25,'Storage and packaging','Chemicals kept apart','Chemicals and dusters on the bottom rack, never beside food.',false),
 (1,'X1',26,'Safety and security','No vehicle, fuel or gas cylinder inside','Nothing with fuel parked or kept inside the store or entrance.',true),
 (1,'X2',27,'Safety and security','No passwords on display','No login, password or staff number visible to customers or riders.',true),
 (1,'X3',28,'Safety and security','In-charge present','The store in-charge or named shift lead is on the floor.',true)
on conflict (version, code) do nothing;

-- ---------- store map pins (check-in only within radius_m) ----------
-- Seeded from SalaryBox's branch list (13 Nov 2026), matched to stores by
-- name. needs_check marks pins whose match is a guess (a neighbouring branch
-- name, a relocated store, or a 300 m attendance radius); the test will show
-- whether they are right. TEST-OFFICE is the corporate office, so testers
-- can check in without driving to a store; it never counts for anything.
create table if not exists am.store_pin (
  store        text primary key,
  lat          double precision not null,
  lng          double precision not null,
  radius_m     integer not null default 100,
  source       text not null,
  source_name  text,
  needs_check  boolean not null default false,
  note         text,
  is_test_site boolean not null default false,
  updated_at   timestamptz not null default now()
);
create table if not exists am.store_pin_report (       -- "the pin looks wrong", from the phone
  id           bigserial primary key,
  store        text not null,
  lat          double precision,
  lng          double precision,
  accuracy_m   double precision,
  dist_m       double precision,
  note         text,
  reported_by  uuid not null,
  reported_by_name text,
  reported_at  timestamptz not null default now(),
  is_test      boolean not null default true
);
insert into am.store_pin (store, lat, lng, source, source_name, needs_check, note, is_test_site) values
 ('CC-ND-Sector 68',28.599787823235307,77.39182256761435,'salarybox','Sector 68, Noida',false,null,false),
 ('CC-ND-Sector 116',28.56852008603162,77.39699786821865,'salarybox','Sector 116, Noida',false,null,false),
 ('CC-ND-Sector 45',28.5529967,77.35254189999999,'salarybox','Sect 45, Noida',true,'SalaryBox radius 300 m: pin may be loose',false),
 ('CC-ND-Sector141',28.505848181265744,77.41497930103294,'salarybox','Sec 141, Noida',true,'SalaryBox radius 300 m: pin may be loose',false),
 ('CC-ND-Alpha 2',28.4730375,77.5296094,'salarybox','Greater Noida KB Complex',true,'matched by area, check on first visit',false),
 ('CC-ND-Gaur City',28.568131194903593,77.44511041165678,'salarybox','Bishrak, Noida',true,'matched by area, check on first visit',false),
 ('CC-ND-Diamond Plaza',28.606750858279575,77.43252164791986,'salarybox','Diamond Plaza, Gr. Noida',false,null,false),
 ('CC-DL-Mayur Vihar Ph 3',28.602856242879977,77.3307575969242,'salarybox','Kondli, Delhi',true,'matched by area, check on first visit',false),
 ('CC-DL-NFC',28.57137022877959,77.27009083095213,'salarybox','New Friends Colony, Delhi',false,null,false),
 ('CC-GZB-Raj Nagar',28.69536139181981,77.45007446135959,'salarybox','Raj Nagar, Ghaziabad',false,null,false),
 ('CC-GZB-Vasundhara',28.6582375,77.3662344,'salarybox','Vasundhara, GZB',false,null,false),
 ('CC-UP-Meerut',28.96030547467742,77.72955540247384,'salarybox','Meerut, UP',false,null,false),
 ('CC-DL-Dwarka',28.5879233,77.07032509999999,'salarybox','Dwarka New Delhi',false,null,false),
 ('CC-DL-Dwarka Mor',28.62031783549661,77.02936733644694,'salarybox','Dwarka Mor, Delhi',false,null,false),
 ('CC-DL-Janakpuri',28.6317873,77.08573609999999,'salarybox','JANAKPURI WEST DELHI',true,'two Janakpuri branches in SalaryBox; check',false),
 ('CC-DL-Karol Bagh',28.6488611,77.1982357,'salarybox','Karol Bagh',false,null,false),
 ('CC-DL-Krishna Nagar',28.65964,77.287486,'salarybox','KRISHNA NAGAR',false,null,false),
 ('CC-DL-Paschim Vihar',28.671342,77.111646,'salarybox','Delhi Paschim Vihar',false,null,false),
 ('CC-DL-Rohini',28.728835864562694,77.11457782540396,'salarybox','Rohini Sec 11, Delhi',false,null,false),
 ('CC-DL-Sarita Vihar',28.53733129629425,77.29779937692948,'salarybox','Sarita Vihar, Delhi',false,null,false),
 ('CC-DL-Shalimar Bagh',28.70546986125751,77.16902453713492,'salarybox','Delhi, Shalimar Bagh',false,null,false),
 ('CC-FBD-Sector 15',28.395818924603628,77.3140070512474,'salarybox','Faridabad Sec 15',false,null,false),
 ('CC-FBD-Sector 37',28.480088,77.3081309,'salarybox','Faridabad, Sector 37',false,null,false),
 ('CC-DL-Shahpurjat',28.5473875,77.2155156,'salarybox','Delhi Shahpur Jat',false,null,false),
 ('CC-DL-South Campus',28.587257164037688,77.17076541904906,'salarybox','Delhi South Campus',true,'store moved from Udyog Vihar (F62); check',false),
 ('CC-DL-Vasant Kunj',28.516167356810012,77.16412595245542,'salarybox','Vasantkunj, Delhi',false,null,false),
 ('CC-GGN-DLF Ph 4',28.4731329,77.0802776,'salarybox','DLF Phase 4, Gurgaon',false,null,false),
 ('CC-GGN-Sector 4',28.4745193,77.0092489,'salarybox','Gurgaon , Sector 4',true,'outlet master code is DLF 3; check',false),
 ('CC-GGN-Sector 49',28.420107,77.05168019999999,'salarybox','Sector 49, Gurgaon',false,null,false),
 ('CC-GGN-Sector 52',28.4397834,77.0781942,'salarybox','Gurgaon, Sector 52',false,null,false),
 ('CC-GGN-Sector 60',28.4063262,77.0935142,'salarybox','Sector 60, Gurgaon',false,null,false),
 ('CC-GGN-Sector 86',28.403337,76.945577,'salarybox','Sector 86, Gurgaon',false,null,false),
 ('CC-CHD-Industrial Area',30.69015985316811,76.86035543626306,'salarybox','Chandigarh, Panchkhula',true,'store shifted to Panchkula 16 May 2026; check',false),
 ('CC-CHD-Mohali',30.71380150534186,76.69912583179034,'salarybox','Chandigarh, Mohali',false,null,false),
 ('CC-CHD-Sector 16',30.748161322622796,76.77454546978574,'salarybox','Chandigarh, Sector 16D',false,null,false),
 ('CC-CHD-Zirakpur',30.64334896807905,76.81972827411043,'salarybox','Chandigarh, Zirakpur',false,null,false),
 ('CC-PB-Ludhiana',30.90167130587761,75.83310444358597,'salarybox','Ludhiana',false,null,false),
 ('CC-JP-Bais Godam',26.901396670628685,75.78859834369636,'salarybox','Jaipur, 22 Godam',false,null,false),
 ('CC-JP-Malviya Nagar',26.847070751570417,75.79473076315992,'salarybox','Jaipur, Malviya Nagar',false,null,false),
 ('CC-JP-Pratap Nagar',26.803274319394333,75.83701872090148,'salarybox','Jaipur, Pratap Nagar',false,null,false),
 ('CC-JP-Vaishali Nagar',26.911129324859353,75.74520334173354,'salarybox','Jaipur, Vaishali Nagar',false,null,false),
 ('CC-LKO-Ashiyana',26.794339391271528,80.9188838294651,'salarybox','Lucknow, Ashiyana',false,null,false),
 ('CC-LKO-Gomti Nagar',26.861045660519444,81.00990348408664,'salarybox','Lucknow, Gomti Nagar',false,null,false),
 ('CC-LKO-Hazratganj',26.84796781829182,80.94713255581617,'salarybox','Lucknow, Hazratganj',false,null,false),
 ('CC-LKO-Jankipuram',26.907507530213525,80.95173227916793,'salarybox','Lucknow, Jankipuram',false,null,false),
 ('TEST-OFFICE',28.6071226,77.38317789999999,'salarybox','Corporate Office (B79, Sector 67, Noida)',false,'test site only, never counts',true)
on conflict (store) do nothing;

-- ---------- the day plan ----------
create table if not exists am.plan (
  id            bigserial primary key,
  person        uuid not null,
  person_name   text,
  plan_date     date not null,
  stores        text[] not null,
  confirmed_at  timestamptz not null default now(),
  late          boolean not null,                     -- confirmed after 10:00 IST
  is_test       boolean not null default true,
  voided_at     timestamptz,
  void_reason   text
);
create unique index if not exists plan_one_per_day on am.plan (person, plan_date) where voided_at is null;
create table if not exists am.plan_change (           -- unplanned stop added, or planned stop missed
  id        bigserial primary key,
  plan_id   bigint not null references am.plan(id),
  kind      text not null check (kind in ('added','missed')),
  store     text not null,
  reason    text not null,
  at        timestamptz not null default now(),
  is_test   boolean not null default true
);

-- ---------- a visit (AM now; QA surprise audit later, same tables) ----------
create table if not exists am.visit (
  id                bigserial primary key,
  kind              text not null default 'am_visit' check (kind in ('am_visit','qa_audit')),
  person            uuid not null,
  person_name       text,
  store             text not null,
  plan_id           bigint references am.plan(id),
  planned           boolean not null,
  unplanned_reason  text,
  checklist_version int not null default 1,
  checkin_at        timestamptz not null default now(),
  checkin_lat       double precision,
  checkin_lng       double precision,
  checkin_acc_m     double precision,
  checkin_dist_m    double precision,
  checkout_at       timestamptz,
  checkout_lat      double precision,
  checkout_lng      double precision,
  checkout_acc_m    double precision,
  checkout_dist_m   double precision,
  seen_at           timestamptz,                      -- in-charge saw the to-do list
  status            text not null default 'in_progress' check (status in ('in_progress','closed')),
  sections_done     text[] not null default '{}',
  inv_items         jsonb not null default '[]',      -- the 8 items picked for the blind count
  inv_locked_at     timestamptz,                      -- physical counts locked
  is_test           boolean not null default true,
  voided_at         timestamptz,
  void_reason       text,
  updated_at        timestamptz not null default now()
);
create index if not exists visit_store on am.visit (store, checkin_at desc);
create index if not exists visit_person on am.visit (person, checkin_at desc);

create table if not exists am.photo (
  id             bigserial primary key,
  visit_id       bigint references am.visit(id),
  purpose        text not null,                       -- front, audit:<code>, order:<key>, stock_screen
  storage_path   text not null unique,                -- inside bucket am-photos
  content_type   text not null,
  bytes          integer not null,
  taken_by       uuid not null,
  taken_at       timestamptz not null default now(),
  is_test        boolean not null default true,
  voided_at      timestamptz,
  void_reason    text
);

create table if not exists am.audit_answer (           -- appended; latest per (visit, item) is current
  id           bigserial primary key,
  visit_id     bigint not null references am.visit(id),
  item_code    text not null,
  result       text not null check (result in ('pass','fail')),
  note         text,
  photo_id     bigint references am.photo(id),
  answered_by  uuid not null,
  answered_at  timestamptz not null default now()
);
create index if not exists audit_answer_visit on am.audit_answer (visit_id, item_code, id desc);

create table if not exists am.order_check (            -- appended; latest per (visit, check_key)
  id          bigserial primary key,
  visit_id    bigint not null references am.visit(id),
  check_key   text not null check (check_key in ('pp_po','pp_to','sn_po','sn_so')),
  pending     integer not null check (pending >= 0),
  photo_id    bigint references am.photo(id),
  by_person   uuid not null,
  at          timestamptz not null default now()
);

create table if not exists am.stock_count (            -- appended; latest per (visit, item)
  id          bigserial primary key,
  visit_id    bigint not null references am.visit(id),
  item        text not null,
  item_kind   text not null,                           -- add_on, finished_good
  physical    numeric,
  petpooja    numeric,
  reason      text,
  by_person   uuid not null,
  at          timestamptz not null default now()
);

create table if not exists am.todo (                   -- a fix for the store, born on a visit
  id          bigserial primary key,
  visit_id    bigint not null references am.visit(id),
  store       text not null,
  text        text not null,
  source      text not null,                           -- audit:<code>, stock, order:<key>, added
  critical    boolean not null default false,
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  is_test     boolean not null default true
);
create table if not exists am.next_check (             -- "look at this next time", born on a visit
  id          bigserial primary key,
  visit_id    bigint not null references am.visit(id),
  store       text not null,
  text        text not null,
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  is_test     boolean not null default true
);
create table if not exists am.point_mark (             -- an open point checked on a later visit
  id          bigserial primary key,
  ref_kind    text not null check (ref_kind in ('todo','next_check')),
  ref_id      bigint not null,
  visit_id    bigint not null references am.visit(id),
  status      text not null check (status in ('done','open')),
  by_person   uuid not null,
  at          timestamptz not null default now()
);
create table if not exists am.question_seen (          -- an open ERP Question discussed on a visit
  id           bigserial primary key,
  visit_id     bigint not null references am.visit(id),
  question_id  bigint not null,
  note         text,
  by_person    uuid not null,
  at           timestamptz not null default now()
);

revoke all on all tables in schema am from public, anon, authenticated;
revoke all on all sequences in schema am from public, anon, authenticated;
