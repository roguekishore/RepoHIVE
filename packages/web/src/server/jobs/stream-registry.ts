/** At most five open SSE streams per IP. */

const MAX_OPEN_STREAMS_PER_IP = 5;

const openByIp = new Map<string, Set<string>>();

export function tryRegisterJobEventStream(ip: string, streamId: string): boolean {
  let set = openByIp.get(ip);
  if (set === undefined) {
    set = new Set();
    openByIp.set(ip, set);
  }
  if (set.size >= MAX_OPEN_STREAMS_PER_IP && !set.has(streamId)) {
    return false;
  }
  set.add(streamId);
  return true;
}

export function unregisterJobEventStream(ip: string, streamId: string): void {
  const set = openByIp.get(ip);
  if (set === undefined) {
    return;
  }
  set.delete(streamId);
  if (set.size === 0) {
    openByIp.delete(ip);
  }
}

export function resetJobEventStreamRegistryForTests(): void {
  openByIp.clear();
}
