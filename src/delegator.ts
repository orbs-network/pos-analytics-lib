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
import { addressToTopic, ascendingEvents, Contracts, getBlockEstimatedTime, getWeb3, readBalanceOf, readContractEvents, Topics } from "./eth-helpers";
import { Delegator, DelegatorAction, DelegatorReward, DelegatorStake } from "./model";

export async function getDelegator(address: string, etherumEndpoint: string): Promise<Delegator> {
    const web3 = getWeb3(etherumEndpoint);  
    const actions: DelegatorAction[] = [];

    const { stakeActions, stakes, totalStake, coolDownStake } = await getStakeActions(address, web3);
    actions.push(...stakeActions);

    const { delegateActions, delegation } = await getDelegateActions(address, web3);
    actions.push(...delegateActions);

    const rewards: DelegatorReward[] = [];
    const claims: number[] = [];

    const erc20Balance = await readBalanceOf(address, web3);

    actions.sort((n1:any, n2:any) => n2.block_number - n1.block_number); // desc

    return {
        address: address.toLowerCase(),
        total_stake: bigToNumber(totalStake),
        cool_down_stake: bigToNumber(coolDownStake),
        non_stake: bigToNumber(erc20Balance),
        delegated_to: String(delegation).toLowerCase(),
        stake_slices: stakes,
        reward_slices: rewards,
        claim_times: claims,
        actions
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getStakeActions(address:string, web3:any) {
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
            contract: event.address,
            event: event.event,
            block_number: event.blockNumber,
            block_time: blockTime,
            tx_hash: event.transactionHash,
            amount: bigToNumber(amount),
        });
        stakes.push({
            block_number: event.blockNumber,
            block_time: blockTime,
            stake: bigToNumber(totalStake),
            cooldown: bigToNumber(coolDownStake),
        });
    }
    stakes.sort((n1:any, n2:any) => n2.block_number - n1.block_number);  // desc

    return { stakeActions, stakes, totalStake, coolDownStake };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getDelegateActions(address:string, web3:any) {
    const filter = [Topics.Delegated, addressToTopic(address)];
    const events = await readContractEvents(filter, Contracts.Delegate, web3);
    
    const delegateActions: DelegatorAction[] = [];
    events.sort(ascendingEvents); 
    
    for (let event of events) {
        const blockTime = getBlockEstimatedTime(event.blockNumber)
        delegateActions.push({
            contract: event.address,
            event: event.event,
            block_time: blockTime,
            block_number: event.blockNumber,
            tx_hash: event.transactionHash,
            to: String(event.returnValues.to).toLowerCase(),
        });
    }

    const delegation = events.length > 0 ? String(events[events.length-1].returnValues.to).toLowerCase(): '';

    return { delegateActions, delegation };
}
