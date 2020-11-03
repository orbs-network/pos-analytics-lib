/**
 * Copyright 2020 the pos-analytics authors
 * This file is part of the pos-analytics library in the Orbs project.
 *
 * This source code is licensed under the MIT license found in the LICENSE file in the root directory of this source tree.
 * The above notice should be included in all copies or substantial portions of the software.
 */

import _ from 'lodash';
import BigNumber from 'bignumber.js';
import { fetchJson, bigToNumber } from './helpers';
import { addressToTopic, ascendingEvents, BlockInfo, Contracts, getBlockEstimatedTime, generateTxLink, getCurrentBlockInfo, getWeb3, readBalances, readContractEvents, readGuardianDataFromState, Topics } from "./eth-helpers";
import { Guardian, GuardianInfo, GuardianDelegator, GuardianReward, GuardianStake, GuardianAction, GuardianRewardStatus, GuardianStakeStatus } from './model';

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
                    effective_stake: Number(guardian?.EffectiveStake || 0),
                    ip: guardian?.Ip || '',
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

    const ethData = await readGuardianDataFromState(address, block.number, web3)

    const actions: GuardianAction[] = [];

    const { stakes, stakeActions, delegatorMap } = await getGuardianStakes(address, web3);
    actions.push(...stakeActions);

    const { rewardsAsGuardian, rewardsAsDelegator, claimActions } = await getGuardianRewards(address, web3);   
    actions.push(...claimActions);

    const { bootstraps, fees, withdrawActions } = await getGuardianFeeAndBootstrap(address, web3);
    actions.push(...withdrawActions);

    // add "now" values to lists
    updateStakeList(stakes, ethData.stake_status, block);
    updateRewardLists(rewardsAsGuardian, rewardsAsDelegator, bootstraps, fees, ethData.reward_status, block); 

    actions.sort((n1:any, n2:any) => n2.block_number - n1.block_number); // desc unlikely guardian actions in same block

    return {
        address: address.toLowerCase(),
        block_number: block.number,
        block_time: block.time,
        details : ethData.details,
        stake_status: ethData.stake_status,
        reward_status: ethData.reward_status,
        actions,
        stake_slices: stakes,
        reward_as_guardian_slices: rewardsAsGuardian,
        reward_as_delegator_slices: rewardsAsDelegator,
        bootstrap_slices: bootstraps, 
        fees_slices: fees,
        delegators: _.map(_.pickBy(delegatorMap, (d) => {return d.stake !== 0}), v => v).sort((n1:any, n2:any) => n2.stake - n1.stake),
        delegators_left: _.map(_.pickBy(delegatorMap, (d) => {return d.stake === 0}), v => v),
    };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getGuardianStakes(address: string, web3:any) {
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
export async function getGuardianRewards(address: string, web3:any) {
    const rewardsAsGuardian: GuardianReward[] = [];
    const rewardsAsDelegator: GuardianReward[] = [];
    const claimActions: GuardianAction[] = [];

    const filter = [undefined /*don't filter event type*/, addressToTopic(address)];
    const events = await readContractEvents(filter, Contracts.Reward, web3);
    events.sort((n1:any, n2:any) => n2.blockNumber - n1.blockNumber);  // desc

    for (let event of events) {
        if (event.signature ===  Topics.GuardianRewardAssigned) {
            const amount = bigToNumber(new BigNumber(event.returnValues.amount));
            if (amount === 0) { // todo explain why
                continue;
            }
            rewardsAsGuardian.push({
                block_number: event.blockNumber,
                block_time: getBlockEstimatedTime(event.blockNumber),
                tx_hash: event.transactionHash,
                additional_info_link: generateTxLink(event.transactionHash),
                amount: amount,
                total_awarded: bigToNumber(new BigNumber(event.returnValues.totalAwarded)), 
            });
        } else if (event.signature ===  Topics.DelegatorRewardAssigned) {
            const amount = bigToNumber(new BigNumber(event.returnValues.amount));
            if (amount === 0) { // todo explain why
                continue;
            }
            rewardsAsDelegator.push({
                block_number: event.blockNumber,
                block_time: getBlockEstimatedTime(event.blockNumber),
                tx_hash: event.transactionHash,
                additional_info_link: generateTxLink(event.transactionHash),
                amount: amount,
                total_awarded: bigToNumber(new BigNumber(event.returnValues.totalAwarded)), 
            });

        } else if (event.signature ===  Topics.StakingRewardsClaimed) {
            claimActions.push(generateClaimAction(event, true));
            claimActions.push(generateClaimAction(event, false));
        } else {
            console.log(JSON.stringify(event, null, 2)) // TODO remove
        }
    }

    return { rewardsAsGuardian, rewardsAsDelegator, claimActions };
}

function generateClaimAction(event:any, isGuardian:boolean) {
    return {
        contract: event.address.toLowerCase(),
        event: (isGuardian ? 'Guardian' : 'Delegator') + event.event,
        block_number: event.blockNumber,
        block_time: getBlockEstimatedTime(event.blockNumber),
        tx_hash: event.transactionHash,
        additional_info_link: generateTxLink(event.transactionHash),
        amount: bigToNumber(new BigNumber(
            isGuardian ? event.returnValues.claimedGuardianRewards : event.returnValues.claimedDelegatorRewards)),
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getGuardianFeeAndBootstrap(address: string, web3:any) {
    const fees: GuardianReward[] = [];
    const bootstraps: GuardianReward[] = [];
    const withdrawActions: GuardianAction[] = [];

    const filter = [undefined /*don't filter event type*/, addressToTopic(address)];
    const events = await readContractEvents(filter, Contracts.FeeBootstrapReward, web3);
    events.sort((n1:any, n2:any) => n2.blockNumber - n1.blockNumber);  // desc

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
                event: event.signature === Topics.BootstrapWithdrawn ? 'BootstrapRewardsClaimed' : 'FeesClaimed',
                block_number: event.blockNumber,
                block_time: getBlockEstimatedTime(event.blockNumber),
                tx_hash: event.transactionHash,
                additional_info_link: generateTxLink(event.transactionHash),
                amount: bigToNumber(new BigNumber(event.returnValues.amount)),
            });
        }
    }

    return { bootstraps, fees, withdrawActions };
}

