/**
 * Copyright 2020 the pos-analytics authors
 * This file is part of the pos-analytics library in the Orbs project.
 *
 * This source code is licensed under the MIT license found in the LICENSE file in the root directory of this source tree.
 * The above notice should be included in all copies or substantial portions of the software.
 */

import _ from 'lodash';
import { getCurrentBlockInfo, getWeb3 } from "./eth-helpers";
import { fetchJson } from './helpers';
import { PosOverview, PosOverviewSlice, PosOverviewData } from './model';

export async function getOverview(networkNodeUrls: string[], ethereumEndpoint: string): Promise<PosOverview> {
    for(const url of networkNodeUrls) {
        try {
            const rawData = await fetchJson(url);
            return parseRawData(rawData.Payload, ethereumEndpoint);
        } catch (e) {
            //console.log(`Warning: access to URL ${url} failed, trying another. Error: ${e} `)
        }
    }

    throw new Error(`Error while creating PoS Overview, all Netowrk Node URL failed to respond.`)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function parseRawData(data:any, ethereumEndpoint:string) : Promise<PosOverview> {
    const addrToName: {[key:string]: string} = {};
    let totalStake = 0;
    _.forEach(data.Guardians, g => {
        totalStake += g?.DelegatedStake || 0;
        addrToName[g.EthAddress] = g.Name;
    });

    const slices: PosOverviewSlice[] = [];
    _.forEach(data.CommitteeEvents, event => {
        const committee: PosOverviewData[] = [];

        _.forEach(event.Committee, member => {
            committee.push(
            {
                name: addrToName[member.EthAddress],
                address: '0x' + String(member.EthAddress).toLowerCase(),
                effectiveStake: Number(member?.EffectiveStake || 0),
                weight: Number(member?.Weight || 0),
            });
        });

        slices.push({
            block_number: event.RefBlock || 0,
            block_time: event.RefTime,
            data: committee
        })
    });
    slices.sort((n1:any, n2:any) => n2.block_time - n1.block_time); // desc

    // TODO uncomment when the new Interface is published
    const web3 = getWeb3(ethereumEndpoint);
    const block = await getCurrentBlockInfo(web3);
    // const rewradsContract = getPoSContracts(web3, Contracts.Reward);
    // const settings = await rewradsContract.methods.getSettings().call();
    // const api = Number(settings.annualStakingRewardsRatePercentMille);
    const apy = 4000;
    
    return {
        block_number: block.number,
        block_time: Number(block.time),
        total_stake: totalStake,
        n_guardians: _.size(data?.Guardians) || 0,
        n_committee: data?.CurrentCommittee.length || 0,
        n_candidates: data?.CurrentCandidates.length || 0,
        apy,
        slices
    }
}

