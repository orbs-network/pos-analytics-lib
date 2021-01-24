/**
 * Copyright 2020 the pos-analytics authors
 * This file is part of the pos-analytics library in the Orbs project.
 *
 * This source code is licensed under the MIT license found in the LICENSE file in the root directory of this source tree.
 * The above notice should be included in all copies or substantial portions of the software.
 */

import _ from 'lodash';
import BigNumber from "bignumber.js";
import { bigToNumber, optionsStartFromText, parseOptions } from './helpers';
import { addressToTopic, ascendingEvents, Contracts, generateTxLink, getBlockEstimatedTime, getQueryDelegationBlock, getQueryPosBlock, getStartOfPosBlock, getWeb3, readContractEvents, readDelegatorDataFromState, Topics } from "./eth-helpers";
import { DelegatorInfo, DelegatorAction, DelegatorReward, DelegatorStake, PosOptions } from "./model";
import { getDelegatorRewardsStakingInternal, getRewardsClaimActions } from './rewards';

export async function getDelegator(address: string, ethereumEndpoint: string | any, o?: PosOptions | any): Promise<DelegatorInfo> {
    const options = parseOptions(o);
    const web3 = _.isString(ethereumEndpoint) ? await getWeb3(ethereumEndpoint) : ethereumEndpoint;  
    const actions: DelegatorAction[] = [];
    let stakes: DelegatorStake[] = [];
    let rewards: DelegatorReward[] = [];

    let ethData = await readDelegatorDataFromState(address, web3);
    if (options.read_history) {
        const txs: Promise<any>[] = [
            getStakeActions(address, ethData, web3, options).then(res => {
                stakes = res.stakes;
                actions.push(...res.stakeActions);
            }),
            getDelegateActions(address, ethData, web3, options).then(res => {actions.push(...res.delegateActions)}),
        ];
        if(options.read_rewards_disable) {
            txs.push(getRewardsClaimActions(address, ethData, web3, options, false).then(res => actions.push(...res.claimActions)));
        } else {
            txs.push(getDelegatorRewardsStakingInternal(address, ethData, web3, options).then(res =>{
                actions.push(...res.claimActions);
                rewards = res.rewards;
            }));
        }
        await Promise.all(txs);
    }

    actions.sort((n1:any, n2:any) => n2.block_number - n1.block_number); // desc unlikely delegator actions in same block

    return {
        address: address.toLowerCase(),
        block_number: ethData.block.number,
        block_time: ethData.block.time,
        read_from_block: optionsStartFromText(options, ethData.block.number),
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
async function getStakeActions(address:string, ethState:any, web3:any, options: PosOptions) {
    let startBlock = getQueryPosBlock(options.read_from_block, ethState.block.number);
    const filter = [undefined /*don't filter event type*/, addressToTopic(address)];
    const events = await readContractEvents(filter, Contracts.Stake, web3, startBlock);
    
    let totalStake = new BigNumber(0);
    let coolDownStake = new BigNumber(0);
    const stakeActions: DelegatorAction[] = [];
    const stakes: DelegatorStake[] = [generateStakeAction(ethState.block.number, ethState.block.time, bigToNumber(ethState.staked), bigToNumber(ethState.cooldown_stake))];
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
        stakes.push(generateStakeAction(event.blockNumber, blockTime, bigToNumber(totalStake), bigToNumber(coolDownStake)));
    }

    if (startBlock <= getStartOfPosBlock().number) {
        // fake 'start' of events
        stakes.push(generateStakeAction(getStartOfPosBlock().number, getStartOfPosBlock().time, 0, 0));
    }

    stakes.sort((n1:any, n2:any) => n2.block_number - n1.block_number);  // desc

    return { stakes, stakeActions };
}

function generateStakeAction(block_number: number, block_time: number, stake: number, cooldown: number) : DelegatorStake {
    return { block_number, block_time, stake, cooldown }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getDelegateActions(address:string, ethState:any, web3:any, options: PosOptions) {
    let startBlock = getQueryDelegationBlock(options.read_from_block, ethState.block.number);
    const filter = [Topics.Delegated, addressToTopic(address)];
    const events = await readContractEvents(filter, Contracts.Delegate, web3, startBlock);

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
