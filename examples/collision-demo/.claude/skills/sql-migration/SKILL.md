---
name: sql-migration
description: >
  Use this skill when writing or reviewing a database schema migration —
  adding columns, changing types, backfilling data, or renaming tables on a
  live system. Reach for it whenever a change needs to run against a database
  that cannot be taken offline.
---

# SQL migrations

Write schema changes that are safe to run against a live database.

## When to use this

Any change to a database schema on a system with traffic. Not query
optimisation, and not ORM model changes that do not touch the schema.

## The rule that matters

Every migration must be safe to run while the old application version is still
serving requests, because during a deploy both versions run at once.

## Procedure

1. Split any destructive change into expand, migrate, contract — three
   deploys, never one.
2. Add columns as nullable, always. A `NOT NULL` column with a default rewrites
   the whole table on older engines and locks it for the duration.
3. Backfill in batches with an explicit sleep between them. A single
   `UPDATE` over millions of rows holds locks long enough to take the site down.
4. Create indexes concurrently. The non-concurrent form blocks writes for the
   entire build.
5. Write the rollback before the migration. If you cannot write one, the
   migration is not ready.

## Verifying

Run the migration against a restored production snapshot and record the
duration. A migration that takes four seconds on a development database can
take forty minutes on real data.
