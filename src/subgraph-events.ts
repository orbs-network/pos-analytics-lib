/**
 * Copyright 2020 the pos-analytics authors
 * This file is part of the pos-analytics library in the Orbs project.
 *
 * This source code is licensed under the MIT license found in the LICENSE file in the root directory of this source tree.
 * The above notice should be included in all copies or substantial portions of the software.
 */

// Event streams served by the orbs-pos-analytics subgraphs (orbs-network/subgraphs,
// pos-analytics package) instead of eth_getLogs chain scans. The subgraph stores one
// immutable entity per raw event; this module queries them and synthesizes objects
// shaped like web3 getPastEvents results, so the aggregation code is unchanged.

import Web3 from 'web3';
import { retry } from 'ts-retry-promise';
import { stakeAbi } from './abis/stake';
import { delegationAbi } from './abis/delegation';
import { rewardsAbi } from './abis/rewards';
import { feeBootstrapRewardAbi } from './abis/feebootstrap';
import { guardianAbi } from './abis/guardian';

const defaultEndpoints: {[chainId: number]: string} = {
    1: 'https://api.studio.thegraph.com/query/55061/orbs-pos-analytics-eth/v0.0.1',
    137: 'https://api.studio.thegraph.com/query/55061/orbs-pos-analytics-pol/v0.0.1'
};
let endpoints = { ...defaultEndpoints };

// Override the subgraph query endpoints (e.g. production proxy behind hub.orbs.network).
export function configurePosAnalyticsSubgraph(overrides: {[chainId: number]: string}) {
    endpoints = { ...endpoints, ...overrides };
}

export function getSubgraphEndpoint(chainId: number): string {
    const endpoint = endpoints[chainId];
    if (!endpoint) throw new Error(`no pos-analytics subgraph endpoint configured for chain ${chainId}`);
    return endpoint;
}

export interface EventSpec {
    contract: string;      // Contracts enum value (registry key)
    name: string;          // ABI event name (== web3 event.event)
    topic: string;         // keccak of the event signature (== web3 event.signature)
    plural: string;        // graphql collection name in the subgraph
    fields: string[];      // event input names, in ABI order
    addressField?: string; // first indexed input - what an address topic filter matches
}

// contract registry keys must match the Contracts enum in eth-helpers (avoid circular import)
const CONTRACT_ABIS: {[contract: string]: any[]} = {
    'Stake': stakeAbi,
    'delegations': delegationAbi,
    'stakingRewards': rewardsAbi,
    'feesAndBootstrapRewards': feeBootstrapRewardAbi,
    'guardiansRegistration': guardianAbi
};

// the event topics the lib consumes, per contract (see Topics enum in eth-helpers)
const WANTED_TOPICS: {[contract: string]: string[]} = {
    'Stake': [
        '0x1449c6dd7851abc30abf37f57715f492010519147cc2652fbc38202c18a6ee90',
        '0xa217c421e0e9357b7b1815d752952b142ddc0e23f9f14ecb8233f8f83d563c4d',
        '0x7fc4727e062e336010f2c282598ef5f14facb3de68cf8195c2f23e1454b2b74e',
        '0xadec52fcd1408589179b85e44b434374db078b4eaf793e7d1a1bb0ae4ecfeee5'
    ],
    'delegations': [
        '0x4bc154dd35d6a5cb9206482ecb473cdbf2473006d6bce728b9cc0741bcc59ea2',
        '0x52db726bc1b1643b24886ed6f0194a41de9abac79d1c12108aca494e5b2bda6b'
    ],
    'stakingRewards': [
        '0x5830b366dc4564bf14d32116f14c979ac2c150a96b7c6b99bea717e6990d56ba',
        '0x411edbca4a882d6fbf12b557451a9358a63f73e3011a8c712885cb1e207120dd',
        '0x3880098574881d40bf7b9775086fdc9e6d6edac939d881add769581473c84b45',
        '0x5f51e0cd4567b63928e199868f571929625ded3459b724759a0eb8edbf94158b'
    ],
    'feesAndBootstrapRewards': [
        '0x0964bebae9e6862697e967a3fe1c7ba8a0f52ba9b6d2cd754a41e8c3be7f8d66',
        '0x40ed9423e22a17617adb53819ad0279d3d22356c958e384e233214c870561b99',
        '0x565f40e50eac33ad36895230f693465a27f5341f25e6525568ae66cb24eb1a15',
        '0xdeb5099d7943aa2b4c1142e5d53d2f7636aa8f7bd130ec79816f151572bcdf45'
    ],
    'guardiansRegistration': [
        '0xc2d72ac93e7fb29c534663a530cd3db012d5c336965e423e0ed5ee7a64ed8745'
    ]
};

function lcFirst(s: string): string { return s.charAt(0).toLowerCase() + s.slice(1); }

function buildSpecs(): {byTopic: {[topic: string]: EventSpec}, byContract: {[contract: string]: EventSpec[]}} {
    const byTopic: {[topic: string]: EventSpec} = {};
    const byContract: {[contract: string]: EventSpec[]} = {};
    for (const contract of Object.keys(CONTRACT_ABIS)) {
        byContract[contract] = [];
        for (const wanted of WANTED_TOPICS[contract]) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ev = CONTRACT_ABIS[contract].filter((e: any) => e.type === 'event')
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .find((e: any) => Web3.utils.sha3(`${e.name}(${e.inputs.map((i: any) => i.type).join(',')})`) === wanted);
            if (!ev) throw new Error(`pos-analytics subgraph: no ABI event for topic ${wanted} in ${contract}`);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const firstIndexed = ev.inputs.find((i: any) => i.indexed);
            const spec: EventSpec = {
                contract,
                name: ev.name,
                topic: wanted,
                plural: `${lcFirst(ev.name)}s`,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                fields: ev.inputs.map((i: any) => i.name),
                addressField: firstIndexed ? firstIndexed.name : undefined
            };
            byTopic[wanted] = spec;
            byContract[contract].push(spec);
        }
    }
    return { byTopic, byContract };
}

