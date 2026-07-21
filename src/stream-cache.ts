/**
 * Incremental cache for subgraph event streams. Rows from indexed blocks are immutable,
 * so each stream is cached (in memory for the session + optionally persisted, e.g.
 * IndexedDB via localforage) together with the block it was synced to; the next read
 * fetches only the tail. Aggregations always run over the full merged stream, so
 * enabling/disabling the cache never changes results.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface StreamCacheStorage {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getItem(key: string): Promise<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setItem(key: string, value: any): Promise<any>;
}

export interface StreamCacheEntry {
    syncedToBlock: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows: any[];
}

const SCHEMA_VERSION = 1;
const DEFAULT_REORG_MARGIN = 1000;

let storage: StreamCacheStorage | undefined;
let enabled = false;
let reorgMargin = DEFAULT_REORG_MARGIN;
// session-level layer: avoids re-reading/cloning multi-MB entries from IndexedDB on
// every guardian switch
const memory = new Map<string, StreamCacheEntry>();

export function configureStreamCache(options: { storage?: StreamCacheStorage; enabled?: boolean; reorgMargin?: number }) {
    if (options.storage !== undefined) storage = options.storage;
    if (options.enabled !== undefined) enabled = options.enabled;
    if (options.reorgMargin !== undefined) reorgMargin = options.reorgMargin;
}

export function isStreamCacheEnabled(): boolean {
    return enabled;
}

export function getStreamCacheReorgMargin(): number {
    return reorgMargin;
}

export function streamCacheKey(chainId: number, plural: string, addressField: string | undefined, address: string | undefined, fromBlock: number): string {
    return `posag:v${SCHEMA_VERSION}:${chainId}:${plural}:${addressField || ''}:${(address || '').toLowerCase()}:${fromBlock}`;
}

export async function streamCacheGet(key: string): Promise<StreamCacheEntry | undefined> {
    if (!enabled) return undefined;
    const inMemory = memory.get(key);
    if (inMemory) return inMemory;
    if (!storage) return undefined;
    try {
        const entry = await storage.getItem(key);
        if (entry && typeof entry.syncedToBlock === 'number' && Array.isArray(entry.rows)) {
            memory.set(key, entry);
            return entry;
        }
    } catch (e) {
        // a broken cache must never break reads
    }
    return undefined;
}

export async function streamCacheSet(key: string, entry: StreamCacheEntry) {
    if (!enabled) return;
    memory.set(key, entry);
    if (!storage) return;
    try {
        await storage.setItem(key, entry);
    } catch (e) {
        // a broken cache must never break reads
    }
}
