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
import { addressToTopic, ascendingEvents, BlockInfo, Contracts, getBlockEstimatedTime, generateTxLink, getCurrentBlockInfo, getWeb3, readBalances, readContractEvents, readGuardianDataFromState, Topics, getStartOfRewardsBlock, getStartOfPoSBlock, getFirstDelegationBlock } from "./eth-helpers";
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
    const web3 = await getWeb3(ethereumEndpoint);

    // fix block for all "state" data.
    const block = await getCurrentBlockInfo(web3);

    const ethData = await readGuardianDataFromState(address, block.number, web3)

    const actions: GuardianAction[] = [];
    const stakes: GuardianStake[] = [];

    const { delegationStakes, delegatorMap, delegateActions } = await getGuardianStakeAndDelegationChanges(address, web3);
    actions.push(...delegateActions);
    stakes.push(...delegationStakes);

    const { stakeActions, stakesBeforeDelegation } = await getGuardianStakeActions(address, web3);
    actions.push(...stakeActions);
    stakes.push(...stakesBeforeDelegation);

    const registrationActions = await getGuardianRegisterationActions(address, web3);
    actions.push(...registrationActions);

    const { rewardsAsGuardian, rewardsAsDelegator, claimActions } = await getGuardianRewards(address, web3);   
    actions.push(...claimActions);

    const { bootstraps, fees, withdrawActions } = await getGuardianFeeAndBootstrap(address, web3);
    actions.push(...withdrawActions);

    actions.sort((n1:any, n2:any) => n2.block_number - n1.block_number); // desc unlikely guardian actions in same block
    stakes.sort((n1:any, n2:any) => n2.block_number - n1.block_number); // desc

    // add "now" values to lists
    injectFirstLastStakes(stakes, ethData.stake_status, block);
    injectFirstLastRewards(rewardsAsGuardian, rewardsAsDelegator, bootstraps, fees, ethData.reward_status, block); 
    
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
export async function getGuardianStakeAndDelegationChanges(address: string, web3:any) {
    const filter = [[Topics.DelegateStakeChanged, Topics.Delegated], addressToTopic(address)];
    const events = await readContractEvents(filter, Contracts.Delegate, web3);

    const delegatorMap: {[key:string]: GuardianDelegator} = {};
    const delegationStakes: GuardianStake[] = [];
    const delegateActions: GuardianAction[] = [];
    events.sort(ascendingEvents); 
    
    for (let event of events) {
        if (event.signature === Topics.DelegateStakeChanged) {
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
                
            addOrUpdateStakeList(delegationStakes, event.blockNumber, bigToNumber(selfDelegate), bigToNumber(allStake.minus(selfDelegate)), _.size(delegatorMap));
        } else if (event.signature === Topics.Delegated) {
            const toAddress = String(event.returnValues.to).toLowerCase();
            delegateActions.push({
                contract: event.address.toLowerCase(),
                event: toAddress === address.toLowerCase() ? 'SelfDelegated' : event.event,
                block_time: getBlockEstimatedTime(event.blockNumber),
                block_number: event.blockNumber,
                tx_hash: event.transactionHash,
                additional_info_link: generateTxLink(event.transactionHash),
                to: toAddress,
            });
        }
    }
    
    const balanceMap = await readBalances(_.keys(delegatorMap), web3);
    _.forOwn(delegatorMap, (v) => {
        v.last_change_time = getBlockEstimatedTime(v.last_change_block);
        v.non_stake = balanceMap[v.address];
    });

    return { delegationStakes, delegatorMap, delegateActions };
}

