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
import { feeBootstrapRewardAbi } from './abis/feebootstrap';
import { bigToNumber, getIpFromHex } from './helpers';
import { registryAbi } from './abis/registry';

const FirstPoSv2BlockNumber = 9830000;
const FirstPoSv2BlockTime = 1586328645;

export enum Topics {
    Staked = '0x1449c6dd7851abc30abf37f57715f492010519147cc2652fbc38202c18a6ee90',
    Restaked = '0xa217c421e0e9357b7b1815d752952b142ddc0e23f9f14ecb8233f8f83d563c4d',
    Unstaked = '0x7fc4727e062e336010f2c282598ef5f14facb3de68cf8195c2f23e1454b2b74e',
    Withdrew = '0xadec52fcd1408589179b85e44b434374db078b4eaf793e7d1a1bb0ae4ecfeee5',

    Delegated = '0x4bc154dd35d6a5cb9206482ecb473cdbf2473006d6bce728b9cc0741bcc59ea2',
    DelegateStakeChanged = '0x52db726bc1b1643b24886ed6f0194a41de9abac79d1c12108aca494e5b2bda6b',

    DelegatorRewardAssigned = '0x411edbca4a882d6fbf12b557451a9358a63f73e3011a8c712885cb1e207120dd',
    GuardianRewardAssigned = '0x3880098574881d40bf7b9775086fdc9e6d6edac939d881add769581473c84b45',
    StakingRewardsClaimed = '0x5f51e0cd4567b63928e199868f571929625ded3459b724759a0eb8edbf94158b',

    BootstrapRewardAssigned = '0x0964bebae9e6862697e967a3fe1c7ba8a0f52ba9b6d2cd754a41e8c3be7f8d66',
    FeeAssigned = '0x40ed9423e22a17617adb53819ad0279d3d22356c958e384e233214c870561b99',
    BootstrapWithdrawn = '0x565f40e50eac33ad36895230f693465a27f5341f25e6525568ae66cb24eb1a15',
    FeeWithdrawn = '0xdeb5099d7943aa2b4c1142e5d53d2f7636aa8f7bd130ec79816f151572bcdf45',

    GuardianRegisterd = '0xc2d72ac93e7fb29c534663a530cd3db012d5c336965e423e0ed5ee7a64ed8745',
    GuardianUpdateData = '0xedbe727a71a63bf990149415e72abb211f748254e2c40d878fdc02f440233d22',
    GuardianUpdateMetaData = '0x1cf3d48eb5d849f59c9ee28edc1564cde8ca0e708ccaecf5416a48d3810c5657',
}

export enum Contracts {
    Erc20 = 'Erc20',
    Stake = 'Stake',
    Delegate = 'delegations',
    Reward = 'stakingRewards',
    FeeBootstrapReward = 'feesAndBootstrapRewards',
    Guardian = 'guardiansRegistration',
    Registry = 'ContractRegistry'
}

interface ContractValidData {
    address: string;
    startBlock: number;
    endBlock: number | string;
    abi: any;
}

interface ContractsData {[key:string]: ContractValidData[]};

export async function getWeb3(ethereumEndpoint: string, readContracts:boolean = true) {
    const web3 = new Web3(new Web3.providers.HttpProvider(ethereumEndpoint, {keepAlive: true,}));
    web3.eth.transactionBlockTimeout = 0; // to stop web3 from polling pending tx
    web3.eth.transactionPollingTimeout = 0; // to stop web3 from polling pending tx
    web3.eth.transactionConfirmationBlocks = 1; // to stop web3 from polling pending tx

    const contractsData: ContractsData = {};
    contractsData[Contracts.Delegate] = [];
    contractsData[Contracts.Reward] = [];
    contractsData[Contracts.FeeBootstrapReward] = [];
    contractsData[Contracts.Guardian] = [];
    contractsData[Contracts.Erc20] = [{address: '0xff56Cc6b1E6dEd347aA0B7676C85AB0B3D08B0FA', startBlock: 5710114, endBlock: 'latest', abi: erc20Abi}];
    contractsData[Contracts.Stake] = [{address: '0x01D59Af68E2dcb44e04C50e05F62E7043F2656C3', startBlock: FirstPoSv2BlockNumber, endBlock: 'latest', abi: stakeAbi}];
    contractsData[Contracts.Registry] = [{address: '0xD859701C81119aB12A1e62AF6270aD2AE05c7AB3', startBlock: 11191400, endBlock: 'latest', abi: registryAbi /*getAbiByContractName(Contracts.Registry)*/ }];
    if (readContracts) {
        await readContractsAddresses(contractsData, web3);
    }

    Object.assign(web3, {contractsData});
    return web3
}

