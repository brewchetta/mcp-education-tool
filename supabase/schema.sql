-- Education MCP knowledge base schema.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

create extension if not exists pgcrypto;

create table if not exists topics (
  id                uuid primary key default gen_random_uuid(),
  title             text not null unique,
  wikipedia_page_id bigint,
  url               text,
  summary           text,
  content           text not null,
  fetched_at        timestamptz not null default now()
);

create table if not exists quizzes (
  id         uuid primary key default gen_random_uuid(),
  topic_id   uuid not null references topics(id) on delete cascade,
  title      text not null,
  difficulty text,
  created_at timestamptz not null default now()
);

create table if not exists quiz_questions (
  id            uuid primary key default gen_random_uuid(),
  quiz_id       uuid not null references quizzes(id) on delete cascade,
  position      int  not null,
  question      text not null,
  choices       jsonb not null,
  correct_index int  not null check (correct_index >= 0),
  explanation   text
);

create table if not exists flashcard_decks (
  id         uuid primary key default gen_random_uuid(),
  topic_id   uuid not null references topics(id) on delete cascade,
  title      text not null,
  created_at timestamptz not null default now()
);

create table if not exists flashcards (
  id       uuid primary key default gen_random_uuid(),
  deck_id  uuid not null references flashcard_decks(id) on delete cascade,
  position int  not null default 0,
  front    text not null,
  back     text not null
);

create index if not exists quizzes_topic_idx          on quizzes(topic_id);
create index if not exists quiz_questions_quiz_idx    on quiz_questions(quiz_id);
create index if not exists flashcard_decks_topic_idx  on flashcard_decks(topic_id);
create index if not exists flashcards_deck_idx        on flashcards(deck_id);

-- Lock the tables down: RLS on with no policies means the public anon key can
-- read/write nothing. The MCP server uses the service-role key, which bypasses RLS.
alter table topics          enable row level security;
alter table quizzes         enable row level security;
alter table quiz_questions  enable row level security;
alter table flashcard_decks enable row level security;
alter table flashcards      enable row level security;
