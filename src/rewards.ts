/**
 * Copyright 2020 the pos-analytics authors
 * This file is part of the pos-analytics library in the Orbs project.
 *
 * This source code is licensed under the MIT license found in the LICENSE file in the root directory of this source tree.
 * The above notice should be included in all copies or substantial portions of the software.
 */

import _ from 'lodash';
import BigNumber from 'bignumber.js';
import { bigToNumber } from './helpers';
import { addressToTopic, ascendingEvents, Contracts, descendingBlockNumbers, generateTxLink, getBlockEstimatedTime, getStartOfRewardsBlock, getWeb3, readContractEvents, readDelegatorDataFromState, readGuardianDataFromState, Topics } from "./eth-helpers";
import { Action, DelegatorReward, GuardianReward} from './model';

interface DelegatorGuardianTransitions {
    guardianAddress: string;
    from: number;
    to: number;
}

export async function getGuardianStakingRewards(address: string, ethereumEndpoint: string): Promise<{rewardsAsGuardian: GuardianReward[];rewardsAsDelegator: DelegatorReward[];claimActions: Action[];}> {
    const {block, web3} = await getWeb3(ethereumEndpoint); 
    const ethData = await readGuardianDataFromState(address, block.number, web3);
    return getGuardianRewardsStakingInternal(address, ethData , web3);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getGuardianRewardsStakingInternal(address: string, ethState:any , web3:any): Promise<{rewardsAsGuardian: GuardianReward[];rewardsAsDelegator: DelegatorReward[];claimActions: Action[];}> {
    // read events
    const txs: Promise<any>[] = [
        readContractEvents([[Topics.GuardianRewardAssigned, Topics.DelegatorRewardAssigned, Topics.StakingRewardsClaimed], addressToTopic(address)], Contracts.Reward, web3),
        readContractEvents([Topics.StakingRewardAllocated], Contracts.Reward, web3)
    ];
    const res = await Promise.all(txs);
    const {guardianEvents, delegatorEvents, claimActions, delegationChanges} = filterAndSeparateRewardsEvents(res[0], ethState, true);
    const globalEvents = uniqueBlockEvents(res[1]);

    // generate rewards as Guardian
    updateGuardianState(ethState, guardianEvents);
    let guardianRewardEvents = mergeAndUniqueOfTwoEventLists(guardianEvents, globalEvents);
    const rewardsAsGuardian: GuardianReward[] = generateGuardianRewards(guardianRewardEvents, ethState);
 
    // generte rewards as Delegator
    if (delegationChanges.length !== 1) { // used to be a "real" delegator so need to find older guardians' events
        const allGuardiansEvents = await generateAllDelegatorGuardiansEvents(delegationChanges, web3);
        guardianRewardEvents = mergeAndUniqueOfTwoEventLists(allGuardiansEvents, globalEvents);
    }
    
    const delState = {
        blockNumber: ethState.blockNumber,
        // values "as delegator"
        total_rewards: ethState.rewards_extra.total_awarded_delegator as BigNumber,
        last_awarded: ethState.rewards_extra.last_awarded_delegator as BigNumber,
        delta_RPT: ethState.rewards_extra.delegator_delta_RPT as BigNumber,
        RPT: ethState.rewards_extra.delegator_RPT as BigNumber,
        // values "as guardian"
        guardian_delta_RPW: ethState.rewards_extra.delta_RPW as BigNumber,
        guardian_RPW: ethState.rewards_extra.RPW as BigNumber,
        guardian_RPT: ethState.rewards_extra.RPT,
        guardian_delta_RPT: ethState.rewards_extra.delta_RPT,
        guardian: address,
    }

    const rewardsAsDelegator: DelegatorReward[] = generateDelegatorRewards(delegatorEvents, guardianRewardEvents, delState);

    return { rewardsAsGuardian, rewardsAsDelegator, claimActions };
}

export async function getDelegatorStakingRewards(address: string, ethereumEndpoint: string): Promise<{rewards: DelegatorReward[];claimActions: Action[];}> {
    const {block, web3} = await getWeb3(ethereumEndpoint);
    const ethData = await readDelegatorDataFromState(address, block.number, web3);
    return getDelegatorRewardsStakingInternal(address, ethData , web3);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getDelegatorRewardsStakingInternal(address: string, ethState:any, web3:any): Promise<{rewards: DelegatorReward[];claimActions: Action[];}> {   
    // read all events, sort and filter
    let txs: Promise<any>[] = [
        readContractEvents([[Topics.DelegatorRewardAssigned, Topics.StakingRewardsClaimed], addressToTopic(address)], Contracts.Reward, web3),
        readContractEvents([Topics.StakingRewardAllocated], Contracts.Reward, web3)
    ];
    let res = await Promise.all(txs);
    const {delegatorEvents, claimActions, delegationChanges} = filterAndSeparateRewardsEvents(res[0], ethState, false);
    const globalEvents = uniqueBlockEvents(res[1]);

    const guardiansEvents = await generateAllDelegatorGuardiansEvents(delegationChanges, web3);
    const guardianAndGlobalEvents = mergeAndUniqueOfTwoEventLists(guardiansEvents, globalEvents);

    const rewards: DelegatorReward[] = generateDelegatorRewards(delegatorEvents, guardianAndGlobalEvents, ethState);

    return { rewards, claimActions };
}

// special case for the "fast" getDelegator/getGuardian version
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getRewardsClaimActions(address: string, web3: any, isGuardian: boolean): Promise<{claimActions: Action[]}> {   
    // read all events, sort and filter
    const events = await readContractEvents([Topics.StakingRewardsClaimed, addressToTopic(address)], Contracts.Reward, web3);
    const claimActions: Action[] = [];  
    for(const event of events) {
        if (isGuardian) {
            claimActions.push(generateClaimAction(event, true));
        }
        claimActions.push(generateClaimAction(event, false));
    }
    return {claimActions};
}

// creates 4 new lists:
// guardianAssign (only first in each block)
// delegatorAssign (only first in each block)
// claimActions (all of them already translated to Actions)
// delegationChanges list of all the guardians and from/to of delegation
function filterAndSeparateRewardsEvents(events:any[], ethState:any, isGuardian:boolean) {
    events.sort(ascendingEvents);
    const guardianEvents: any[] = [];
    const delegatorEvents: any[] = [];
    const claimActions: Action[] = [];
    const delegationChanges: DelegatorGuardianTransitions[] = [];

    const startBlock = getStartOfRewardsBlock().number;
    delegationChanges.push({guardianAddress: ethState.guardian, from: startBlock, to: ethState.blockNumber})
    let dChangeIndex = 0;

    for(const event of events) {
        if (event.signature === Topics.GuardianRewardAssigned) {
            const last = guardianEvents.length;
            if (last === 0 || guardianEvents[last-1].blockNumber < event.blockNumber) {
                guardianEvents.push(event);
            }
        } else if (event.signature === Topics.DelegatorRewardAssigned) {
            const last = delegatorEvents.length;
            if (last === 0 || delegatorEvents[last-1].blockNumber < event.blockNumber) {
                delegatorEvents.push(event);
                const guardian = new String(event.returnValues.guardian).toLowerCase();
                if (delegationChanges[dChangeIndex].guardianAddress !== guardian) {
                    delegationChanges[dChangeIndex].from = event.blockNumber + 1;
                    delegationChanges.push({guardianAddress: guardian, from: startBlock, to: event.blockNumber});
                    dChangeIndex++;
                }
            }
        } else if (event.signature === Topics.StakingRewardsClaimed) {
            if (isGuardian) {
                claimActions.push(generateClaimAction(event, true));
            }
            claimActions.push(generateClaimAction(event, false));
        }
    }
    
    return {guardianEvents, delegatorEvents, claimActions, delegationChanges};
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

async function generateAllDelegatorGuardiansEvents(guardians:DelegatorGuardianTransitions[], web3:any) {
    const txs = []; 
    for (const guardian of guardians) {
        txs.push(readContractEvents([Topics.GuardianRewardAssigned, addressToTopic(guardian.guardianAddress)], Contracts.Reward, web3, guardian.from, guardian.to))
    }
    const res = await Promise.all(txs);
    
    const allGuardiansEvents: any[] = [];
    for (const list of res) {
        allGuardiansEvents.push(...list);
    }

    uniqueBlockEvents(allGuardiansEvents);
    return allGuardiansEvents;
}

// merge two list of events (each one already unique in it's own block-number) the first list events trump the second 
// return descending by block number
function mergeAndUniqueOfTwoEventLists(leadEvents:any[], followerEvents:any[]){
    const events = [...leadEvents, ...followerEvents].sort(descendingBlockNumbers);
    if (leadEvents.length === 0 || followerEvents.length === 0) {
        return events;
    }
    const leaderEvent:string = leadEvents[0].signature;
    let resultSize = 0;
    let i = 0;
    for(;i < events.length-1;i++) {
        if (events[i].blockNumber === events[i+1].blockNumber) {
            if (events[i].signature === leaderEvent) {
                events[resultSize] = events[i];
            } else {
                events[resultSize] = events[i+1];
            }
            i++;
        } else {
            events[resultSize] = events[i];
        }
        resultSize++;        
    }
    if (i < events.length) {
        events[resultSize] = events[i];
        resultSize++;        
    }

    events.length = resultSize; // resize
    return events;
}

// function sorts & resizes the events to hold only the first one in each block.
function uniqueBlockEvents(events:any[]) {
    events.sort(ascendingEvents);
    let lastUniqueEventIndex = 0;
    for (let i = 1; i < events.length;i++) {
        if (events[lastUniqueEventIndex].blockNumber >= events[i].blockNumber) {
            continue;
        }
        lastUniqueEventIndex++;
        events[lastUniqueEventIndex] = events[i];
    }

    events.length = lastUniqueEventIndex + 1; // resize
    return events;
}

function updateGuardianState(ethState:any, guardianEvents:any[]) {
    const totalAwarded = ethState.rewards_extra.total_awarded as BigNumber;
    const lastTotalAwarded = guardianEvents.length > 0 
        ? new BigNumber(guardianEvents[guardianEvents.length-1].returnValues.totalAwarded)
        : 0;
    ethState.rewards_extra.last_awarded = totalAwarded.minus(lastTotalAwarded);
}

function generateGuardianRewards(events:any[], ethState:any) {
    const rewardsAsGuardian: GuardianReward[] = [];

    let totalAwarded = ethState.rewards_extra.total_awarded as BigNumber;
    let deltaAwarded = ethState.rewards_extra.last_awarded as BigNumber;
    let deltaRPW = ethState.rewards_extra.delta_RPW as BigNumber;
    let RPW =  ethState.rewards_extra.RPW as BigNumber;

    // from state 'fake now' reward event
    rewardsAsGuardian.push(generateGuardianReward(ethState.blockNumber, '', totalAwarded))

    for (const event of events) {
        if (event.signature ===  Topics.GuardianRewardAssigned) {
            totalAwarded = new BigNumber(event.returnValues.totalAwarded);
            deltaAwarded = new BigNumber(event.returnValues.amount);
            deltaRPW = new BigNumber(event.returnValues.stakingRewardsPerWeightDelta);
            RPW = new BigNumber(event.returnValues.stakingRewardsPerWeight);
        } else {
            if (!deltaRPW.isZero()) {
                const currDeltaAwarded = deltaAwarded.multipliedBy(
                    RPW.minus(new BigNumber(event.returnValues.stakingRewardsPerWeight)).dividedBy(deltaRPW)
                );

                totalAwarded = totalAwarded.minus(currDeltaAwarded);
                deltaAwarded = deltaAwarded.minus(currDeltaAwarded);
            }
            const currRPW = new BigNumber(event.returnValues.stakingRewardsPerWeight);
            deltaRPW = deltaRPW.minus(RPW).plus(currRPW);
            RPW = currRPW;
        }
        rewardsAsGuardian.push(generateGuardianReward(event.blockNumber, event.transactionHash, totalAwarded));
    }

    // fake 'start' of events
    rewardsAsGuardian.push(generateGuardianReward(getStartOfRewardsBlock().number, '', new BigNumber(0)))

    return rewardsAsGuardian;
}

function generateGuardianReward(blockNumber:number, txHash:string, totalAwarded:BigNumber) {
    return {
        block_number: blockNumber,
        block_time: getBlockEstimatedTime(blockNumber),
        tx_hash: txHash,
        additional_info_link: txHash !== '' ? generateTxLink(txHash) : '',
        total_awarded: bigToNumber(totalAwarded), 
    }
}

function generateDelegatorRewards(delegatorEvents:any[], guardianGlobalEvents:any[], ethState:any) {
    const rewardsAsDelegator: DelegatorReward[] = [];

    delegatorEvents.sort(descendingBlockNumbers);
    const gDeltaRPTEvents = generateGuardianRPTEventsForDelegator(guardianGlobalEvents, ethState)

    let totalAwarded = ethState.total_rewards as BigNumber;
    let awarded = ethState.last_awarded as BigNumber;
    let deltaRPT = ethState.delta_RPT as BigNumber;
    let guardianRPT = ethState.guardian_RPT as BigNumber;
    let guardian = ethState.guardian as string;
 
    // from state 'fake now' reward event
    rewardsAsDelegator.push(generateDelegatorReward(ethState.blockNumber, '', guardian, totalAwarded))
    
    let gDeltaRPTIndex = 0;
    for (const event of delegatorEvents) {
        for(;gDeltaRPTIndex < gDeltaRPTEvents.length;gDeltaRPTIndex++) {
            const nextBlockGuardianRPT = guardianRPT;
            guardianRPT = gDeltaRPTEvents[gDeltaRPTIndex].RPT;
            if (gDeltaRPTEvents[gDeltaRPTIndex].blockNumber === event.blockNumber) {
                gDeltaRPTIndex++;
                break;
            }
            if (!deltaRPT.isZero()) {
                const deltaAwarded = nextBlockGuardianRPT.minus(guardianRPT).multipliedBy(awarded).dividedBy(deltaRPT);
                totalAwarded = totalAwarded.minus(deltaAwarded);
                rewardsAsDelegator.push(generateDelegatorReward(gDeltaRPTEvents[gDeltaRPTIndex].blockNumber, gDeltaRPTEvents[gDeltaRPTIndex].transactionHash, guardian, totalAwarded));
            }
        }
        totalAwarded = new BigNumber(event.returnValues.totalAwarded);
        guardian = new String(event.returnValues.guardian).toLowerCase();
        awarded = new BigNumber(event.returnValues.amount);
        deltaRPT = new BigNumber(event.returnValues.delegatorRewardsPerTokenDelta);
        rewardsAsDelegator.push(generateDelegatorReward(event.blockNumber, event.transactionHash, guardian, totalAwarded));
    }

    // fake 'start' of events
    rewardsAsDelegator.push(generateDelegatorReward(getStartOfRewardsBlock().number, '', guardian, new BigNumber(0)))

    return rewardsAsDelegator;
}

function generateDelegatorReward(blockNumber:number, txHash:string, guardian:string, totalAwarded:BigNumber) {
    return {
        block_number: blockNumber,
        block_time: getBlockEstimatedTime(blockNumber),
        tx_hash: txHash,
        additional_info_link: txHash !== '' ? generateTxLink(txHash) : '',
        total_awarded: bigToNumber(totalAwarded), 
        guardian_from: guardian,
    }
}

function generateGuardianRPTEventsForDelegator(events:any[], ethState:any) {
    const rptList: any[] = [];

    let deltaRPW = ethState.guardian_delta_RPW as BigNumber;
    let RPW =  ethState.guardian_RPW as BigNumber;
    let deltaRPT = ethState.guardian_delta_RPT as BigNumber;
    let RPT =  ethState.guardian_RPT as BigNumber;

    for (const event of events) {
        if (event.signature ===  Topics.GuardianRewardAssigned) {
            deltaRPW = new BigNumber(event.returnValues.stakingRewardsPerWeightDelta);
            RPW = new BigNumber(event.returnValues.stakingRewardsPerWeight);
            deltaRPT = new BigNumber(event.returnValues.delegatorRewardsPerTokenDelta);
            RPT = new BigNumber(event.returnValues.delegatorRewardsPerToken);
        } else {
            const currRPW = new BigNumber(event.returnValues.stakingRewardsPerWeight);
            if (!deltaRPW.isZero()) {
                const eventAddedRPT = RPW.minus(currRPW).multipliedBy(deltaRPT).dividedBy(deltaRPW);
                deltaRPW = deltaRPW.minus(RPW).plus(currRPW);
                deltaRPT = deltaRPT.minus(eventAddedRPT);
                RPT = RPT.minus(eventAddedRPT);
            }
            RPW = currRPW;
        }

        if (!deltaRPW.isZero()) {
            rptList.push(generateRPTEvent(event.blockNumber, event.transactionHash, RPT));
        }
     }

    return rptList;
}

function generateRPTEvent(blockNumber:number, transactionHash:string, RPT:BigNumber) {
    return {
        blockNumber,
        transactionHash,
        RPT,
    }
}

