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
    total_weight: number;
    total_effective_stake: number;
    data: PosOverviewData[];
} 

export interface PosOverviewData {
    name: string;
    address: string;
    effective_stake: number;
    weight: number;
}

export interface Action {
    contract: string;
    event: string;
    block_number: number;
    block_time: number;
    tx_hash: string;
    additional_info_link: string;
    amount?: number;
    current_stake?: number;
    to?: string;
}

export interface Guardian {
    name: string;
    address: string;
    website: string;
    effective_stake: number;
    ip: string;
}

export interface GuardianInfo {
    address: string;
    block_number: number;
    block_time: number;
    details: GuardianDetails;
    stake_status: GuardianStakeStatus;
    reward_status: GuardianRewardStatus;
    stake_slices: GuardianStake[];
    actions: Action[];
    reward_as_guardian_slices: GuardianReward[];
    reward_as_delegator_slices: GuardianReward[];
    fees_slices: GuardianReward[];
    bootstrap_slices: GuardianReward[];
    delegators: GuardianDelegator[];
    delegators_left: GuardianDelegator[];
}

export interface GuardianDetails {
    name: string;
    website: string;
    ip: string;
    node_address: string;
    details_URL: string;
    registration_time: number;
    last_update_time: number;
}

export interface GuardianStakeStatus {
    self_stake: number;
    cooldown_stake: number;
    current_cooldown_time: number;
    non_stake: number;
    delegated_stake: number;
    total_stake: number;
}

export interface GuardianRewardStatus {
    guardian_rewards_balance: number;
    guardian_rewards_claimed: number;
    total_guardian_rewards: number;
    delegator_rewards_balance: number;
    delegator_rewards_claimed: number;
    total_delegator_rewards: number;
    fees_balance: number;
    fees_claimed: number;
    total_fees: number;
    bootstrap_balance: number;
    bootstrap_claimed: number;
    total_bootstrap: number;
    delegator_reward_share: number;
}

export interface GuardianStake {
    block_number: number;
    block_time: number;
    self_stake: number;
    delegated_stake: number; // note unlike the contract this is only 
    total_stake: number;
    n_delegates: number;
}

export interface GuardianAction extends Action {}

export interface GuardianReward {
    block_number: number;
    block_time: number;
    tx_hash: string;
    additional_info_link: string;
    total_awarded: number;
}

export interface GuardianDelegator {
    last_change_block: number;
    last_change_time: number;
    address: string;
    stake: number;
    non_stake: number;
}

export interface Delegator {
    address: string;
    block_number: number;
    block_time: number;
    total_stake: number;
    cooldown_stake: number;
    current_cooldown_time: number;
    non_stake: number;
    delegated_to: string;
    rewards_balance: number;
    rewards_claimed: number;
    total_rewards: number;
    stake_slices: DelegatorStake[];
    actions: Action[];
    reward_slices: DelegatorReward[];
}

export interface DelegatorStake {
    block_number: number;
    block_time: number;
    stake: number;
    cooldown: number;
}

export interface DelegatorAction extends Action {}

export interface DelegatorReward {
    block_number: number;
    block_time: number;
    tx_hash: string;
    additional_info_link: string;
    total_awarded: number;
    guardian_from: string;
}