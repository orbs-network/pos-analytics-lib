import _ from 'lodash';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

import { getDelegator } from './delegator';
import { getGuardian, getGuardians } from './guardian';
import { getOverview } from './overview';
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

    const s = Date.now()

    const delegatorInfo = await getDelegator('0xB4D4f0E476Afe791B26B39985A65B1bC1BBAcdcA', ethereumEndpoint);
    const dfilepath = path.resolve(__dirname, `../data/delegator.json`);   
    fs.writeFileSync(dfilepath, toConsole(delegatorInfo));
    // console.log(toConsole(delegatorInfo));

    const guardians = await getGuardians(nodeEndpoints);
    const gsfilepath = path.resolve(__dirname, `../data/guardians.json`);   
    fs.writeFileSync(gsfilepath, toConsole(guardians));
    //console.log(toConsole(guardians));

    const guardianInfo = await getGuardian('0xc5e624d6824e626a6f14457810e794e4603cfee2', ethereumEndpoint);
    const gfilepath = path.resolve(__dirname, `../data/guardian.json`);   
    fs.writeFileSync(gfilepath, toConsole(guardianInfo));
    //console.log(toConsole(guardianInfo));

    const overview = await getOverview(nodeEndpoints, ethereumEndpoint);
    const filepath = path.resolve(__dirname, `../data/overview.json`);   
    fs.writeFileSync(filepath, toConsole(overview));
    //console.log(toConsole(overview));

    console.log(`took ${(Date.now() - s) / 1000.0} seconds`)
}

x().then(()=> process.exit(0)).catch(e => console.log(`${e.stack}`));
