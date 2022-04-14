import _ from 'lodash';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

import { getDelegator } from './delegator';
import { getGuardian, getGuardians } from './guardian';
import { getAllDelegators, getOverview } from './overview';
import { getGuardianStakingRewards, getDelegatorStakingRewards } from './rewards';
import { allDelegatorsToXlsx, delegatorToXlsx, guardianToXlsx } from './xls'
dotenv.config();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toConsole(x:any){ return JSON.stringify(x, null, 2)}

async function x() {
    const ethereumEndpoint = String(process.env.ETHEREUM_ENDPOINT);
    const polygonEndpoint = String(process.env.POLYGON_ENDPOINT);
    const nodeEndpoints = [
        'https://0xcore.orbs.com/services/management-service/status',  // for actual production front-end with https
        'http://0xaudit.orbs.com/services/management-service/status', // for dev non https
    ];

    const totalTimeStart = Date.now();

    let s = Date.now()
    const delegatorFullInfoPolygon = await getDelegator('0x17Fe98A222c41217c51C823352537Dc542AD06eF', polygonEndpoint, {is_polygon: true});
    console.log(`Polygon full delegator took ${(Date.now() - s) / 1000.0} seconds`);
    const dFullfilepathPolygon = path.resolve(__dirname, `../data/delegator_full_poygon.json`);
    fs.writeFileSync(dFullfilepathPolygon, toConsole(delegatorFullInfoPolygon));
    const delegatorXlsxPolygon = delegatorToXlsx(delegatorFullInfoPolygon, 'buffer');
    fs.writeFileSync(path.resolve(__dirname, `../data/delegator_full_polygon.xlsx`), delegatorXlsxPolygon);
    // console.log(toConsole(delegatorFullInfoPolygon));

    s = Date.now();
    const delegatorInfo = await getDelegator('0xB4D4f0E476Afe791B26B39985A65B1bC1BBAcdcA', ethereumEndpoint, {read_history: false});
    console.log(`fast delegator took ${(Date.now() - s) / 1000.0} seconds`);
    const dfilepath = path.resolve(__dirname, `../data/delegator.json`);   
    fs.writeFileSync(dfilepath, toConsole(delegatorInfo));
    // console.log(toConsole(delegatorInfo));

    s = Date.now()
    const delegatorFullInfo = await getDelegator('0xB4D4f0E476Afe791B26B39985A65B1bC1BBAcdcA', ethereumEndpoint);
    console.log(`full delegator took ${(Date.now() - s) / 1000.0} seconds`);
    const dFullfilepath = path.resolve(__dirname, `../data/delegator_full.json`);   
    fs.writeFileSync(dFullfilepath, toConsole(delegatorFullInfo));
    const delegatorXlsx = delegatorToXlsx(delegatorFullInfo, 'buffer');
    fs.writeFileSync(path.resolve(__dirname, `../data/delegator_full.xlsx`), delegatorXlsx);
    // console.log(toConsole(delegatorFullInfo));

    s = Date.now()
    const delegatorNoRewardsInfo = await getDelegator('0xB4D4f0E476Afe791B26B39985A65B1bC1BBAcdcA', ethereumEndpoint, {read_rewards_disable: true});
    console.log(`no rewards full delegator took ${(Date.now() - s) / 1000.0} seconds`);
    const dNoRewardsfilepath = path.resolve(__dirname, `../data/delegator_no_rewards.json`);   
    fs.writeFileSync(dNoRewardsfilepath, toConsole(delegatorNoRewardsInfo));
    // console.log(toConsole(delegatorNoRewardsInfo));

    s = Date.now()
    const delegatorOnly50Info = await getDelegator('0xB4D4f0E476Afe791B26B39985A65B1bC1BBAcdcA', ethereumEndpoint, {read_from_block: -50000});
    console.log(`50k delegator took ${(Date.now() - s) / 1000.0} seconds`);
    const dOnly50filepath = path.resolve(__dirname, `../data/delegator_only_50000.json`);   
    fs.writeFileSync(dOnly50filepath, toConsole(delegatorOnly50Info));
    // console.log(toConsole(delegatorFullInfo));

    s = Date.now()
    const delegatorRewardsInfo = await getDelegatorStakingRewards('0xB4D4f0E476Afe791B26B39985A65B1bC1BBAcdcA', ethereumEndpoint);
    console.log(`delegator rewards only took ${(Date.now() - s) / 1000.0} seconds`);
    const dRewardsfilepath = path.resolve(__dirname, `../data/delegator_rewards.json`);   
    fs.writeFileSync(dRewardsfilepath, toConsole(delegatorRewardsInfo));
    // console.log(toConsole(rewards));

    try {
        const guardians = await getGuardians(nodeEndpoints);
        const gsfilepath = path.resolve(__dirname, `../data/guardians.json`);   
        fs.writeFileSync(gsfilepath, toConsole(guardians));
        //console.log(toConsole(guardians));
    } catch (e) {console.log('failed to read guardian list: ' + e.stack)} // nothing to do

    s = Date.now()
    const guardianInfo = await getGuardian('0xc5e624d6824e626a6f14457810e794e4603cfee2', ethereumEndpoint, {read_history: false});
    console.log(`fast guardian took ${(Date.now() - s) / 1000.0} seconds`);
    const gfilepath = path.resolve(__dirname, `../data/guardian.json`);   
    fs.writeFileSync(gfilepath, toConsole(guardianInfo));
    //console.log(toConsole(guardianInfo));

    s = Date.now()
    const guardianFullInfo = await getGuardian('0xc5e624d6824e626a6f14457810e794e4603cfee2', ethereumEndpoint);
    console.log(`full guardian took ${(Date.now() - s) / 1000.0} seconds`);
    const gFullfilepath = path.resolve(__dirname, `../data/guardian_full.json`);   
    fs.writeFileSync(gFullfilepath, toConsole(guardianFullInfo));
    const guardianXlsx = guardianToXlsx(guardianFullInfo, 'buffer');
    fs.writeFileSync(path.resolve(__dirname, `../data/guardian_full.xlsx`), guardianXlsx);
    // console.log(toConsole(guardianFullInfo));

    s = Date.now()
    const guardianNoRewardsInfo = await getGuardian('0xc5e624d6824e626a6f14457810e794e4603cfee2', ethereumEndpoint, {read_rewards_disable: true});
    console.log(`no rewards full guardian took ${(Date.now() - s) / 1000.0} seconds`);
    const gNoRewardsfilepath = path.resolve(__dirname, `../data/guardian_no_rewards.json`);   
    fs.writeFileSync(gNoRewardsfilepath, toConsole(guardianNoRewardsInfo));
    // console.log(toConsole(guardianNoRewardsInfo));

    s = Date.now()
    const guardianOnly50kInfo = await getGuardian('0xc5e624d6824e626a6f14457810e794e4603cfee2', ethereumEndpoint, {read_from_block: -50000});
    console.log(`50k guardian took ${(Date.now() - s) / 1000.0} seconds`);
    const gOnly50kfilepath = path.resolve(__dirname, `../data/guardian_only_50000.json`);   
    fs.writeFileSync(gOnly50kfilepath, toConsole(guardianOnly50kInfo));
    // console.log(toConsole(guardianFullInfo));

    s = Date.now()
    const guardianRewardsInfo = await getGuardianStakingRewards('0xc5e624d6824e626a6f14457810e794e4603cfee2', ethereumEndpoint);
    console.log(`guardian rewards only took ${(Date.now() - s) / 1000.0} seconds`);
    const gRewardsfilepath = path.resolve(__dirname, `../data/guardian_rewards.json`);   
    fs.writeFileSync(gRewardsfilepath, toConsole(guardianRewardsInfo));
    // console.log(toConsole(guardianFullInfo));

    try {
        const overview = await getOverview(nodeEndpoints, ethereumEndpoint);
        const filepath = path.resolve(__dirname, `../data/overview.json`);   
        fs.writeFileSync(filepath, toConsole(overview));
        // console.log(toConsole(overview));
    } catch (e) {console.log('failed to read overview: ' + e.stack)} // nothing to do

    s = Date.now()
    const allDelegators = await getAllDelegators(ethereumEndpoint);
    console.log(`all delegators took ${(Date.now() - s) / 1000.0} seconds`);
    const allDelegatorsFilePath = path.resolve(__dirname, `../data/all_delegators.json`);   
    fs.writeFileSync(allDelegatorsFilePath, toConsole(allDelegators));
    const allDelegatorsXlsx = allDelegatorsToXlsx(allDelegators, 'buffer');
    fs.writeFileSync(path.resolve(__dirname, `../data/all_delegators.xlsx`), allDelegatorsXlsx);
    // console.log(toConsole(allDelegators));

    console.log(`test took ${(Date.now() - totalTimeStart) / 1000.0} seconds`)
}

x().then(()=> process.exit(0)).catch(e => console.log(`${e.stack}`));
