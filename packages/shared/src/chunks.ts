/**
 * Chunked output primitives shared by the two serializers.
 *
 * An artifact is rendered as a sequence of small string pieces and written as a
 * sequence of chunks, so no single JavaScript string ever grows with the size of
 * the artifact (V8's maximum string length is about 512 million characters, and
 * the largest repositories produce more output than that in one file).
 */

/** Buffered pieces are flushed once they reach this many characters. */
export const CHUNK_TARGET_LENGTH = 64 * 1024;

/**
 * A chunk never grows past this many characters by coalescing. A single piece
 * that is itself longer (one element whose own rendering exceeds it) is passed
 * through whole, as its own chunk.
 */
export const CHUNK_MAX_LENGTH = 1024 * 1024;

/**
 * Coalesce a stream of small pieces into chunks of about
 * {@link CHUNK_TARGET_LENGTH} characters. The concatenation of the output equals
 * the concatenation of the input, byte for byte; only the boundaries differ.
 * The input is consumed lazily and the empty piece is dropped.
 */
export function* coalesceChunks(pieces: Iterable<string>): Generator<string, void, undefined> {
  let buffer = "";
  for (const piece of pieces) {
    if (piece.length === 0) {
      continue;
    }
    if (buffer.length > 0 && buffer.length + piece.length > CHUNK_MAX_LENGTH) {
      yield buffer;
      buffer = "";
    }
    buffer += piece;
    if (buffer.length >= CHUNK_TARGET_LENGTH) {
      yield buffer;
      buffer = "";
    }
  }
  if (buffer.length > 0) {
    yield buffer;
  }
}
