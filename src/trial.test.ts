import _ from 'lodash';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

import { getDelegator } from './delegator';
import { getGuardian, getGuardians } from './guardian';
import { getOverview } from './overview';
import { getGuardianStakingRewards, getDelegatorStakingRewards } from './rewards';
dotenv.config();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toConsole(x:any){ return JSON.stringify(x, null, 2)}

async function x() {
    const ethereumEndpoint = String(process.env.ETHEREUM_ENDPOINT);
    const nodeEndpoints = [
        'https://0xcore.orbs.com/services/management-service/status',  // for actual production front-end with https
        'http://0xaudit.orbs.com/services/management-service/status', // for dev non https
        'http://52.20.37.155/services/management-service/status',  // for dev non https
    ];

    const totalTimeStart = Date.now();

    let s = Date.now();
    const delegatorInfo = await getDelegator('0xB4D4f0E476Afe791B26B39985A65B1bC1BBAcdcA', ethereumEndpoint);
    console.log(`fast delegator took ${(Date.now() - s) / 1000.0} seconds`);
    const dfilepath = path.resolve(__dirname, `../data/delegator.json`);   
    fs.writeFileSync(dfilepath, toConsole(delegatorInfo));
    // console.log(toConsole(delegatorInfo));

    s = Date.now()
    const delegatorFullInfo = await getDelegator('0xB4D4f0E476Afe791B26B39985A65B1bC1BBAcdcA', ethereumEndpoint, true);
    console.log(`full delegator took ${(Date.now() - s) / 1000.0} seconds`);
    const dFullfilepath = path.resolve(__dirname, `../data/delegator_full.json`);   
    fs.writeFileSync(dFullfilepath, toConsole(delegatorFullInfo));
    // console.log(toConsole(delegatorFullInfo));

    s = Date.now()
    const delegatorRewardsInfo = await getDelegatorStakingRewards('0xB4D4f0E476Afe791B26B39985A65B1bC1BBAcdcA', ethereumEndpoint);
    console.log(`delegator rewards only took ${(Date.now() - s) / 1000.0} seconds`);
    const dRewardsfilepath = path.resolve(__dirname, `../data/delegator_rewards.json`);   
    fs.writeFileSync(dRewardsfilepath, toConsole(delegatorRewardsInfo));
    // console.log(toConsole(rewards));

    const guardians = await getGuardians(nodeEndpoints);
    const gsfilepath = path.resolve(__dirname, `../data/guardians.json`);   
    fs.writeFileSync(gsfilepath, toConsole(guardians));
    //console.log(toConsole(guardians));

    s = Date.now()
    const guardianInfo = await getGuardian('0xc5e624d6824e626a6f14457810e794e4603cfee2', ethereumEndpoint);
    console.log(`fast guardian took ${(Date.now() - s) / 1000.0} seconds`);
    const gfilepath = path.resolve(__dirname, `../data/guardian.json`);   
    fs.writeFileSync(gfilepath, toConsole(guardianInfo));
    //console.log(toConsole(guardianInfo));

    s = Date.now()
    const guardianFullInfo = await getGuardian('0xc5e624d6824e626a6f14457810e794e4603cfee2', ethereumEndpoint, true);
    console.log(`full guardian took ${(Date.now() - s) / 1000.0} seconds`);
    const gFullfilepath = path.resolve(__dirname, `../data/guardian_full.json`);   
    fs.writeFileSync(gFullfilepath, toConsole(guardianFullInfo));
    // console.log(toConsole(guardianFullInfo));

    s = Date.now()
    const guardianRewardsInfo = await getGuardianStakingRewards('0xc5e624d6824e626a6f14457810e794e4603cfee2', ethereumEndpoint);
    console.log(`guardian rewards only took ${(Date.now() - s) / 1000.0} seconds`);
    const gRewardsfilepath = path.resolve(__dirname, `../data/guardian_rewards.json`);   
    fs.writeFileSync(gRewardsfilepath, toConsole(guardianRewardsInfo));
    // console.log(toConsole(guardianFullInfo));

    const overview = await getOverview(nodeEndpoints, ethereumEndpoint);
    const filepath = path.resolve(__dirname, `../data/overview.json`);   
    fs.writeFileSync(filepath, toConsole(overview));
    // console.log(toConsole(overview));

    console.log(`test took ${(Date.now() - totalTimeStart) / 1000.0} seconds`)
}

x().then(()=> process.exit(0)).catch(e => console.log(`${e.stack}`));
