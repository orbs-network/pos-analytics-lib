/**
 * Copyright 2020 the pos-analytics authors
 * This file is part of the pos-analytics library in the Orbs project.
 *
 * This source code is licensed under the MIT license found in the LICENSE file in the root directory of this source tree.
 * The above notice should be included in all copies or substantial portions of the software.
 */

import _ from 'lodash'
import XLSX from 'xlsx';
import { Delegator, DelegatorInfo, GuardianInfo } from './model';

const fileExtension = 'xlsx';
type OutputType = "buffer" | "array" | "binary" | "string" | "base64";

export function delegatorToXlsx(delegator: DelegatorInfo, outputType: OutputType) {
    let workbook = XLSX.utils.book_new();

    const s1data:unknown[][] = [
        ['Delegator', delegator.address],
        [`Data collected at ${delegator.block_number} on ${new Date(delegator.block_time * 1000)}`],
        ['Details'],
        ['', 'total_stake', delegator.total_stake],
        ['', 'non_stake', delegator.non_stake],
        ['', 'cooldown_stake', delegator.cooldown_stake],
        ['', 'current_cooldown_time', delegator.current_cooldown_time],
        ['', 'delegated_to', delegator.delegated_to],
        ['', 'rewards_balance', delegator.rewards_balance],
        ['', 'rewards_claimed', delegator.rewards_claimed],
        ['', 'total_rewards', delegator.total_rewards],
    ]; 
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(s1data), 'Details');
    
    if (delegator.actions && delegator.actions.length > 0) {
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(delegator.actions), 'Actions');    
    }
    if (delegator.stake_slices && delegator.stake_slices.length > 0) {
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(delegator.stake_slices), 'Stakes');    
    }
    if (delegator.reward_slices && delegator.reward_slices.length > 0) {
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(delegator.reward_slices), 'Rewards');    
    }

    return XLSX.write(workbook, { bookType: fileExtension, type: outputType });
}

export function guardianToXlsx(guardian: GuardianInfo, outputType: OutputType) {
    const workbook = XLSX.utils.book_new();

    const s1data:unknown[][] = [
        ['Guardian', guardian.address],
        [`Data collected at ${guardian.block_number} on ${new Date(guardian.block_time * 1000)}`],
        ['Details'],
    ];
    
    _.forOwn(guardian.details, (v,k) => s1data.push(['', k, k==='registration_time'||k==='last_update_time' ? new Date(v as number * 1000) : v]));
    s1data.push(['Stake Status']);
    _.forOwn(guardian.stake_status, (v,k) => s1data.push(['', k, v]));
    s1data.push(['Reward Status']);
    _.forOwn(guardian.reward_status, (v,k) => s1data.push(['', k, v]));
   
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(s1data), 'Details');
    
    if (guardian && guardian.actions.length > 0) {
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(guardian.actions), 'Actions');    
    }
    if (guardian.stake_slices && guardian.stake_slices.length > 0) {
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(guardian.stake_slices), 'Stakes');    
    }
    if (guardian.reward_as_guardian_slices && guardian.reward_as_guardian_slices.length > 0) {
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(guardian.reward_as_guardian_slices), 'Self-Stake-Rewards');    
    }
    if (guardian.reward_as_delegator_slices && guardian.reward_as_delegator_slices.length > 0) {
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(guardian.reward_as_delegator_slices), 'Stake-Rewards');    
    }
    if (guardian.bootstrap_slices && guardian.bootstrap_slices.length > 0) {
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(guardian.bootstrap_slices), 'Bootstrap-Rewards');    
    }
    if (guardian.fees_slices && guardian.fees_slices.length > 0) {
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(guardian.fees_slices), 'Fee-Rewards');    
    }

    return XLSX.write(workbook, { bookType: fileExtension, type: outputType });
}

export function allDelegatorsToXlsx(delegators: {[key:string]: Delegator}, outputType: OutputType) {
    let workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(_.values(delegators)), 'Delegators');    

    return XLSX.write(workbook, { bookType: fileExtension, type: outputType });
}

