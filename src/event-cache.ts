/**
 * Copyright 2020 the pos-analytics authors
 * This file is part of the pos-analytics library in the Orbs project.
 *
 * This source code is licensed under the MIT license found in the LICENSE file in the root directory of this source tree.
 * The above notice should be included in all copies or substantial portions of the software.
 */

// Incremental cache for contract event logs.
//
// Event logs from finalized blocks are immutable, so once a range has been read it never
// needs to be read again: we persist the raw events together with the block number we
// synced to, and the next read only fetches the tail (with a reorg safety margin).
// Aggregations keep running over the full merged list, so enabling/disabling the cache
// must never change results - only how much of the history comes from the network.
//
// The storage backend is pluggable (browser: localforage/IndexedDB, node: anything
// implementing getItem/setItem). With no storage configured, or enabled=false, every
// read behaves exactly as before.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface EventCacheStorage {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getItem(key: string): Promise<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setItem(key: string, value: any): Promise<any>;
}

export interface EventCacheOptions {
    storage?: EventCacheStorage;
    enabled?: boolean;
    reorgMargin?: number;
}

export interface EventCacheEntry {
    syncedToBlock: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    events: any[];
}

// bump when the shape of cached entries (or of the events we rely on) changes;
// old entries are simply never read again
const SCHEMA_VERSION = 1;
const DEFAULT_REORG_MARGIN = 1000;

let cacheStorage: EventCacheStorage | undefined;
let cacheEnabled = false;
let cacheReorgMargin = DEFAULT_REORG_MARGIN;

export function configureEventCache(options: EventCacheOptions) {
    if (options.storage !== undefined) cacheStorage = options.storage;
    if (options.enabled !== undefined) cacheEnabled = options.enabled;
    if (options.reorgMargin !== undefined) cacheReorgMargin = options.reorgMargin;
}

export function isEventCacheEnabled(): boolean {
    return cacheEnabled && cacheStorage !== undefined;
}

export function getEventCacheReorgMargin(): number {
    return cacheReorgMargin;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function eventCacheKey(chainId: number, contractAddress: string, filter: any, fromBlock: number): string {
    return `posevc:v${SCHEMA_VERSION}:${chainId}:${String(contractAddress).toLowerCase()}:${fromBlock}:${JSON.stringify(filter || [])}`;
}

export async function eventCacheGet(key: string): Promise<EventCacheEntry | undefined> {
    if (!isEventCacheEnabled()) return undefined;
    try {
        const entry = await cacheStorage!.getItem(key);
        if (entry && typeof entry.syncedToBlock === 'number' && Array.isArray(entry.events)) {
            return entry;
        }
    } catch (e) {
        // a broken cache must never break reads
    }
    return undefined;
}

// Strips event objects down to the fields the aggregation code actually reads (plus
// raw.topics, needed to filter by address locally). Roughly halves storage size.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function compactEvents(events: any[]): any[] {
    return events.map((e: any) => ({
        address: e.address,
        blockNumber: e.blockNumber,
        transactionIndex: e.transactionIndex,
        logIndex: e.logIndex,
        transactionHash: e.transactionHash,
        event: e.event,
        signature: e.signature,
        returnValues: e.returnValues,
        raw: { topics: (e.raw && e.raw.topics) || [] }
    }));
}

export async function eventCacheSet(key: string, entry: EventCacheEntry) {
    if (!isEventCacheEnabled()) return;
    try {
        await cacheStorage!.setItem(key, entry);
    } catch (e) {
        // a broken cache must never break reads
    }
}
