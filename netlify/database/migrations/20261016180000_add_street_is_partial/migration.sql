-- "Partial" flag per street (2026-10-16): Santa only covers part of the
-- street on his way to another one. The public site shows an info note
-- under any street with this set.
ALTER TABLE streets ADD COLUMN is_partial BOOLEAN NOT NULL DEFAULT false;
