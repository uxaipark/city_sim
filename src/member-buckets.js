// Intrusive lists: moving an item between buckets is O(1), with no per-frame allocations.
export class MemberBuckets {
  constructor(bucketCount, itemCount) {
    this.size = new Uint32Array(bucketCount);
    this.head = new Int32Array(bucketCount).fill(-1);
    this.next = new Int32Array(itemCount).fill(-1);
    this.prev = new Int32Array(itemCount).fill(-1);
    this.bucket = new Int32Array(itemCount).fill(-1);
  }

  move(item, target) {
    const old = this.bucket[item];
    if (old === target) return;
    const prev = this.prev[item], next = this.next[item];
    if (old !== -1) {
      this.size[old]--;
      if (prev === -1) this.head[old] = next;
      else this.next[prev] = next;
      if (next !== -1) this.prev[next] = prev;
    }
    this.size[target]++;
    const first = this.head[target];
    this.bucket[item] = target;
    this.prev[item] = -1; this.next[item] = first;
    if (first !== -1) this.prev[first] = item;
    this.head[target] = item;
  }
}
