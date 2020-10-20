# ORBS PoS analytics lib

Library to use to extract PoS data of the Orbs Network (for V2).

## Functions

* getDelegator

Used to query information about delegator's stake, previous actions and rewards. Funciton's input is the requested delegator's address and an Ethereum endpoint (for example infura link with apikey).

```
const delegatorInfo = await getDelegator(
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

Used to query a guardian's staking and delegator history, rewards history and list all current delegators. Function's input is the requested guardian's address and an Ethereum endpoint (for example infura link with apikey).
```
const guardianInfo = await getGuardian(
  '0xf7ae622c77d0580f02bcb2f92380d61e3f6e466c',
  ethereumEndpoint
);
```

* getOverview

Used to get an overview of the ORBS network nodes (guardians) stakes and weight history. Function's input is a list of ORBS node management status URLs and an Ethereum endpoint.

```
const overview = await getOverview(nodeEndpoints, ethereumEndpoint);
```

## Inputs

* Address - Ethereum address of delegator or guardian to test
* EthereumEndpoit - Ethereum url for web3 http provider such as Infura (i.e: https://mainnet.infura.io/v3/<YOUR-INFURA-KEY>)
* NodesEndpoint - a list of one or more ORBS node management status URLs (i.e: http://54.168.36.177/services/management-service/status), these will be queries in order and first one that answers is the one used.

## Outputs
Please have a look at the [model.ts](src/model.ts) for the full output definisions. 