-- Tag.desireLocks: what holding a tag does to the Desire catalog, from
-- docs/tags.yaml's `desires:` block. Normalised + validated by
-- db/lib/desireShapes.js. An ARRAY of clauses (union semantics), each
-- exactly one of {all:true} | {families:[...]} | {tiers:[...]} plus an
-- optional exceptFamilies. Null for the ~99% of tags that lock nothing. The
-- GM custom-tag form gets no editor for this column.

-- AlterTable
ALTER TABLE "Tag" ADD COLUMN     "desireLocks" JSONB;
