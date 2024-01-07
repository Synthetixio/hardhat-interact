import axios from 'axios';
import { ethers } from 'ethers';
import { writeFileSync } from 'fs';
import { mkdirpSync } from 'fs-extra';
import { task } from 'hardhat/config';
import path from 'path';

task('import-contract', 'Import address and ABI definition for a contract to be called with `interact`')
    .addOptionalParam('etherscanUrl', 'Connect to etherscan API at this URL')
    .addOptionalParam('name', 'Label for the download contract definition. Uses Etherscan provided name if not defined')
    .addOptionalPositionalParam('address', 'Contract address to import')
    .setAction(async (args, hre) => {
        const etherscanUrl = args.etherscanUrl || 'https://api.etherscan.io';
        const address = args.address;

        const name = args.name;

        if (!ethers.isAddress(address)) {
            console.error('Provided address is invalid:', address);
            return null;
        }

        const queryUrl = `${etherscanUrl}/api?module=contract&action=getsourcecode&address=${address}`;

        const res = await axios.get(queryUrl);

        const fileName = `${name || res.data.result[0].ContractName}.json`;
        const dirname = path.join(hre.config.paths.deployments, hre.network.name);

        mkdirpSync(dirname);
        writeFileSync(
            path.join(dirname, fileName),
            JSON.stringify({
                address,
                abi: JSON.parse(res.data.result[0].ABI),
            })
        );

        console.log(`contract deployment artifact ${fileName} written successfully`);

        return path.join(dirname, fileName);
    });
