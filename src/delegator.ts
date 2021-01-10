/**
 * Copyright 2020 the pos-analytics authors
 * This file is part of the pos-analytics library in the Orbs project.
 *
 * This source code is licensed under the MIT license found in the LICENSE file in the root directory of this source tree.
 * The above notice should be included in all copies or substantial portions of the software.
 */

import _ from 'lodash';
import BigNumber from "bignumber.js";
import { bigToNumber, parseOptions } from './helpers';
import { addressToTopic, ascendingEvents, BlockInfo, Contracts, generateTxLink, getBlockEstimatedTime, getStartOfPoSBlock, getWeb3, readContractEvents, readDelegatorDataFromState, Topics } from "./eth-helpers";
import { Delegator, DelegatorAction, DelegatorReward, DelegatorStake, PosOptions } from "./model";
import { getDelegatorRewardsStakingInternal, getRewardsClaimActions } from './rewards';

export async function getDelegator(address: string, etherumEndpoint: string, o?: PosOptions | any): Promise<Delegator> {
    const options = parseOptions(o);
    const web3 = await getWeb3(etherumEndpoint);  
    const actions: DelegatorAction[] = [];

    let ethData: any;
    let txs: Promise<any>[];
    if (options.read_rewards) {
        ethData = await readDelegatorDataFromState(address, web3);
        txs = [
            getStakeActions(address, web3),
            getDelegateActions(address, web3),
            getDelegatorRewardsStakingInternal(address, ethData, web3, options),
        ];
    } else {
        txs = [
            getStakeActions(address, web3),
            getDelegateActions(address, web3),
            getRewardsClaimActions(address, web3, false),
            readDelegatorDataFromState(address, web3)
        ];
    }

    const res = await Promise.all(txs);
    const stakes = res[0].stakes;
    actions.push(...res[0].stakeActions);
    actions.push(...res[1].delegateActions);
    actions.push(...res[2].claimActions);
    let rewards: DelegatorReward[] = [];
    if (options.read_rewards) {
        rewards = res[2].rewards;
    } else {
        ethData = res[3];
    }

    actions.sort((n1:any, n2:any) => n2.block_number - n1.block_number); // desc unlikely delegator actions in same block
    rewards.sort((n1:any, n2:any) => n2.block_number - n1.block_number); // desc unlikely delegator rewards in same block

    injectFirstLastStakes(stakes, ethData, ethData.block);

    return {
        address: address.toLowerCase(),
        block_number: ethData.block.number,
        block_time: ethData.block.time,
        total_stake: bigToNumber(ethData.staked),
        cooldown_stake: bigToNumber(ethData.cooldown_stake),
        current_cooldown_time: ethData.current_cooldown_time,
        non_stake: bigToNumber(ethData.non_stake),
        delegated_to: ethData.guardian,
        rewards_balance: bigToNumber(ethData.self_reward_balance),
        rewards_claimed: bigToNumber(ethData.self_reward_claimed),
        total_rewards: bigToNumber(ethData.self_total_rewards),
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
