/**
 * Copyright 2020 the pos-analytics authors
 * This file is part of the pos-analytics library in the Orbs project.
 *
 * This source code is licensed under the MIT license found in the LICENSE file in the root directory of this source tree.
 * The above notice should be included in all copies or substantial portions of the software.
 */

import _ from 'lodash';
import BigNumber from 'bignumber.js';
import fetch from 'node-fetch';
import { retry } from 'ts-retry-promise';
import { PosOptions } from './model';
import { getStartOfPoSBlock, getStartOfRewardsBlock } from './eth-helpers';

export const DECIMALS = '1e18';
export function bigToNumber(n: BigNumber):number {
  return n.dividedBy(DECIMALS).toNumber();
}

// returns UTC clock time in seconds (similar to unix timestamp / Ethereum block time / RefTime)
export function getCurrentClockTime() {
  return Math.round(new Date().getTime() / 1000);
}

export async function fetchJson(url: string) {
  return retry(
    async () => {
      const response = await fetch(url, { timeout: 5000 });
      if (response.ok && String(response.headers.get('content-type')).toLowerCase().includes('application/json')) {
        try {
          const res = await response.json();
          if (res.error) {
            throw new Error(`Invalid response for url '${url}`);
          }
          return res;
        } catch (e) {
          throw new Error(`Invalid response for url '${url}`);
        }  
      } else {
        throw new Error(`Invalid response for url '${url}': Status Code: ${response.status}, Content-Type: ${response.headers.get('content-type')}, Content: ${await response.text()}`);
      }
    },
    { retries: 3, delay: 300 }
  );
}

function byte(value: number, byteIdx: number) {
  const shift = byteIdx * 8;
  return ((value & (0xff << shift)) >> shift) & 0xff;
}

export function getIpFromHex(ipStr: string): string {
  const ipBytes = Number(ipStr);
  return byte(ipBytes, 3) + '.' + byte(ipBytes, 2) + '.' + byte(ipBytes, 1) + '.' + byte(ipBytes, 0);
}

export function parseOptions(input?: any): PosOptions {
  const read_stake = true;
  const read_stake_from = getStartOfPoSBlock().number;
  const read_rewards = new Boolean(input?.read_rewards).valueOf();
  const read_rewards_from = parseNumber(getStartOfRewardsBlock().number, input?.read_rewards_from);

  return {
    read_stake,
    read_stake_from,
    read_rewards,
    read_rewards_from,
  };
}

function parseNumber(defaultValue: number, input?: any): number {
  if (!_.isNumber(input)) {
    return defaultValue;
  } else {
    const r = new Number(input).valueOf();
    return  ( r === 0 || r === -1) ? defaultValue : r
  }
}