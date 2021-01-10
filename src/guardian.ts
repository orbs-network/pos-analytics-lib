/**
 * Copyright 2020 the pos-analytics authors
 * This file is part of the pos-analytics library in the Orbs project.
 *
 * This source code is licensed under the MIT license found in the LICENSE file in the root directory of this source tree.
 * The above notice should be included in all copies or substantial portions of the software.
 */

import _ from 'lodash';
import BigNumber from 'bignumber.js';
import { fetchJson, bigToNumber, parseOptions } from './helpers';
import { addressToTopic, ascendingEvents, BlockInfo, Contracts, getBlockEstimatedTime, generateTxLink, getWeb3, readBalances, readContractEvents, readGuardianDataFromState, Topics, getStartOfRewardsBlock, getStartOfPoSBlock, getStartOfDelegationBlock } from "./eth-helpers";
import { Guardian, GuardianInfo, GuardianDelegator, GuardianReward, GuardianStake, GuardianAction, GuardianRewardStatus, GuardianStakeStatus, DelegatorReward, PosOptions } from './model';
import { getGuardianRewardsStakingInternal, getRewardsClaimActions } from './rewards';

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

export async function getGuardian(address: string, ethereumEndpoint: string, o?: PosOptions | any): Promise<GuardianInfo> {
    const options = parseOptions(o);
    const actions: GuardianAction[] = [];
    const stakes: GuardianStake[] = [];
    let rewardsAsGuardian: GuardianReward[] = [];
    let rewardsAsDelegator: DelegatorReward[] = [];

    const web3 = await getWeb3(ethereumEndpoint);
    
    let ethData: any;
    let txs: Promise<any>[];
    if (options.read_rewards) {
        ethData = await readGuardianDataFromState(address, web3);
        txs = [
            getGuardianStakeAndDelegationChanges(address, web3),
            getGuardianStakeActions(address, web3),
            getGuardianRegisterationActions(address, web3),
            getGuardianRewardsStakingInternal(address, ethData, web3, options),
            getGuardianFeeAndBootstrap(address, web3),
        ];
    } else {
        txs = [
            getGuardianStakeAndDelegationChanges(address, web3),
            getGuardianStakeActions(address, web3),
            getGuardianRegisterationActions(address, web3),
            getRewardsClaimActions(address, web3, true),
            getGuardianFeeAndBootstrap(address, web3),
            readGuardianDataFromState(address, web3)
        ];
    }
    const res = await Promise.all(txs);
    
    const delegatorMap = res[0].delegatorMap;
    actions.push(...res[0].delegateActions);
    stakes.push(...res[0].delegationStakes);
    actions.push(...res[1].stakeActions);
    stakes.push(...res[1].stakesBeforeDelegation);
    actions.push(...res[2]);
    actions.push(...res[3].claimActions);
    const bootstrapRewards = res[4].bootstraps;
    const feeRewards = res[4].fees;
    actions.push(...res[4].withdrawActions);
    if (options.read_rewards) {
        rewardsAsGuardian = res[3].rewardsAsGuardian;
        rewardsAsDelegator = res[3].rewardsAsDelegator;
    } else {
        ethData = res[5];
    }

    actions.sort((n1:any, n2:any) => n2.block_number - n1.block_number); // desc unlikely guardian actions in same block
    stakes.sort((n1:any, n2:any) => n2.block_number - n1.block_number); // desc before delegation unlikely in same block. after delegation we filter same block

    // add "now" values to lists
    injectFirstLastStakes(stakes, ethData.stake_status, ethData.block);
    injectFirstLastRewards(bootstrapRewards, feeRewards, ethData.reward_status, ethData.block); 
    
    const delegators = _.map(_.pickBy(delegatorMap, (d) => {return d.stake !== 0}), v => v).sort((n1:any, n2:any) => n2.stake - n1.stake);
    const delegators_left = _.map(_.pickBy(delegatorMap, (d) => {return d.stake === 0}), v => v);

    return {
        address: address.toLowerCase(),
        block_number: ethData.block.number,
        block_time: ethData.block.time,
        details : ethData.details,
        stake_status: ethData.stake_status,
        reward_status: ethData.reward_status,
        actions,
        stake_slices: stakes,
        reward_as_guardian_slices: rewardsAsGuardian,
        reward_as_delegator_slices: rewardsAsDelegator,
        bootstrap_slices: bootstrapRewards, 
        fees_slices: feeRewards,
        delegators,
        delegators_left,
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
    const firstDelegationBlock = getStartOfDelegationBlock();
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
export async function getGuardianFeeAndBootstrap(address: string, web3:any) {
    const fees: GuardianReward[] = [];
    const bootstraps: GuardianReward[] = [];
    const withdrawActions: GuardianAction[] = [];

    const filter = [[Topics.BootstrapRewardAssigned, Topics.FeeAssigned, Topics.BootstrapWithdrawn, Topics.FeeWithdrawn], addressToTopic(address)];
    const events = await readContractEvents(filter, Contracts.FeeBootstrapReward, web3);
    events.sort((n1:any, n2:any) => n2.blockNumber - n1.blockNumber);  // desc

    for (let event of events) {
        if (event.signature ===  Topics.BootstrapRewardAssigned) {
            bootstraps.push({
                block_number: event.blockNumber,
                block_time: getBlockEstimatedTime(event.blockNumber),
                tx_hash: event.transactionHash,
                additional_info_link: generateTxLink(event.transactionHash),
                total_awarded: bigToNumber(new BigNumber(event.returnValues.totalAwarded)), 
            });
        } else if (event.signature ===  Topics.FeeAssigned) {
            fees.push({
                block_number: event.blockNumber,
                block_time: getBlockEstimatedTime(event.blockNumber),
                tx_hash: event.transactionHash,
                additional_info_link: generateTxLink(event.transactionHash),
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

function injectFirstLastRewards(bootstraps: GuardianReward[], fees: GuardianReward[], status: GuardianRewardStatus, block: BlockInfo) {
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