/**
 * The on-disk index format: its version and the small shared vocabulary the
 * serializer and `parseIndex` both speak. The field layout is documented in
 * `docs/engineering/architecture.md` ("The index format").
 *
 * Format 1 is the compact format: minified JSON, every node id stored once (in
 * `hierarchy.json`, `ids`) and referenced everywhere else by its position in
 * that array, every repeated attribute string stored once in `nodes.json`
 * (`strings`) and referenced by position, tuples instead of keyed objects.
 */

/**
 * The format version written to every index file as `formatVersion`. Bump it on
 * any change to a file's layout or to the meaning of a code below. `parseIndex`
 * accepts exactly this version and refuses everything else, including an index
 * with no version (the pre-compact format): there is no reader for old formats.
 */
export const INDEX_FORMAT_VERSION = 1;

/**
 * Node kinds by code, as stored in `hierarchy.json` rows. The position is the
 * code; the list only ever grows at the end, and any change is a format bump.
 */
export const NODE_KIND_CODES = ["repository", "group", "file", "class", "function"] as const;

/** The integer stored where an optional reference or value is absent. */
export const ABSENT = -1;
