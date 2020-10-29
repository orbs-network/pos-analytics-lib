/**
 * Copyright 2020 the pos-analytics authors
 * This file is part of the pos-analytics library in the Orbs project.
 *
 * This source code is licensed under the MIT license found in the LICENSE file in the root directory of this source tree.
 * The above notice should be included in all copies or substantial portions of the software.
 */

import _ from 'lodash';
import Web3 from 'web3';
import BigNumber from 'bignumber.js';
// @ts-ignore
import { aggregate } from '@makerdao/multicall';
import { erc20Abi } from './abis/erc20';
import { stakeAbi } from './abis/stake';
import { delegationAbi } from './abis/delegation';
import { guardianAbi } from './abis/guardian';
import { rewardsAbi } from './abis/rewards';
import { bigToNumber } from './helpers';

export enum Topics {
    Staked = '0x1449c6dd7851abc30abf37f57715f492010519147cc2652fbc38202c18a6ee90',
    Restaked = '0xa217c421e0e9357b7b1815d752952b142ddc0e23f9f14ecb8233f8f83d563c4d',
    Unstaked = '0x7fc4727e062e336010f2c282598ef5f14facb3de68cf8195c2f23e1454b2b74e',
    Withdrew = '0xadec52fcd1408589179b85e44b434374db078b4eaf793e7d1a1bb0ae4ecfeee5',

    Delegated = '0x4bc154dd35d6a5cb9206482ecb473cdbf2473006d6bce728b9cc0741bcc59ea2',
    DelegateStakeChanged = '0x52db726bc1b1643b24886ed6f0194a41de9abac79d1c12108aca494e5b2bda6b',
}

export enum Contracts {
    Erc20 = 'Erc20',
    Stake = 'Stake',
    Delegate = 'Delegate',
    Reward = 'Reward',
    Guardian = 'Guardian',
}
const Erc20Addresses = ['0xff56Cc6b1E6dEd347aA0B7676C85AB0B3D08B0FA'];
const StakeAddresses = ['0x01D59Af68E2dcb44e04C50e05F62E7043F2656C3'];
const DelegateAddresses = ['0x53d56b4b1EaEd898Be40cF445a715c55dDD6B09C'];
const RewardAddresses = ['0x281e714ee8bFD7208B07205fb93d7C9298f3a807'];
const GuardianAddresses = ['0xAB7F3d56Da621Cff1F5646642d7F79f6A201E4eD'];

const FirstPoSv2BlockNumber = 9830000;
const FirstPoSv2BlockTime = 1586328645;
const referenceBlockTime = 1603200055;
const referenceBlockNumber = 11093232;

export interface BlockInfo {
    time: number;
    number: number;
}
  
export async function getCurrentBlockInfo(web3:Web3): Promise<BlockInfo> {
    const block = await web3.eth.getBlock('latest'); 
    return {time: Number(block.timestamp), number: block.number }
}

export function getBlockEstimatedTime(blockNumber: number, refBlock?: BlockInfo) {
    if (!_.isObject(refBlock)) {
        refBlock = {time: referenceBlockTime, number: referenceBlockNumber }
    }
    const avgBlockTime = (refBlock.time - FirstPoSv2BlockTime) / (refBlock.number - FirstPoSv2BlockNumber);
    return FirstPoSv2BlockTime + Math.round((blockNumber - FirstPoSv2BlockNumber) * avgBlockTime);
}

export function getWeb3(ethereumEndpoint: string): any {
    const web3 = new Web3(new Web3.providers.HttpProvider(ethereumEndpoint, {keepAlive: true,}));
    web3.eth.transactionBlockTimeout = 0; // to stop web3 from polling pending tx
    web3.eth.transactionPollingTimeout = 0; // to stop web3 from polling pending tx
    web3.eth.transactionConfirmationBlocks = 1; // to stop web3 from polling pending tx
    return web3;
}
  
export function addressToTopic(address:string) {
    return '0x000000000000000000000000' + address.substr(2).toLowerCase();
}

export async function readBalanceOf(address:string, web3:any) {
    const erc20Contracts = getPoSContracts(web3, Contracts.Erc20);
    const currentErc20Contract = erc20Contracts[erc20Contracts.length-1];
    return new BigNumber(await currentErc20Contract.methods.balanceOf(address).call());
}