function addOrUpdateStakeList(stakes: GuardianStake[], blockNumber: number, selfStake: number, delegateStake: number, nDelegators: number) {
    if (stakes.length > 0 && stakes[stakes.length-1].block_number == blockNumber) {
        const curr = stakes[stakes.length-1];
        curr.self_stake = selfStake;
        curr.delegated_stake = delegateStake;
        curr.total_stake = selfStake + delegateStake;
        curr.n_delegates = nDelegators;
    } else {
        stakes.push({
            block_number: blockNumber,
            block_time: getBlockEstimatedTime(blockNumber),
            self_stake: selfStake,
            delegated_stake: delegateStake,
            total_stake: selfStake + delegateStake,
            n_delegates: nDelegators,
        });
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getGuardianStakeActions(address: string, web3:any) {
    const filter = [[Topics.Staked, Topics.Restaked, Topics.Unstaked, Topics.Withdrew], addressToTopic(address)];
    const events = await readContractEvents(filter, Contracts.Stake, web3);

    let totalStake = new BigNumber(0);
    const firstDelegationBlock = getFirstDelegationBlock();
    const stakesBeforeDelegation: GuardianStake[] = [];
    const stakeActions: GuardianAction[] = [];    
    for (let event of events) {
        const amount = new BigNumber(event.returnValues.amount);
        if (event.signature === Topics.Staked || event.signature === Topics.Restaked) {
            totalStake = totalStake.plus(amount);
        } else if (event.signature === Topics.Unstaked) {
            totalStake = totalStake.minus(amount)
        }

        stakeActions.push({
            contract: event.address.toLowerCase(),
            event: event.event,
            block_number: event.blockNumber,
            block_time: getBlockEstimatedTime(event.blockNumber),
            tx_hash: event.transactionHash,
            additional_info_link: generateTxLink(event.transactionHash),
            amount: bigToNumber(amount),
            current_stake: bigToNumber(totalStake)
        });

        if(event.blockNumber < firstDelegationBlock.number) {
            const stake = bigToNumber(totalStake);
            stakesBeforeDelegation.push({
                block_number: event.blockNumber,
                block_time: getBlockEstimatedTime(event.blockNumber),
                self_stake: stake,
                delegated_stake: 0,
                total_stake: stake,
                n_delegates: 0,
            })
        }
    }

    return { stakeActions, stakesBeforeDelegation };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getGuardianRegisterationActions(address: string, web3:any) {
    const filter = [Topics.GuardianRegisterd, addressToTopic(address)];
    const events = await readContractEvents(filter, Contracts.Guardian, web3);

    const actions: GuardianAction[] = [];    
    for (let event of events) {
        actions.push({
            contract: event.address.toLowerCase(),
            event: event.event,
            block_number: event.blockNumber,
            block_time: getBlockEstimatedTime(event.blockNumber),
            tx_hash: event.transactionHash,
            additional_info_link: generateTxLink(event.transactionHash),
        });
    }

    return actions;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getGuardianRewards(address: string, web3:any) {
    const rewardsAsGuardian: GuardianReward[] = [];
    const rewardsAsDelegator: GuardianReward[] = [];
    const claimActions: GuardianAction[] = [];

    const filter = [[Topics.GuardianRewardAssigned, Topics.DelegatorRewardAssigned, Topics.StakingRewardsClaimed], addressToTopic(address)];
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

    const filter = [[Topics.BootstrapRewardAssigned, Topics.FeeAssigned, Topics.BootstrapWithdrawn,  Topics.FeeWithdrawn], addressToTopic(address)];
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
                event: event.event,
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

function injectFirstLastStakes(stakes: GuardianStake[], status: GuardianStakeStatus, block: BlockInfo) {
    stakes.unshift({
        block_number: block.number,
        block_time: block.time,
        self_stake: status.self_stake,
        delegated_stake: status.delegated_stake,
        total_stake: status.total_stake,
        n_delegates: stakes[0].n_delegates, // no other way to get this
    });
    const startOfPoS = getStartOfPoSBlock();
    stakes.push({
        block_number: startOfPoS.number,
        block_time: startOfPoS.time,
        self_stake: 0,
        delegated_stake: 0,
        total_stake: 0,
        n_delegates: 0, 
    })
}

function injectFirstLastRewards(rewardsAsGuardian: GuardianReward[], rewardsAsDelegator: GuardianReward[], bootstraps: GuardianReward[], fees: GuardianReward[], status: GuardianRewardStatus, block: BlockInfo) {
    rewardsAsGuardian.unshift(generateRewardItem(block, status.guardian_rewards_balance, status.guardian_rewards_claimed));
    rewardsAsGuardian.push(generateRewardItem(getStartOfRewardsBlock(), 0, 0));
    rewardsAsDelegator.unshift(generateRewardItem(block, status.delegator_rewards_balance, status.delegator_rewards_claimed));
    rewardsAsDelegator.push(generateRewardItem(getStartOfRewardsBlock(), 0, 0));
    bootstraps.unshift(generateRewardItem(block, status.bootstrap_balance, status.bootstrap_claimed));
    bootstraps.push(generateRewardItem(getStartOfRewardsBlock(), 0, 0));
    fees.unshift(generateRewardItem(block, status.fees_balance, status.fees_claimed));
    fees.push(generateRewardItem(getStartOfRewardsBlock(), 0, 0));
}

function generateRewardItem(block: BlockInfo, balance:number, claimed:number ) {
    return {
        block_number: block.number,
        block_time: block.time,
        tx_hash: '',
        additional_info_link: '',
        amount: balance,
        total_awarded: balance + claimed, 
    };
}