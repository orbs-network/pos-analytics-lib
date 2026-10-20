/**
 * Copyright 2020 the pos-analytics authors
 * This file is part of the pos-analytics library in the Orbs project.
 *
 * This source code is licensed under the MIT license found in the LICENSE file in the root directory of this source tree.
 * The above notice should be included in all copies or substantial portions of the software.
 */

// Reads contract events through the Etherscan V2 logs API instead of eth_getLogs.
// Used for chains whose RPC providers cap eth_getLogs block ranges (e.g. Polygon at 10K blocks).

const ETHERSCAN_API_URL = 'https://api.etherscan.io/v2/api';
const PAGE_SIZE = 1000; // max records per getLogs call
const MIN_INTERVAL_MS = 400; // free tier allows 3 calls/sec, keep a margin
const MAX_ATTEMPTS = 6;
const CACHE_OVERLAP_BLOCKS = 200; // re-read a few blocks on cache extension in case Etherscan lagged behind the chain head

export interface EtherscanConfig {
    apiKey: string;
    chainId: number;
    // raw logs per (address, topics, fromBlock), extended as later calls ask for higher toBlock
    cache: {[key: string]: {to: number, logs: any[], seen: {[id: string]: boolean}, chain: Promise<void>}};
}

export function createEtherscanConfig(apiKey: string, chainId: number): EtherscanConfig {
    if (!apiKey) {
        throw new Error('etherscan api key is required when using etherscan');
    }
    return {apiKey, chainId, cache: {}};
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function hexToNumber(hex: string): number {
    return hex === '0x' ? 0 : parseInt(hex, 16);
}

function logId(log: any): string {
    return `${log.transactionHash}_${log.logIndex}`;
}

// global throttle: rate limit is per api key and there is normally just one
let queue: Promise<any> = Promise.resolve();
function waitTurn(): Promise<any> {
    const turn = queue;
    queue = turn.then(() => sleep(MIN_INTERVAL_MS));
    return turn;
}

async function etherscanGet(config: EtherscanConfig, params: {[key: string]: string | number}): Promise<any> {
    const query = Object.keys(params).map(k => `${k}=${encodeURIComponent(String(params[k]))}`).join('&');
    const url = `${ETHERSCAN_API_URL}?chainid=${config.chainId}&${query}&apikey=${config.apiKey}`;
    let lastError = '';
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        await waitTurn();
        try {
            const response = await fetch(url);
            if (!response.ok) {
                lastError = `HTTP status ${response.status}`;
            } else {
                const json = await response.json();
                if (json.status === '1') {
                    return json.result;
                }
                if (json.message === 'No records found' || (Array.isArray(json.result) && json.result.length === 0)) {
                    return [];
                }
                lastError = `${json.message}: ${json.result}`;
                if (!/rate limit/i.test(lastError)) {
                    throw new Error(`etherscan request failed - ${lastError}`);
                }
            }
        } catch (e) {
            if (/^etherscan request failed/.test(e.message)) throw e;
            lastError = e.message;
        }
        await sleep(1000 * (attempt + 1));
    }
    throw new Error(`etherscan request failed after ${MAX_ATTEMPTS} attempts - ${lastError}`);
}

// all raw logs of address matching topics in [fromBlock, toBlock], ascending
async function fetchLogs(config: EtherscanConfig, address: string, topics: (string | null)[], fromBlock: number, toBlock: number | string): Promise<any[]> {
    const params: {[key: string]: string | number} = {module: 'logs', action: 'getLogs', address, toBlock, page: 1, offset: PAGE_SIZE};
    const usedTopics: number[] = [];
    topics.forEach((topic, i) => {
        if (topic) {
            params[`topic${i}`] = topic;
            usedTopics.forEach(j => params[`topic${j}_${i}_opr`] = 'and');
            usedTopics.push(i);
        }
    });

    // page by moving fromBlock forward (etherscan caps page*offset at 10K records)
    const results: any[] = [];
    const seen: {[id: string]: boolean} = {};
    let from = fromBlock;
    while (true) {
        const logs: any[] = await etherscanGet(config, {...params, fromBlock: from});
        for (const log of logs) {
            const id = logId(log);
            if (!seen[id]) {
                seen[id] = true;
                results.push(log);
            }
        }
        if (logs.length < PAGE_SIZE) break;
        const lastBlock = hexToNumber(logs[logs.length - 1].blockNumber);
        if (lastBlock <= from) {
            throw new Error(`etherscan: more than ${PAGE_SIZE} logs in block ${from} of ${address}`);
        }
        from = lastBlock; // last block may be partial so read it again
    }
    return results;
}

