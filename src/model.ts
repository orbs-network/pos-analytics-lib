/**
 * Copyright 2020 the pos-analytics authors
 * This file is part of the pos-analytics library in the Orbs project.
 *
 * This source code is licensed under the MIT license found in the LICENSE file in the root directory of this source tree.
 * The above notice should be included in all copies or substantial portions of the software.
 */

export interface PosOverview {
    block_number: number;
    block_time: number;
    total_stake: number;
    n_guardians: number;
    n_committee: number;
    n_candidates: number;
    apy: number;
    slices: PosOverviewSlice[]
}

export interface PosOverviewSlice {
    block_number: number;
    block_time: number;
    data: PosOverviewData[];
} 

export interface PosOverviewData {
    name: string;
    address: string;
    effectiveStake: number;
    weight: number;
}

export interface Guardian {
    name: string;
    address: string;
    website: string;
    effectiveStake: number;
}

export interface GuardianInfo {
    address: string;
    stake_slices: GuardianStake[];
    reward_slices: GuardianReward[];
    claim_times: ClaimTimes;
    delegators: GuardianDelegator[];
    delegators_left: GuardianDelegator[];
}

export interface GuardianStake {
    block_number: number;
    block_time: number;
    self_stake: number;
    delegated_stake: number;
    n_delegates: number;
}

export interface GuardianReward {
    block_number: number;
    block_time: number;
    stake_reward_total: number;
    stake_reward_self: number;
    vc_fee: number;
    dai_reward: number;
}

export interface ClaimTimes {
    [index:number]: number;
}

export interface GuardianDelegator {
    last_change_block: number;
    last_change_time: number;
    address: string;
    stake: number;
}

export interface Delegator {
    address: string;
    total_stake: number;
    cool_down_stake: number;
    non_stake: number;
    delegated_to: string;
    stake_slices: DelegatorStake[];
    reward_slices: DelegatorReward[];
    claim_times: ClaimTimes;
    actions: DelegatorAction[];
}

export interface DelegatorStake {
    block_number: number;
    block_time: number;
    stake: number;
    cooldown: number;
}

export interface DelegatorReward {
    block_number: number;
    block_time: number;
    reward: number;
}

export interface DelegatorAction {
    contract: string;
    event: string;
    block_number: number;
    block_time: number;
    tx_hash: string;
    amount?: number;
    to?: string;
}
