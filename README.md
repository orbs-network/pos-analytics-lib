# ORBS PoS analytics lib

Library to use to extract PoS data of the Orbs Network (for V2).

## Users

### Install
```
npm i @orbs-network/pos-analytics-lib
```

### Functions

* getDelegator

Used to query information about delegator's stake, previous actions and optional rewards.
Funciton's input is the requested delegator's address, an Ethereum endpoint (for example infura link with apikey) 
and optional options object to modify output (see below).

```
const delegatorInfo = await getDelegator(
  '0xB4D4f0E476Afe791B26B39985A65B1bC1BBAcdcA',
  ethereumEndpoint
);
```  
Or
```
const delegatorAndRewardsInfo = await getDelegator(
  '0xB4D4f0E476Afe791B26B39985A65B1bC1BBAcdcA',
  ethereumEndpoint, {read_from_block: -1000000}
);
```  

* getDelegatorStakingRewards

Used to query information about delegator's staking rewards history & claim action history.
Funciton's input is the requested delegator's address, an Ethereum endpoint (for example infura link with apikey) 
and optional options object to modify output (see below).

```
const { rewards, claimActions } = await getDelegatorStakingRewards(
  '0xB4D4f0E476Afe791B26B39985A65B1bC1BBAcdcA',
  ethereumEndpoint
);
```  

* getGuardians

Used to query the list of all current Guardians and their names and weights. Function's input is a list of ORBS node management status URLs.

```
const guardians = await getGuardians(nodeEndpoints);
```

* getGuardian

Used to query a guardian's staking and delegator history, list all current delegators and event history.
Function's input is the requested guardian's address, an Ethereum endpoint (for example infura link with apikey) 
and optional options object to modify output (see below).
<br>Please note: as long as history reading is not disabled all of the delegation history of the guardian is always read.

```
const guardianInfo = await getGuardian(
  '0xf7ae622c77d0580f02bcb2f92380d61e3f6e466c',
  ethereumEndpoint
);
```
Or 
```
const guardianAndRewardsInfo = await getGuardian(
  '0xf7ae622c77d0580f02bcb2f92380d61e3f6e466c',
  ethereumEndpoint, {read_from_block: -1000000, read_rewards_disable: true}
);
```

* getGuardianStakingRewards

Used to query information about guardian's staking rewards history (both as guardian and as self-delegator) & claim action history.
Funciton's input is the requested guardian's address, an Ethereum endpoint (for example infura link with apikey)
and optional options object to modify output (see below).

```
const { rewardsAsGuardian, rewardsAsDelegator, claimActions } = await getGuardianStakingRewards(
  '0xf7ae622c77d0580f02bcb2f92380d61e3f6e466c',
  ethereumEndpoint
);
```  

* getOverview

Used to get an overview of the ORBS network nodes (guardians) stakes and weight history. Function's input is a list of ORBS node management status URLs and an Ethereum endpoint.

```
const overview = await getOverview(nodeEndpoints, ethereumEndpoint);
```

* getAllDelegators

Used to get a map of all the delegators of the ORBS network (including guardians who are self-delegators)
with their current staked and non-staked balances and the last block that they changed their delegation. 
Function's input is an Ethereum endpoint.

```
const delegatorMap = await getAllDelegators(ethereumEndpoint);
```

### Helper Functions

* delegatorToXlsx

Used to translate the output of `getDelegator` to xlsx format. Input is delegatorInfo object and output-type
which is one of "buffer" or "array" or "binary" or "string" or "base64" (depending what you want to do with the output).

```
const delegatorInfo = await getDelegator('0x1e9673315e0ada0db640c299ddd2a1d81d220180', ethereumEndpoint);
const delegatorXlsx = delegatorToXlsx(delegatorInfo, 'buffer');
fs.writeFileSync(path, delegatorXlsx);
```

* guardianToXlsx

Used to translate the output of `getGuardian` to xlsx format. Input is guardianInfo object and output-type
which is one of "buffer" or "array" or "binary" or "string" or "base64" (depending what you want to do with the output).

```
const guardianInfo = await getGuardian('0xc5e624d6824e626a6f14457810e794e4603cfee2', ethereumEndpoint);
const guardianXlsx = guardianToXlsx(guardianInfo, 'buffer');
fs.writeFileSync(path, guardianXlsx);
```

* allDelegatorsToXlsx

Used to translate the output of `getAllDelegators` to xlsx format. Input is map of Delegators ({[key: string]: Delegator}) object and output-type
which is one of "buffer" or "array" or "binary" or "string" or "base64" (depending what you want to do with the output).

```
const delegatorMap = await getAllDelegators(ethereumEndpoint)
const delegatorsXlsx = allDelegatorsToXlsx(guardianInfo, 'buffer');
fs.writeFileSync(path, delegatorsXlsx);
```

### Inputs

* Address - Ethereum address of delegator or guardian to test
* EthereumEndpoit - Ethereum url for web3 http provider such as Infura (i.e: https://mainnet.infura.io/v3/<YOUR-INFURA-KEY>)
* NodesEndpoint - a list of one or more ORBS node management status URLs (i.e: http://54.168.36.177/services/management-service/status), these will be queries in order and first one that answers is the one used.
* options (for getDelegator, getGuardian, getDelegatorStakingRewards & getGuardianStakingRewards only) - a modifier object. The default values are shown after each key:
```
{
    read_history: true,          
    read_from_block: 0,
    read_rewards_disable: false,
}
```

| Field                  | Explanation          |
| ---------------------- | -------------------- |
| `read_history`         | Read the historical changes (events) from ethereum event histor and generate the corresponding arrays of values (rewards, stakes, actions etc).<br> Default is `true`<br>A `false` value is quicker but returns only the current state values of the participant (guardian or delegator) | 
| `read_from_block`      | Start block of reading events.<br>Possible Values: 0/-1 - block number of contract deployment (earliest available), positive - block to start from, negative - how many blocks back to start from (i.e. -500 = 500 block before 'latest')<br>Please note you cannot query events from blocks before first contract of the type was deployed.<br>Value has no effect if read_history is set to `false`.    |
| `read_rewards_disable` | Read and calculate rewards slows down respons time so with this field can disable just the stake rewards part.<br> Default is `false`.<br>Value has no effect if read_history is `false`. | 
Please note: 
1) For the functions getDelegatorStakingRewards & getGuardianStakingRewards only the `read_from_block` is used.
2) For function getGuardian when `read_history` is true the whole delegation history is read regardless of the `read_from_block`. This also mean that staking 
history is also read from at least the begining of Delegation contract deployment (In full history mode there may be self-stake event before delegation).

### Outputs
Please have a look at the [model.ts](src/model.ts) for the full output definisions. 

### Contract Deployments Block Numbers
* Orbs ERC20 - 740000
* Staking Contract - 9830000
* Delegation - 11180000
* Rewards - 11145373

## Development

### Download 
```
git clone https://github.com/orbs-network/pos-analytics-lib
cd pos-analytics-lib
```

### Build 
```
npm run build
```

### Clean 
```
npm run clean
```

### Test
There is only an "E2E" like test that calls all functions of the library, to run it you must setup an Ethereum-Endpoint for web3 http provider. This can be done by setting an enviroment variable in your running IDEA named `ETHEREUM_ENDPOINT`, or adding a file named `.env` at the root of the directory and in that file have one line `ETHEREUM_ENDPOINT=https://mainnet.infura.io/v3/<YOUR-INFURA-KEY>`

Then you can run the test

```
npm run test
```

The results will be in a direcotry `data` under root direcotry of the project. You will see 4 json files, one for each function call.