async function cachedFetchLogs(config: EtherscanConfig, address: string, topics: (string | null)[], fromBlock: number, toBlock: number | string): Promise<any[]> {
    if (typeof toBlock !== 'number') {
        return fetchLogs(config, address, topics, fromBlock, toBlock);
    }
    const key = `${address.toLowerCase()}|${JSON.stringify(topics)}|${fromBlock}`;
    if (!config.cache[key]) {
        config.cache[key] = {to: fromBlock - 1, logs: [], seen: {}, chain: Promise.resolve()};
    }
    const entry = config.cache[key];
    const run = entry.chain.then(async () => {
        if (toBlock > entry.to) {
            const from = Math.max(fromBlock, entry.to + 1 - CACHE_OVERLAP_BLOCKS);
            for (const log of await fetchLogs(config, address, topics, from, toBlock)) {
                const id = logId(log);
                if (!entry.seen[id]) {
                    entry.seen[id] = true;
                    entry.logs.push(log);
                }
            }
            entry.to = toBlock;
        }
    });
    entry.chain = run.catch(() => {}); // a failed read should not block the next caller
    await run;
    return entry.logs.filter(log => hexToNumber(log.blockNumber) <= toBlock);
}

// expand topic positions holding a list of alternatives into separate topic filters
function expandTopics(filter: (string[] | string | undefined | null)[]): (string | null)[][] {
    let expanded: (string | null)[][] = [[]];
    for (const topic of filter) {
        const options = Array.isArray(topic) ? topic : [topic || null];
        const next: (string | null)[][] = [];
        for (const prefix of expanded) {
            for (const option of options) {
                next.push([...prefix, option]);
            }
        }
        expanded = next;
    }
    return expanded;
}

// decode a raw log into the same shape web3's contract.getPastEvents returns
function decodeLog(log: any, contract: any, web3: any) {
    const signature = log.topics[0] ? log.topics[0].toLowerCase() : null;
    const abiItem = contract.options.jsonInterface.find((item: any) => item.type === 'event' && item.signature === signature);
    const event: any = {
        address: web3.utils.toChecksumAddress(log.address),
        blockHash: log.blockHash,
        blockNumber: hexToNumber(log.blockNumber),
        logIndex: hexToNumber(log.logIndex),
        removed: false,
        transactionHash: log.transactionHash,
        transactionIndex: hexToNumber(log.transactionIndex),
        returnValues: {},
        event: undefined,
        signature: null,
        raw: {data: log.data, topics: log.topics},
    };
    if (abiItem) {
        event.returnValues = web3.eth.abi.decodeLog(abiItem.inputs, log.data, abiItem.anonymous ? log.topics : log.topics.slice(1));
        delete event.returnValues.__length__; // as web3 contract decoding does
        event.event = abiItem.name;
        event.signature = abiItem.signature;
    }
    return event;
}

// drop-in replacement for contract.getPastEvents('allEvents', {topics: filter, fromBlock, toBlock})
export async function readEtherscanEvents(config: EtherscanConfig, filter: (string[] | string | undefined)[], contract: any, web3: any, fromBlock: number, toBlock: number | string) {
    const address = contract.options.address;
    let topicFilters = expandTopics(filter);
    let topic0Options: string[] | undefined;
    if (Array.isArray(filter[0]) && filter.slice(1).some(topic => topic)) {
        // a single query on the other topics, then filter the event types locally
        topic0Options = filter[0].map(t => t.toLowerCase());
        topicFilters = expandTopics([undefined, ...filter.slice(1)]);
    }

    const results = await Promise.all(topicFilters.map(topics => cachedFetchLogs(config, address, topics, fromBlock, toBlock)));
    const seen: {[id: string]: boolean} = {};
    const events: any[] = [];
    for (const logs of results) {
        for (const log of logs) {
            const id = logId(log);
            if (seen[id] || (topic0Options && topic0Options.indexOf(String(log.topics[0]).toLowerCase()) === -1)) continue;
            seen[id] = true;
            events.push(decodeLog(log, contract, web3));
        }
    }
    events.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
    return events;
}
