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
import { getWeb3, Contracts, getBlockEstimatedTime, readContractEvents, addressToTopic, Topics, ascendingEvents, readBalances, getCurrentBlockInfo } from "./eth-helpers";
import { Guardian, GuardianInfo, GuardianDelegator, GuardianReward, GuardianStake } from './model';

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

    const { stakes, delegatorMap } = await getStakeChanges(address, web3);

    const rewards: GuardianReward[] = [];
    const claims: number[] = [];

    return {
        address: address.toLowerCase(),
        stake_slices: stakes,
        reward_slices: rewards,
        claim_times: claims,
        delegators: _.map(_.pickBy(delegatorMap, (d) => {return d.stake !== 0}), v => v).sort((n1:any, n2:any) => n2.stake - n1.stake),
        delegators_left: _.map(_.pickBy(delegatorMap, (d) => {return d.stake === 0}), v => v),
    };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getStakeChanges(address: string, web3:any) {
    const filter = [Topics.DelegateStakeChanged, addressToTopic(address)];
    const events = await readContractEvents(filter, Contracts.Delegate, web3);

    const delegatorMap: {[key:string]: GuardianDelegator} = {};
    const stakes: GuardianStake[] = [];
    events.sort(ascendingEvents); 
    
    for (let event of events) {
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
    }

    // if last stake event is more than a day ago, create a extra event copy with current block/time
    const lastStake = stakes[stakes.length-1]
    if ((lastStake.block_time + 86400) < getCurrentClockTime()) {
        const block = await getCurrentBlockInfo(web3);
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

    return { stakes, delegatorMap };
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
