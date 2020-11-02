/**
 * Copyright 2020 the pos-analytics authors
 * This file is part of the pos-analytics library in the Orbs project.
 *
 * This source code is licensed under the MIT license found in the LICENSE file in the root directory of this source tree.
 * The above notice should be included in all copies or substantial portions of the software.
 */

import _ from 'lodash';
import BigNumber from 'bignumber.js';
import { fetchJson, bigToNumber, getCurrentClockTime } from './helpers';
import { getWeb3, Contracts, getBlockEstimatedTime, readContractEvents, addressToTopic, Topics, ascendingEvents, readBalances, generateTxLink, getCurrentBlockInfo, BlockInfo, readGuardianRewards, readGuardianFeeAndBootstrapRewards } from "./eth-helpers";
import { Guardian, GuardianInfo, GuardianDelegator, GuardianReward, GuardianStake, GuardianAction } from './model';

export async function getGuardians(networkNodeUrls: string[]): Promise<Guardian[]> {
    let fullError = ''; 
    for(const url of networkNodeUrls) {
        try {
            const rawData = await fetchJson(url);
            return _.map(rawData.Payload.Guardians, (guardian) => {
                return {
                    name: guardian.Name,
                    address: '0x' + String(guardian.EthAddress).toLowerCase(),
                    website: guardian.Website, 
                    effective_stake: Number(guardian?.EffectiveStake || 0)
                }
            });
        } catch (e) {
            fullError += `Warning: access to URL ${url} failed, trying another. Error: ${e}\n`;
        }
    }

    throw new Error(`Error while creating list of Guardians, all Netowrk Node URL failed to respond. ${fullError}`);
}