const specs = buildSpecs();

export function specForTopic(topic: string): EventSpec {
    const spec = specs.byTopic[String(topic).toLowerCase()];
    if (!spec) throw new Error(`pos-analytics subgraph: unsupported event topic ${topic}`);
    return spec;
}

export function specsForContract(contract: string): EventSpec[] {
    const list = specs.byContract[contract];
    if (!list) throw new Error(`pos-analytics subgraph: unsupported contract ${contract}`);
    return list;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function postQuery(endpoint: string, query: string): Promise<any> {
    return retry(async () => {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
        });
        if (!response.ok) throw new Error(`subgraph HTTP ${response.status}`);
        const { data, errors } = await response.json();
        if (errors) throw new Error(`subgraph errors: ${JSON.stringify(errors).slice(0, 300)}`);
        return data;
    }, { retries: 3, delay: 300 });
}

export interface StreamQuery {
    fromBlock: number;
    toBlock?: number;          // undefined = up to the subgraph head
    address?: string;          // filter value for addressField (or addressFieldOverride)
    addressFieldOverride?: string; // e.g. query Delegated by 'to' instead of 'from'
}

const PAGE_SIZE = 1000;
const GLOBAL_STREAM_PARTITIONS = 8;   // big unfiltered streams (e.g. Polygon allocated: 150k+ rows)
const FILTERED_STREAM_PARTITIONS = 4;

// head block per chain, briefly cached - used to bound partitioned reads
const headCache: {[chainId: number]: {block: number, at: number}} = {};
async function subgraphHeadBlock(chainId: number): Promise<number> {
    const cached = headCache[chainId];
    if (cached && Date.now() - cached.at < 30000) return cached.block;
    const data = await postQuery(getSubgraphEndpoint(chainId), '{ _meta { block { number } } }');
    const block = Number(data._meta.block.number);
    headCache[chainId] = { block, at: Date.now() };
    return block;
}

// Cursor-paginates one block range of a stream by id (skip-based paging caps at 5000
// rows on The Graph). Row order within/across ranges is arbitrary - callers sort.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readStreamRange(endpoint: string, spec: EventSpec, addressField: string | undefined, address: string | undefined, fromBlock: number, toBlock: number): Promise<any[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: any[] = [];
    let lastId = '';
    for (;;) {
        const where: string[] = [`blockNumber_gte: ${fromBlock}`, `blockNumber_lte: ${toBlock}`];
        if (address !== undefined) {
            if (!addressField) throw new Error(`event ${spec.name} has no indexed address field to filter on`);
            where.push(`${addressField}: "${address.toLowerCase()}"`);
        }
        if (lastId) where.push(`id_gt: "${lastId}"`);
        const query = `{ ${spec.plural}(first: ${PAGE_SIZE}, orderBy: id, orderDirection: asc, where: {${where.join(', ')}}) { id ${spec.fields.join(' ')} blockNumber blockTimestamp transactionHash logIndex txIndex } }`;
        const data = await postQuery(endpoint, query);
        const rows = data[spec.plural];
        for (const row of rows) out.push(row);
        if (rows.length < PAGE_SIZE) break;
        lastId = rows[rows.length - 1].id;
    }
    return out;
}

// Reads one event stream. The block range is split into partitions paginated in
// parallel - big streams (Polygon StakingRewardsAllocated: 150k+ rows) would otherwise
// pay one sequential round-trip per 1000 rows.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readSubgraphStream(chainId: number, spec: EventSpec, q: StreamQuery): Promise<any[]> {
    const endpoint = getSubgraphEndpoint(chainId);
    const addressField = q.addressFieldOverride || spec.addressField;
    const toBlock = q.toBlock !== undefined ? q.toBlock : await subgraphHeadBlock(chainId);
    if (toBlock < q.fromBlock) return [];
    const partitions = Math.min(
        q.address !== undefined ? FILTERED_STREAM_PARTITIONS : GLOBAL_STREAM_PARTITIONS,
        Math.max(1, Math.ceil((toBlock - q.fromBlock + 1) / 100000))
    );
    const step = Math.ceil((toBlock - q.fromBlock + 1) / partitions);
    const ranges: {from: number, to: number}[] = [];
    for (let b = q.fromBlock; b <= toBlock; b += step) {
        ranges.push({ from: b, to: Math.min(b + step - 1, toBlock) });
    }
    const results = await Promise.all(ranges.map(r => readStreamRange(endpoint, spec, addressField, q.address, r.from, r.to)));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: any[] = [];
    for (const rows of results) {
        for (const row of rows) out.push(row);
    }
    return out;
}

// Shapes a subgraph row like a web3 getPastEvents result, so aggregations are unchanged.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToEvent(row: any, spec: EventSpec, contractAddress: string): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const returnValues: any = {};
    for (const f of spec.fields) returnValues[f] = row[f];
    return {
        address: contractAddress,
        event: spec.name,
        signature: spec.topic,
        blockNumber: Number(row.blockNumber),
        blockTimestamp: Number(row.blockTimestamp),
        transactionIndex: Number(row.txIndex),
        logIndex: Number(row.logIndex),
        transactionHash: row.transactionHash,
        returnValues
    };
}

// Current head block of the subgraph index (for freshness checks / bounded queries).
export async function getSubgraphHeadBlock(chainId: number): Promise<number> {
    const data = await postQuery(getSubgraphEndpoint(chainId), '{ _meta { block { number } } }');
    return Number(data._meta.block.number);
}
