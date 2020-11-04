/**
 * Copyright 2020 the pos-analytics authors
 * This file is part of the pos-analytics library in the Orbs project.
 *
 * This source code is licensed under the MIT license found in the LICENSE file in the root directory of this source tree.
 * The above notice should be included in all copies or substantial portions of the software.
 */

import _ from 'lodash';
import BigNumber from "bignumber.js";
import { bigToNumber } from './helpers';
import { addressToTopic, ascendingEvents, BlockInfo, Contracts, generateTxLink, getBlockEstimatedTime, getCurrentBlockInfo, getStartOfPoSBlock, getStartOfRewardsBlock, getWeb3, readContractEvents, readDelegatorDataFromState, Topics } from "./eth-helpers";
import { Delegator, DelegatorAction, DelegatorReward, DelegatorStake } from "./model";

export async function getDelegator(address: string, etherumEndpoint: string): Promise<Delegator> {
    const web3 = getWeb3(etherumEndpoint);  
    const actions: DelegatorAction[] = [];

    // fix block for all "state" data.
    const block = await getCurrentBlockInfo(web3);

    const ethData = await readDelegatorDataFromState(address, block.number, web3)

    const { stakes, stakeActions } = await getStakeActions(address, web3);
    actions.push(...stakeActions);
    injectFirstLastStakes(stakes, ethData, block);

    const { delegateActions } = await getDelegateActions(address, web3);
    actions.push(...delegateActions);

    const { rewards, claimActions } = await getDelegatorRewards(address, web3);
    actions.push(...claimActions);
    injectFirstLastRewards(rewards, ethData, block);

    actions.sort((n1:any, n2:any) => n2.block_number - n1.block_number); // desc unlikely delegator actions in same block

    return {
        address: address.toLowerCase(),
        block_number: block.number,
        block_time: block.time,
        total_stake: ethData.staked,
        cooldown_stake: ethData.cooldown_stake,
        current_cooldown_time: ethData.current_cooldown_time,
        non_stake: ethData.non_stake,
        delegated_to: ethData.guardian,
        rewards_balance: bigToNumber(ethData.reward_balance),
        rewards_claimed: bigToNumber(ethData.reward_claimed),
        total_rewards: bigToNumber(ethData.reward_balance.plus(ethData.reward_claimed)),
        stake_slices: stakes,
        actions, 
        reward_slices: rewards
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getStakeActions(address:string, web3:any) {
    const filter = [undefined /*don't filter event type*/, addressToTopic(address)];
    const events = await readContractEvents(filter, Contracts.Stake, web3);
    
    let totalStake = new BigNumber(0);
    let coolDownStake = new BigNumber(0);
    const stakeActions: DelegatorAction[] = [];
    const stakes: DelegatorStake[] = [];
    events.sort(ascendingEvents); 
    
    for (let event of events) {
        const amount = new BigNumber(event.returnValues.amount);
        switch (event.signature) { // same as topics[0] same as event type
            case Topics.Staked:
                totalStake = totalStake.plus(amount);
                break;
            case Topics.Restaked:
                totalStake = totalStake.plus(amount)
                coolDownStake = coolDownStake.minus(amount)
                break;
            case Topics.Unstaked:
                totalStake = totalStake.minus(amount)
                coolDownStake = coolDownStake.plus(amount)
                break;
            case Topics.Withdrew:
                coolDownStake = coolDownStake.minus(amount)
                break;
            default:
                continue;
        }
        const blockTime = getBlockEstimatedTime(event.blockNumber)
        stakeActions.push({
            contract: event.address.toLowerCase(),
            event: event.event,
            block_number: event.blockNumber,
            block_time: blockTime,
            tx_hash: event.transactionHash,
            additional_info_link: generateTxLink(event.transactionHash),
            amount: bigToNumber(amount),
            current_stake: bigToNumber(totalStake),
        });
        stakes.push({
            block_number: event.blockNumber,
            block_time: blockTime,
            stake: bigToNumber(totalStake),
            cooldown: bigToNumber(coolDownStake),
        });
    }

    stakes.sort((n1:any, n2:any) => n2.block_number - n1.block_number);  // desc

    return { stakes, stakeActions, totalStake, coolDownStake };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function injectFirstLastStakes(stakes: DelegatorStake[], ethData:any, block:BlockInfo) {
    stakes.unshift({ 
        block_number: block.number,
        block_time: block.time,
        stake: ethData.staked,
        cooldown: ethData.cooldown_stake,
    });
    const startOfPoS = getStartOfPoSBlock();
    stakes.push({ 
        block_number: startOfPoS.number,
        block_time: startOfPoS.time,
        stake: 0,
        cooldown: 0,
    });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getDelegateActions(address:string, web3:any) {
    const filter = [Topics.Delegated, addressToTopic(address)];
    const events = await readContractEvents(filter, Contracts.Delegate, web3);

    const delegateActions: DelegatorAction[] = [];
    
    for (let event of events) {
        delegateActions.push({
            contract: event.address.toLowerCase(),
            event: event.event,
            block_time: getBlockEstimatedTime(event.blockNumber),
            block_number: event.blockNumber,
            tx_hash: event.transactionHash,
            additional_info_link: generateTxLink(event.transactionHash),
            to: String(event.returnValues.to).toLowerCase(),
        });
    }

    return { delegateActions };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getDelegatorRewards(address: string, web3:any) {
    const rewards: DelegatorReward[] = [];
    const claimActions: DelegatorAction[] = [];

    const filter = [[Topics.DelegatorRewardAssigned, Topics.StakingRewardsClaimed], addressToTopic(address)];
    const events = await readContractEvents(filter, Contracts.Reward, web3);
    events.sort((n1:any, n2:any) => n2.block_number - n1.block_number);  // desc

    for (let event of events) {
        if (event.signature ===  Topics.DelegatorRewardAssigned) {
            rewards.push({
                block_number: event.blockNumber,
                block_time: getBlockEstimatedTime(event.blockNumber),
                tx_hash: event.transactionHash,
                additional_info_link: generateTxLink(event.transactionHash),
                amount: bigToNumber(new BigNumber(event.returnValues.amount)),
                total_awarded: bigToNumber(new BigNumber(event.returnValues.totalAwarded)), 
                guardian_from: String(event.returnValues.guardian).toLowerCase(),
            });
        } else if (event.signature ===  Topics.StakingRewardsClaimed) {
            claimActions.push({
                contract: event.address.toLowerCase(),
                event: event.event,
                block_number: event.blockNumber,
                block_time: getBlockEstimatedTime(event.blockNumber),
                tx_hash: event.transactionHash,
                additional_info_link: generateTxLink(event.transactionHash),
                amount: bigToNumber(new BigNumber(event.returnValues.claimedDelegatorRewards)),
            });
        }
    }

    return { rewards, claimActions };
}

function injectFirstLastRewards(rewards: DelegatorReward[], ethData:any, block: BlockInfo) {
    rewards.unshift({
        block_number: block.number,
        block_time: block.time,
        tx_hash: '',
        additional_info_link: '',
        amount: bigToNumber(ethData.reward_balance),
        total_awarded: bigToNumber(ethData.reward_balance.plus(ethData.reward_claimed)), 
        guardian_from: ethData.guardian,
    });
    const startBlock = getStartOfRewardsBlock()
    rewards.push({
        block_number: startBlock.number,
        block_time: startBlock.time,
        tx_hash: '',
        additional_info_link: '',
        amount: 0,
        total_awarded: 0, 
        guardian_from: '', // this is way before rewards so doesn't really matter.
    });
}