function updateStakeList(stakes: GuardianStake[], status: GuardianStakeStatus, block: BlockInfo) {
    const lastStake = stakes[stakes.length-1];
    stakes.unshift({
        block_number: block.number,
        block_time: block.time,
        self_stake: status.self_stake,
        delegated_stake: status.delegated_stake,
        n_delegates: lastStake.n_delegates, // no other way to get this
    });
}

function updateRewardLists(rewardsAsGuardian: GuardianReward[], rewardsAsDelegator: GuardianReward[], bootstraps: GuardianReward[], fees: GuardianReward[], status: GuardianRewardStatus, block: BlockInfo) {
    rewardsAsGuardian.unshift({
        block_number: block.number,
        block_time: block.time,
        tx_hash: '',
        additional_info_link: '',
        amount: status.guardian_rewards_balance,
        total_awarded: status.guardian_rewards_balance + status.guardian_rewards_claimed, 
    });
    rewardsAsDelegator.unshift({
        block_number: block.number,
        block_time: block.time,
        tx_hash: '',
        additional_info_link: '',
        amount: status.delegator_rewards_balance,
        total_awarded: status.delegator_rewards_balance + status.delegator_rewards_claimed,
    });
    bootstraps.unshift({
        block_number: block.number,
        block_time: block.time,
        tx_hash: '',
        additional_info_link: '',
        amount: status.bootstrap_balance,
        total_awarded: status.bootstrap_balance + status.bootstrap_claimed,
    });
    fees.unshift({
        block_number: block.number,
        block_time: block.time,
        tx_hash: '',
        additional_info_link: '',
        amount: status.fees_balance,
        total_awarded: status.fees_balance + status.fees_claimed, 
    });
}