export async function readCurrentStakeOf(address:string, web3:any) {
    const stakeContracts = getPoSContracts(web3, Contracts.Stake);
    const currentStakeContract = stakeContracts[stakeContracts.length-1];
    const txs = [
        currentStakeContract.methods.getStakeBalanceOf(address).call(),
        currentStakeContract.methods.getUnstakeStatus(address).call()
    ];
    const res = await Promise.all(txs);
    console.log(JSON.stringify(res));
    return { 
        currentStake: new BigNumber(res[0]), 
        currentCooldown: new BigNumber(res[1].cooldownAmount),
        currentCooldownTime: new BigNumber(res[1].cooldownEndTime).toNumber(),
    };
}

// Function depends on version 0.11.0 of makderdao/multicall
const MulticallContractAddress = '0xeefBa1e63905eF1D7ACbA5a8513c70307C1cE441'
export async function readBalances(addresses:string[], web3:any) {
    const config = { web3, multicallAddress: MulticallContractAddress};
    const currentErc20Address = Erc20Addresses[Erc20Addresses.length-1];
    const calls: any[] = [];

    for (let address of addresses) {
        calls.push({
            target: currentErc20Address, 
            call: ['balanceOf(address)(uint256)', address],
            returns: [[address, (v: BigNumber.Value) => bigToNumber(new BigNumber(v))]]
        });
    }
    const r = await aggregate(calls, config);
    return r.results.transformed;
}

export async function readContractEvents(filter: (string | undefined)[], contractsType:Contracts, web3:Web3) {
    const contracts = getPoSContracts(web3, contractsType);
    const allEvents = [];
    for(const contract of contracts) {
        const events = await readEvents(filter, contract, web3, FirstPoSv2BlockNumber, 'latest', 100000);
        allEvents.push(...events);
    }
    return allEvents;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readEvents(filter: (string | undefined)[], contract:any, web3:any, startBlock: number, endBlock: number | string, pace: number) {
    try {
        let options = {topics: filter, fromBlock: startBlock, toBlock: endBlock};
        return await contract.getPastEvents('allEvents', options);
    } catch (e) {
        if (`${e}`.includes('query returned more than')) {
            if (pace <= 10) {
                throw new Error('looking for events slowed down to 10 - fail')
            }
            if (typeof endBlock === 'string') {
                const block = await getCurrentBlockInfo(web3);
                endBlock = block.number;
            }
            console.log('\x1b[36m%s\x1b[0m', `read events slowing down to ${pace}`);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const results:any = [];
            for(let i = startBlock; i < endBlock; i+=pace) {
                const currentEnd = i+pace > endBlock ? endBlock : i+pace;
                results.push(...await readEvents(filter, contract, web3, i, currentEnd, pace/10));
            }
            console.log('\x1b[36m%s\x1b[0m', `read events slowing down ended`);
            return results;
        } else {
            throw e;
        }
    }
}

// Note new Contract leaks this is code for client side only 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getPoSContracts(web3:any, contract: Contracts): any[] {
    let abi;
    let addresses;
    switch(contract) {
        case Contracts.Erc20:
            abi = erc20Abi;
            addresses = Erc20Addresses;
            break;
        case Contracts.Stake:
            abi = stakeAbi;
            addresses = StakeAddresses;
            break;
        case Contracts.Delegate:
            abi = delegationAbi;
            addresses = DelegateAddresses;
            break;
        case Contracts.Reward:
            abi = rewardsAbi;
            addresses = RewardAddresses;
            break;
        case Contracts.Guardian:
            abi = guardianAbi;
            addresses = GuardianAddresses;
            break;
        default:
            throw new Error(`cannot get contract of unknown PoS contract: ${contract}` )
    }
    const contracts = []
    for (const address of addresses) {
        contracts.push(new web3.eth.Contract(abi, address));
    }
    return contracts
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ascendingEvents(e1:any, e2:any) {
    if (e1.blockNumber !== e2.blockNumber) {
        return e1.blockNumber - e2.blockNumber;
    } else if (e1.transactionIndex !== e2.transactionIndex) {
        return e1.transactionIndex - e2.transactionIndex
    }
    return e1.logIndex - e2.logIndex;
}

export function generateTxLink(txHash: string): string {
    return `https://etherscan.io/tx/${txHash}`;
}