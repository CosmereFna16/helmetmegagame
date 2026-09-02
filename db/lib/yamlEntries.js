// The YAML masters write their catalogs as maps keyed by the entry's own id:
//
//   tags:
//     hungerless:
//       name: Hungerless
//
// rather than as a sequence of `- slug: hungerless`. The reason is purely
// authoring comfort: an editor's outline labels a map entry with its key and a
// sequence entry with its index, so 500 tags used to read as "{} 0, {} 1, …".
//
// Every sync reads its block through here, which hands back the old array of
// objects with the key folded back in as `keyField`. Insertion order is
// preserved, so a sync that sorts by position (documents, zones) is unchanged.
// A sequence still parses, so an entry written the old way keeps working.
function entriesOf(node, keyField) {
  if (!node) return [];
  if (Array.isArray(node)) return node;
  return Object.entries(node).map(([key, value]) => ({ [keyField]: key, ...(value ?? {}) }));
}

module.exports = { entriesOf };
