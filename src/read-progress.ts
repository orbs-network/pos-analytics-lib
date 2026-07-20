/**
 * Copyright 2020 the pos-analytics authors
 * This file is part of the pos-analytics library in the Orbs project.
 *
 * This source code is licensed under the MIT license found in the LICENSE file in the root directory of this source tree.
 * The above notice should be included in all copies or substantial portions of the software.
 */

// Progress accounting for chunked event scans, for UI progress bars.
// Scans register the block range they are about to fetch; every completed chunk reports
// the blocks it covered. When a new batch of scans starts after everything finished,
// the counters reset so a fresh page load starts from 0%.

export interface ReadProgress {
    plannedBlocks: number;
    doneBlocks: number;
    activeScans: number;
}

const progressByChain: {[chainId: number]: ReadProgress} = {};

function chainProgress(chainId: number): ReadProgress {
    if (!progressByChain[chainId]) {
        progressByChain[chainId] = { plannedBlocks: 0, doneBlocks: 0, activeScans: 0 };
    }
    return progressByChain[chainId];
}

export function progressScanStart(chainId: number, blocks: number) {
    const p = chainProgress(chainId);
    if (p.activeScans === 0 && p.doneBlocks >= p.plannedBlocks) {
        p.plannedBlocks = 0;
        p.doneBlocks = 0;
    }
    p.activeScans += 1;
    p.plannedBlocks += Math.max(blocks, 0);
}

export function progressChunkDone(chainId: number, blocks: number) {
    chainProgress(chainId).doneBlocks += Math.max(blocks, 0);
}

export function progressScanEnd(chainId: number) {
    const p = chainProgress(chainId);
    p.activeScans = Math.max(p.activeScans - 1, 0);
    if (p.activeScans === 0) {
        p.doneBlocks = p.plannedBlocks; // a scan can finish early (full-range succeeded)
    }
}

export function getReadProgress(chainId: number): ReadProgress {
    return { ...chainProgress(chainId) };
}
