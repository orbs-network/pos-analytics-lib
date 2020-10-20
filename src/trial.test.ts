import _ from 'lodash';
import fs from 'fs';
import path from 'path';

import { getDelegator } from './delegator';
import { getGuardian, getGuardians } from './guardian';
import { getOverview } from './overview';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toConsole(x:any){ return JSON.stringify(x, null, 2)}

async function x() {
    const ethereumEndpoint = 'https://mainnet.infura.io/v3/9679dc4f2d724f7997547f05f769d74e';
    const nodeEndpoints = [
        'http://54.168.36.177/services/management-service/status',
        'http://52.20.37.155/services/management-service/status',
        'http://54.241.122.39/services/management-service/status'
    ];

    const delegatorInfo = await getDelegator('0xB4D4f0E476Afe791B26B39985A65B1bC1BBAcdcA', ethereumEndpoint);
    const dfilepath = path.resolve(__dirname, `../data/delegator.json`);   
    fs.writeFileSync(dfilepath, toConsole(delegatorInfo));
    // console.log(toConsole(delegatorInfo));

    const guardians = await getGuardians(nodeEndpoints);
    const gsfilepath = path.resolve(__dirname, `../data/guardians.json`);   
    fs.writeFileSync(gsfilepath, toConsole(guardians));
    //console.log(toConsole(guardians));

    const guardianInfo = await getGuardian('0xf7ae622c77d0580f02bcb2f92380d61e3f6e466c', ethereumEndpoint);
    const gfilepath = path.resolve(__dirname, `../data/guardian.json`);   
    fs.writeFileSync(gfilepath, toConsole(guardianInfo));
    //console.log(toConsole(guardianInfo));

    const overview = await getOverview(nodeEndpoints, ethereumEndpoint);
    const filepath = path.resolve(__dirname, `../data/overview.json`);   
    fs.writeFileSync(filepath, toConsole(overview));
    // console.log(toConsole(overview));
}

x().then(()=> process.exit(0)).catch(e => console.log(`eee ${e}, ${e.stack}`));