async function readContractsAddresses(contractsData: ContractsData, web3:any) {
    let currentStartBlock = contractsData[Contracts.Registry][0].startBlock;
    let currentRegAddress = contractsData[Contracts.Registry][0].address;

    do {
        const currentRegContract = new web3.eth.Contract(contractsData[Contracts.Registry][0].abi, currentRegAddress);
        const res = await readRegisteryEvents(contractsData, currentRegContract, currentStartBlock);
        currentRegAddress = res.nextRegContract;
        currentStartBlock = res.nextRegStartBlock;
        // we don't update the registry as this is one time use only (at the moment)
    } while (currentRegAddress !== '');
    return contractsData;
}

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
        refBlock = {time: 1603200055, number: 11093232 }
    }
    const avgBlockTime = (refBlock.time - FirstPoSv2BlockTime) / (refBlock.number - FirstPoSv2BlockNumber);
    return FirstPoSv2BlockTime + Math.round((blockNumber - FirstPoSv2BlockNumber) * avgBlockTime);
}

export function getStartOfPoSBlock(): BlockInfo {
    return {number: FirstPoSv2BlockNumber, time: FirstPoSv2BlockTime };
}

export function getStartOfRewardsBlock(): BlockInfo {
    return {number: 11145373, time: 1603891336 };
}

export function getFirstDelegationBlock(): BlockInfo {
    return {number: 11180000, time: 1604308068 };
}

