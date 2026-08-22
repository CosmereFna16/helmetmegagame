import { prisma } from "@lifeweb/db";
import {
  recordArchiveEvent as record,
  recordArchiveMessage as recordMessage,
} from "@lifeweb/db/lib/archive";

// Thin shim binding the singleton prisma, same convention as
// web/lib/factionPermissions.js: db/lib/archive.js takes `prisma` as its first
// parameter so db/index.js can use it without a circular require, and web call
// sites shouldn't have to thread it through every time.
//
// Every write is best-effort and swallows its own failure inside db/lib —
// a transcript row is never worth failing a player's action over. Call these
// OUTSIDE a transaction: they're not part of the effect being applied, and
// holding a tx open on them buys nothing.

export function recordArchiveEvent(entry) {
  return record(prisma, entry);
}

export function recordArchiveMessage(entry) {
  return recordMessage(prisma, entry);
}
