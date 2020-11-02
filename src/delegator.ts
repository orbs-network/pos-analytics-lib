/**
 * Copyright 2020 the pos-analytics authors
 * This file is part of the pos-analytics library in the Orbs project.
 *
 * This source code is licensed under the MIT license found in the LICENSE file in the root directory of this source tree.
 * The above notice should be included in all copies or substantial portions of the software.
 */

import _ from 'lodash';
import BigNumber from "bignumber.js";
import { bigToNumber, getCurrentClockTime } from './helpers';
import { addressToTopic, ascendingEvents, BlockInfo, Contracts, generateTxLink, getBlockEstimatedTime, getCurrentBlockInfo, getWeb3, readBalanceOf, readContractEvents, readDelegatorRewards, Topics } from "./eth-helpers";
import { Delegator, DelegatorAction, DelegatorReward, DelegatorStake } from "./model";

export async function getDelegator(address: string, etherumEndpoint: string): Promise<Delegator> {
    const web3 = getWeb3(etherumEndpoint);  
    const actions: DelegatorAction[] = [];

    // fix block for all "state" data.
    const block = await getCurrentBlockInfo(web3);

    const { stakeActions, stakes, totalStake, coolDownStake } = await getStakeActions(address, web3, block);
    actions.push(...stakeActions);

    const { delegateActions, delegation } = await getDelegateActions(address, web3);
    actions.push(...delegateActions);

    const { rewardStatus, rewards, claimActions } = await getDelegatorRewards(address, web3, block);
    actions.push(...claimActions);

    const erc20Balance = await readBalanceOf(address, block.number, web3);

    actions.sort((n1:any, n2:any) => n2.block_number - n1.block_number); // desc unlikely delegator actions in same block

    return {
        address: address.toLowerCase(),
        total_stake: bigToNumber(totalStake),
        cool_down_stake: bigToNumber(coolDownStake),
        non_stake: bigToNumber(erc20Balance),
        delegated_to: String(delegation).toLowerCase(),
        rewards_status: rewardStatus,
        stake_slices: stakes,
        actions, 
        reward_slices: rewards
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getStakeActions(address:string, web3:any, block?: BlockInfo) {
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
            amount: bigToNumber(amount),
            current_stake: bigToNumber(totalStake),
            additional_info_link: generateTxLink(event.transactionHash),
        });
        stakes.push({
            block_number: event.blockNumber,
            block_time: blockTime,
            stake: bigToNumber(totalStake),
            cooldown: bigToNumber(coolDownStake),
        });
    }

    // if last stake event is more than a day ago, generate an extra (copy really) with current block/time
    if ((stakes[stakes.length-1].block_time + 86400) < getCurrentClockTime()) { 
        if (!_.isObject(block)) {
            block = await getCurrentBlockInfo(web3);
        }
        stakes.push({
            block_number: block.number,
            block_time: block.time,
            stake: bigToNumber(totalStake),
            cooldown: bigToNumber(coolDownStake),
        })
    }

    stakes.sort((n1:any, n2:any) => n2.block_number - n1.block_number);  // desc

    return { stakeActions, stakes, totalStake, coolDownStake };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getDelegateActions(address:string, web3:any) {
    const filter = [Topics.Delegated, addressToTopic(address)];
    const events = await readContractEvents(filter, Contracts.Delegate, web3);
    
    const delegateActions: DelegatorAction[] = [];
    events.sort(ascendingEvents); 
    
    for (let event of events) {
        delegateActions.push({
            contract: event.address.toLowerCase(),
            event: event.event,
            block_time: getBlockEstimatedTime(event.blockNumber),
            block_number: event.blockNumber,
            tx_hash: event.transactionHash,
            to: String(event.returnValues.to).toLowerCase(),
            additional_info_link: generateTxLink(event.transactionHash),
        });
    }

    const delegation = events.length > 0 ? String(events[events.length-1].returnValues.to).toLowerCase(): '';

    return { delegateActions, delegation };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getDelegatorRewards(address: string, web3:any, block?: BlockInfo) {
    const rewards: DelegatorReward[] = [];
    const claimActions: DelegatorAction[] = [];

    const filter = [undefined /*don't filter event type*/, addressToTopic(address)];
    //const filter = [Topics.DelegatorRewardAssigned, addressToTopic(address)];
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
        } else {
            console.log(JSON.stringify(event, null, 2))// TODO remove
        }
    }

    if (!_.isObject(block)) {
        block = await getCurrentBlockInfo(web3);
    }
    const { balance, claimed } = await readDelegatorRewards(address, block.number, web3);

    const rewardStatus = {
        block_number: block.number,
        block_time: block.time,
        rewards_balance: bigToNumber(balance),
        rewards_claimed: bigToNumber(claimed),
        total_rewards: bigToNumber(balance.plus(claimed)),
    }

    return {rewardStatus, rewards, claimActions};
}
