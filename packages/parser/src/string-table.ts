/**
 * String tables: the compact encoding the worker pool moves strings in.
 *
 * A thread boundary is where structured cloning would copy an object graph
 * string by string. Instead each side interns every distinct string once and
 * moves two typed arrays: the strings' UTF-8 bytes back to back, and the offsets
 * that cut them apart. Records elsewhere in a message then refer to a string by
 * its integer id. Both arrays can be transferred (or, for the one read-only
 * table every worker needs, placed in shared memory) so nothing is copied.
 *
 * Decoding goes through `Buffer`'s UTF-8 decoder, the one a file read uses, so a
 * string survives a round trip exactly. The one exception is a lone UTF-16
 * surrogate, which UTF-8 cannot carry; no string the parser produces (decoded
 * source text and identifiers drawn from it) can contain one.
 */

/** A frozen string table in its transferable form. */
export interface EncodedStrings {
  /** The strings' UTF-8 bytes, concatenated in id order. */
  bytes: Uint8Array;
  /** `count + 1` offsets into `bytes`; string `i` is `bytes[offsets[i] .. offsets[i + 1])`. */
  offsets: Uint32Array;
}

/** Interns strings to dense integer ids, then freezes them as {@link EncodedStrings}. */
export class StringTableBuilder {
  private readonly ids = new Map<string, number>();
  private readonly strings: string[] = [];

  /** The id of `value`, assigning the next one on first sight. */
  intern(value: string): number {
    const existing = this.ids.get(value);
    if (existing !== undefined) {
      return existing;
    }
    const id = this.strings.length;
    this.ids.set(value, id);
    this.strings.push(value);
    return id;
  }

  /** The number of distinct strings interned so far. */
  get size(): number {
    return this.strings.length;
  }

  /**
   * Freeze into typed arrays. `shared` places them in `SharedArrayBuffer`s, for
   * a table every worker reads and none writes; otherwise they are ordinary
   * buffers, ready to be transferred.
   */
  encode(shared = false): EncodedStrings {
    let total = 0;
    for (const value of this.strings) {
      total += Buffer.byteLength(value, "utf8");
    }
    const make = (byteLength: number): ArrayBufferLike =>
      shared ? new SharedArrayBuffer(byteLength) : new ArrayBuffer(byteLength);
    const bytes = new Uint8Array(make(total));
    const offsets = new Uint32Array(make((this.strings.length + 1) * Uint32Array.BYTES_PER_ELEMENT));
    const target = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let position = 0;
    for (let i = 0; i < this.strings.length; i += 1) {
      offsets[i] = position;
      position += target.write(this.strings[i] as string, position, "utf8");
    }
    offsets[this.strings.length] = position;
    return { bytes, offsets };
  }
}

/** Decode every string of an {@link EncodedStrings}, in id order. */
export function decodeStrings(encoded: EncodedStrings): string[] {
  const source = Buffer.from(encoded.bytes.buffer, encoded.bytes.byteOffset, encoded.bytes.byteLength);
  const count = encoded.offsets.length - 1;
  const out = new Array<string>(Math.max(count, 0));
  for (let i = 0; i < count; i += 1) {
    out[i] = source.toString("utf8", encoded.offsets[i] as number, encoded.offsets[i + 1] as number);
  }
  return out;
}