// Function depends on version 0.11.0 of makderdao/multicall only on 'latest' block
const MulticallContractAddress = '0xeefBa1e63905eF1D7ACbA5a8513c70307C1cE441'
export async function readBalances(addresses:string[], web3:any) {
    const config = { web3, multicallAddress: MulticallContractAddress};
    const currentErc20Address = web3.contractsData[Contracts.Erc20][0].address;
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

export async function readDelegatorDataFromState(address:string, blockNumber: number, web3:any) {
    const currentErc20Contract = getLatestPoSContract(web3, Contracts.Erc20);
    const currentStakeContract = getLatestPoSContract(web3, Contracts.Stake);
    const currentRewardContract = getLatestPoSContract(web3, Contracts.Reward);
    const txs = [
        currentErc20Contract.methods.balanceOf(address).call({}, blockNumber),
        currentStakeContract.methods.getStakeBalanceOf(address).call({}, blockNumber),
        currentStakeContract.methods.getUnstakeStatus(address).call({}, blockNumber),
        currentRewardContract.methods.getDelegatorStakingRewardsData(address).call({}, blockNumber),
    ];
    const res = await Promise.all(txs);
    return  {
        non_stake: bigToNumber(new BigNumber(res[0])),
        staked: bigToNumber(new BigNumber(res[1])),
        cooldown_stake: bigToNumber(new BigNumber(res[2].cooldownAmount)),
        current_cooldown_time: new BigNumber(res[2].cooldownEndTime).toNumber(),
        reward_balance: new BigNumber(res[3].balance), 
        reward_claimed: new BigNumber(res[3].claimed), 
        guardian: String(res[3].guardian)
    };
}

export async function readGuardianDataFromState(address:string, blockNumber: number, web3:any) {
    const currentGuardianContract = getLatestPoSContract(web3, Contracts.Guardian);
    const currentErc20Contract = getLatestPoSContract(web3, Contracts.Erc20);
    const currentStakeContract = getLatestPoSContract(web3, Contracts.Stake);
    const currentDelegateContract = getLatestPoSContract(web3, Contracts.Delegate);
    const currentRewardContract = getLatestPoSContract(web3, Contracts.Reward);
    const feeBootstrapRewardContract = getLatestPoSContract(web3, Contracts.FeeBootstrapReward);
     const txs = [
        currentGuardianContract.methods.getGuardianData(address).call({}, blockNumber),
        currentGuardianContract.methods.getMetadata(address, 'ID_FORM_URL').call({}, blockNumber),
        currentErc20Contract.methods.balanceOf(address).call({}, blockNumber),
        currentStakeContract.methods.getStakeBalanceOf(address).call({}, blockNumber),
        currentStakeContract.methods.getUnstakeStatus(address).call({}, blockNumber),
        currentDelegateContract.methods.getDelegatedStake(address).call({}, blockNumber),
        currentRewardContract.methods.getGuardianStakingRewardsData(address).call({}, blockNumber),
        currentRewardContract.methods.getDelegatorStakingRewardsData(address).call({}, blockNumber),
        currentRewardContract.methods.getGuardianDelegatorsStakingRewardsPercentMille(address).call({}, blockNumber),
        feeBootstrapRewardContract.methods.getFeesAndBootstrapData(address).call({}, blockNumber),
    ];
    const res = await Promise.all(txs);

    const self_stake = new BigNumber(res[3]);
    const total_stake = new BigNumber(res[5]);
    const balanceAsGuardian = new BigNumber(res[6].balance);
    const claimedAsGuardian = new BigNumber(res[6].claimed);
    const balanceAsDelegator = new BigNumber(res[7].balance);
    const claimedAsDelegator = new BigNumber(res[7].claimed);
    const feeBalance = new BigNumber(res[9].feeBalance);
    const withdrawnFees = new BigNumber(res[9].withdrawnFees);
    const bootstrapBalance = new BigNumber(res[9].bootstrapBalance);
    const withdrawnBootstrap = new BigNumber(res[9].withdrawnBootstrap);


    return  {
        details: {
            name: String(res[0].name),
            website: String(res[0].website),
            ip: getIpFromHex(res[0].ip),
            node_address: String(res[0].orbsAddr).toLowerCase(),
            registration_time: new BigNumber(res[0].registrationTime).toNumber(),
            last_update_time: new BigNumber(res[0].lastUpdateTime).toNumber(),
            details_URL: String(res[1]),
        },
        stake_status: {
            self_stake: bigToNumber(self_stake),
            cooldown_stake: bigToNumber(new BigNumber(res[4].cooldownAmount)),
            current_cooldown_time: new BigNumber(res[4].cooldownEndTime).toNumber(),
            non_stake: bigToNumber(new BigNumber(res[2])),
            delegated_stake: bigToNumber(total_stake.minus(self_stake)),
            total_stake: bigToNumber(total_stake),
        },
        reward_status: {
            guardian_rewards_balance: bigToNumber(balanceAsGuardian), 
            guardian_rewards_claimed: bigToNumber(claimedAsGuardian),
            total_guardian_rewards: bigToNumber(balanceAsGuardian.plus(claimedAsGuardian)),
            delegator_rewards_balance: bigToNumber(balanceAsDelegator), 
            delegator_rewards_claimed: bigToNumber(claimedAsDelegator),
            total_delegator_rewards: bigToNumber(balanceAsDelegator.plus(claimedAsDelegator)),
            fees_balance: bigToNumber(feeBalance), 
            fees_claimed: bigToNumber(withdrawnFees),
            total_fees: bigToNumber(feeBalance.plus(withdrawnFees)),
            bootstrap_balance: bigToNumber(bootstrapBalance), 
            bootstrap_claimed: bigToNumber(withdrawnBootstrap),
            total_bootstrap: bigToNumber(bootstrapBalance.plus(withdrawnBootstrap)),
            delegator_reward_share: new BigNumber(res[8]).toNumber() / 100000     
        }
    };
}

export function addressToTopic(address:string) {
    return '0x000000000000000000000000' + address.substr(2).toLowerCase();
}

export async function readContractEvents(filter: (string[] | string | undefined)[], contractsType:Contracts, web3:Web3) {
    const contracts = getPoSContracts(web3, contractsType);
    const allEvents = [];
    for(const contract of contracts) {
        const events = await readEvents(filter, contract, web3, FirstPoSv2BlockNumber, 'latest', 100000);
        allEvents.push(...events);
    }
    return allEvents;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readEvents(filter: (string[] | string | undefined)[], contract:any, web3:any, startBlock: number, endBlock: number | string, pace: number) {
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

async function readRegisteryEvents(contractsData:ContractsData, regContract:any, startBlock:number) {
    let options = {fromBlock: startBlock, toBlock: 'latest'};
    const events = await regContract.getPastEvents('allEvents', options);
    events.sort(ascendingEvents); 
    for (let event of events) {
        if (event.event === 'ContractAddressUpdated') {
            const contractName = event.returnValues.contractName;
            if (_.has(contractsData, contractName)) {
                const contractData = contractsData[contractName];
                if(contractData.length > 0) {
                    contractData[contractData.length-1].endBlock = event.blockNumber;
                }
                const address = String(event.returnValues.addr).toLowerCase();
                contractData.push({
                    address,
                    startBlock: event.blockNumber+1,
                    endBlock: 'latest',
                    abi: getAbiForContract(address, contractName)                
                });
            }
        } else if (event.event === 'ContractRegistryUpdated') {
            return { nextRegContract: String(event.returnValues.newContractRegistry).toLowerCase(), nextRegStartBlock: event.blockNumber };
        }
    }
    return {nextRegContract: '', nextRegStartBlock: 0};
}

// Note new Contract leaks this is code for client side only 
export function getLatestPoSContract(web3:any, contract: Contracts) {
    const contracts = [];
    const current = web3.contractsData[contract][web3.contractsData[contract].length-1];
    return new web3.eth.Contract(current.abi, current.address);
}

// Note new Contract leaks this is code for client side only 
export function getPoSContracts(web3:any, contract: Contracts): any[] {
    const contracts = [];
    for (const data of web3.contractsData[contract]) {
        contracts.push(new web3.eth.Contract(data.abi, data.address));
    }
    return contracts
}

function getAbiForContract(address: string, contractName: any) {
    // TODO find way to use the fs in lib mode.
    // attempts to get the ABI by address first (useful for deprecated contracts and breaking ABI changes)
    // let abi = getAbiByContractAddress(address);
    // if (abi) return abi;
  
    // abi = getAbiByContractRegistryKey(contractName);
    // if (abi) return abi;

    // ugly fallback
    if (contractName == Contracts.Delegate) {
        return delegationAbi;
    } else if (contractName == Contracts.Reward) {
        return rewardsAbi;
    } else if (contractName == Contracts.FeeBootstrapReward) {
        return feeBootstrapRewardAbi;
    } else if (contractName == Contracts.Guardian) {
        return guardianAbi;
    }
    
    throw new Error(`failed to get abi for ${address} type ${contractName}`);
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