export async function getGuardian(address: string, ethereumEndpoint: string): Promise<GuardianInfo> {
    const web3 = getWeb3(ethereumEndpoint);

    // fix block for all "state" data.
    const block = await getCurrentBlockInfo(web3);

    const actions: GuardianAction[] = [];

    const { stakes, stakeActions, delegatorMap } = await getStakeChanges(address, web3, block);
    actions.push(...stakeActions);

    const rewardStatus = await getGuardianRewardStatus(address, web3, block);

    const { rewards, claimActions } = await getGuardianRewards(address, web3);
    actions.push(...claimActions);

    const { bootstraps, fees, withdrawActions } = await getGuardianFeeAndBootstrap(address, web3);
    actions.push(...withdrawActions);

    actions.sort((n1:any, n2:any) => n2.block_number - n1.block_number); // desc unlikely guardian actions in same block
    return {
        address: address.toLowerCase(),
        reward_status: rewardStatus,
        stake_slices: stakes,
        actions,
        reward_slices: rewards,
        bootstrap_slices: bootstraps, 
        fees_slices: fees,
        delegators: _.map(_.pickBy(delegatorMap, (d) => {return d.stake !== 0}), v => v).sort((n1:any, n2:any) => n2.stake - n1.stake),
        delegators_left: _.map(_.pickBy(delegatorMap, (d) => {return d.stake === 0}), v => v),
    };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getStakeChanges(address: string, web3:any, block?: BlockInfo) {
    //const filter = [Topics.DelegateStakeChanged, addressToTopic(address)];
    const filter = [undefined /*don't filter event type*/, addressToTopic(address)];
    const events = await readContractEvents(filter, Contracts.Delegate, web3);

    const delegatorMap: {[key:string]: GuardianDelegator} = {};
    const stakes: GuardianStake[] = [];
    const stakeActions: GuardianAction[] = [];
    events.sort(ascendingEvents); 
    
    for (let event of events) {
        switch (event.signature) { // same as topics[0] same as event type
            case Topics.Staked:
            case Topics.Restaked:
            case Topics.Unstaked:
            case Topics.Withdrew:
                stakeActions.push({
                    contract: event.address.toLowerCase(),
                    event: event.event,
                    block_number: event.blockNumber,
                    block_time: getBlockEstimatedTime(event.blockNumber),
                    tx_hash: event.transactionHash,
                    additional_info_link: generateTxLink(event.transactionHash),
                    amount: bigToNumber(new BigNumber(event.returnValues.amount)),
                });
                break;
            case Topics.DelegateStakeChanged:
                const delegatorAddress = event.returnValues.delegator.toLowerCase();
                if (delegatorAddress !== address) {
                    const d = {
                        last_change_block: event.blockNumber,
                        last_change_time: 0,
                        address: delegatorAddress,
                        stake: bigToNumber(new BigNumber(event.returnValues.delegatorContributedStake)),
                        non_stake: 0,
                    }
                    delegatorMap[delegatorAddress] = d;
                }
                const selfDelegate = new BigNumber(event.returnValues.selfDelegatedStake);
                const allStake = new BigNumber(event.returnValues.delegatedStake);
                    
                addOrUpdateStakeList(stakes, event.blockNumber, bigToNumber(selfDelegate), bigToNumber(allStake.minus(selfDelegate)), _.size(delegatorMap));
                break;
            default:
                continue;
        }
    }

    // if last stake event is more than a day ago, create a extra event copy with current block/time
    const lastStake = stakes[stakes.length-1]
    if ((lastStake.block_time + 86400) < getCurrentClockTime()) {
        if (!_.isObject(block)) {
            block = await getCurrentBlockInfo(web3);
        }
        stakes.push({
            block_number: block.number,
            block_time: block.time,
            self_stake: lastStake.self_stake,
            delegated_stake: lastStake.delegated_stake,
            n_delegates: lastStake.n_delegates,
        })
    }

    stakes.sort((n1:any, n2:any) => n2.block_number - n1.block_number); // desc
    
    const balanceMap = await readBalances(_.keys(delegatorMap), web3);
    _.forOwn(delegatorMap, (v) => {
        v.last_change_time = getBlockEstimatedTime(v.last_change_block);
        v.non_stake = balanceMap[v.address];
    });

    return { stakes, stakeActions, delegatorMap };
}

function addOrUpdateStakeList(stakes: GuardianStake[], blockNumber: number, selfStake: number, delegateStake: number, nDelegators: number) {
    if (stakes.length > 0 && stakes[stakes.length-1].block_number == blockNumber) {
        const curr = stakes[stakes.length-1];
        curr.self_stake = selfStake;
        curr.delegated_stake = delegateStake;
        curr.n_delegates = nDelegators;
    } else {
        stakes.push({
            block_number: blockNumber,
            block_time: getBlockEstimatedTime(blockNumber),
            self_stake: selfStake,
            delegated_stake: delegateStake,
            n_delegates: nDelegators,
        });
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getGuardianRewardStatus(address: string, web3:any, block?: BlockInfo) {
    if (!_.isObject(block)) {
        block = await getCurrentBlockInfo(web3);
    }
    const { balance, claimed, delegatorShare } = await readGuardianRewards(address, block.number, web3);
    
    const { feeBalance, withdrawnFees, bootstrapBalance, withdrawnBootstrap } 
       = await readGuardianFeeAndBootstrapRewards(address, block.number, web3);
    
    const rewardStatus = {
        block_number: block.number,
        block_time: block.time,
        rewards_balance: bigToNumber(balance), 
        rewards_claimed: bigToNumber(claimed),
        total_rewards: bigToNumber(balance.plus(claimed)),
        fees_balance: bigToNumber(feeBalance), 
        fees_claimed: bigToNumber(withdrawnFees),
        total_fees: bigToNumber(feeBalance.plus(withdrawnFees)),
        bootstrap_balance: bigToNumber(bootstrapBalance), 
        bootstrap_claimed: bigToNumber(withdrawnBootstrap),
        total_bootstrap: bigToNumber(bootstrapBalance.plus(withdrawnBootstrap)),
        delegator_reward_share: bigToNumber(delegatorShare)
    }

    return rewardStatus;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getGuardianRewards(address: string, web3:any) {
    const rewards: GuardianReward[] = [];
    const claimActions: GuardianAction[] = [];

    const filter = [undefined /*don't filter event type*/, addressToTopic(address)];
    //const filter = [Topics.DelegatorRewardAssigned, addressToTopic(address)];
    const events = await readContractEvents(filter, Contracts.Reward, web3);
    rewards.sort((n1:any, n2:any) => n2.block_number - n1.block_number);  // desc

    for (let event of events) {
        if (event.signature ===  Topics.GuardianRewardAssigned) {
            rewards.push({
                block_number: event.blockNumber,
                block_time: getBlockEstimatedTime(event.blockNumber),
                tx_hash: event.transactionHash,
                additional_info_link: generateTxLink(event.transactionHash),
                amount: bigToNumber(new BigNumber(event.returnValues.amount)),
                total_awarded: bigToNumber(new BigNumber(event.returnValues.totalAwarded)), 
            });
        } else if (event.signature ===  Topics.StakingRewardsClaimed) {
            claimActions.push({
                contract: event.address.toLowerCase(),
                event: event.event,
                block_number: event.blockNumber,
                block_time: getBlockEstimatedTime(event.blockNumber),
                tx_hash: event.transactionHash,
                additional_info_link: generateTxLink(event.transactionHash),
                amount: bigToNumber(new BigNumber(event.returnValues.claimedGuardianRewards)),
            });
        } else {
            console.log(JSON.stringify(event, null, 2)) // TODO remove
        }
    }

    return { rewards, claimActions };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getGuardianFeeAndBootstrap(address: string, web3:any) {
    const fees: GuardianReward[] = [];
    const bootstraps: GuardianReward[] = [];
    const withdrawActions: GuardianAction[] = [];

    const filter = [undefined /*don't filter event type*/, addressToTopic(address)];
    //const filter = [Topics.DelegatorRewardAssigned, addressToTopic(address)];
    const events = await readContractEvents(filter, Contracts.FeeBootstrapReward, web3);
    events.sort((n1:any, n2:any) => n2.block_number - n1.block_number);  // desc

    for (let event of events) {
        if (event.signature ===  Topics.BootstrapRewardAssigned) {
            bootstraps.push({
                block_number: event.blockNumber,
                block_time: getBlockEstimatedTime(event.blockNumber),
                tx_hash: event.transactionHash,
                additional_info_link: generateTxLink(event.transactionHash),
                amount: bigToNumber(new BigNumber(event.returnValues.amount)),
                total_awarded: bigToNumber(new BigNumber(event.returnValues.totalAwarded)), 
            });
        } else if (event.signature ===  Topics.FeeAssigned) {
            fees.push({
                block_number: event.blockNumber,
                block_time: getBlockEstimatedTime(event.blockNumber),
                tx_hash: event.transactionHash,
                additional_info_link: generateTxLink(event.transactionHash),
                amount: bigToNumber(new BigNumber(event.returnValues.amount)),
                total_awarded: bigToNumber(new BigNumber(event.returnValues.totalAwarded)), 
            });
        } else if (event.signature ===  Topics.BootstrapWithdrawn || event.signature ===  Topics.FeeWithdrawn) {
            withdrawActions.push({
                contract: event.address.toLowerCase(),
                event: event.event,
                block_number: event.blockNumber,
                block_time: getBlockEstimatedTime(event.blockNumber),
                tx_hash: event.transactionHash,
                additional_info_link: generateTxLink(event.transactionHash),
                amount: bigToNumber(new BigNumber(event.returnValues.amount)),
            });
        } else {
            console.log(JSON.stringify(event, null, 2)) // TODO remove
        }
    }

    return { bootstraps, fees, withdrawActions };
}
