import _ from 'lodash';

import { extendConfig, task } from "hardhat/config";
import { HardhatConfig, HardhatRuntimeEnvironment, HardhatUserConfig } from "hardhat/types";

import { ethers, ethers as Ethers } from 'ethers';

import { red, bold, gray, green, yellow, cyan } from 'chalk';

import "./type-extensions";
import "@nomiclabs/hardhat-ethers";
import { loadDeployments, normalizePath, normalizePathArray } from "./utils";

import inquirer from 'inquirer';
import Wei, { wei } from '@synthetixio/wei';

const PROMPT_BACK_OPTION = '↩ BACK';

extendConfig(
    (config: HardhatConfig, userConfig: Readonly<HardhatUserConfig>) => {
        config.paths.deployments = normalizePath(
            config,
            userConfig.paths?.deployments,
            'deployments'
        );

        if (!config.external) {
            config.external = { deployments: {}};
        }

        if (userConfig.external?.deployments) {
            for (const key of Object.keys(userConfig.external.deployments)) {
                config.external.deployments[key] = normalizePathArray(
                    config,
                    userConfig.external.deployments[key]
                );
            }
        }
    }
);

task('import-contract', 'Import a contract from etherscan to be used by interact')
.setAction(async (args, hre) => {

});

interface InteractContext {
    hre: HardhatRuntimeEnvironment;
    contracts: {[name: string]: Ethers.Contract};
    signer: Ethers.Signer;
    blockTag: number;

    pickedContract: string|null;
    pickedMethod: string|null;

    currentArgs: any[]|null;
    txnValue: Wei;
};

task('interact', 'Call contracts with CLI')
.addOptionalParam('privateKey', 'Private key to use to sign txs')
.addOptionalParam('publicKey', 'Address to ')
.addOptionalParam('providerUrl', 'The http provider to use for communicating with the blockchain')
.addOptionalParam('blockTag', 'Specify the block tag to interact at, per ethers.js specification')
.setAction(async (args, hre) => {

    if (args.privateKey && args.publicKey) {
        console.log(bold(red('Please specify only one of --private-key and --public-key')));
        return 1;
    }

    const ctx = buildInteractContext(hre, args);

    inquirer.registerPrompt('search-list', require('inquirer-search-list'));

    // -----------------
    // Start interaction
    // -----------------

    await printHeader(ctx);

    while (true) {
        if (!ctx.pickedContract) {
            await pickContract(ctx);
        }
        else if (!ctx.pickedMethod) {
            await pickMethod(ctx);
        }
        else if (!ctx.currentArgs) {
            await queryArgs(ctx);
        }
        else {
            await executeSelection(ctx);
        }
    }
});

function buildInteractContext(hre: HardhatRuntimeEnvironment, args: { providerUrl: string, privateKey?: string, publicKey?: string, blockTag: number }): InteractContext {
    let { providerUrl, privateKey, publicKey, blockTag } = args;

    // load private key
    const envPrivateKey = process.env.DEPLOY_PRIVATE_KEY;

    if (!privateKey && envPrivateKey) {
        privateKey = envPrivateKey;
    }

    if (providerUrl) {

    }

    const provider = providerUrl ?
        new hre.ethers.providers.JsonRpcProvider(providerUrl) :
        new hre.ethers.providers.Web3Provider(hre.network.provider as any);

    const signer = publicKey || !privateKey ? 
        new hre.ethers.VoidSigner(publicKey || hre.ethers.constants.AddressZero, provider) :
        new hre.ethers.Wallet(privateKey!, provider);

    // load contracts
    const deploymentPaths = [];
    deploymentPaths.push(hre.config.paths.deployments);

    if (hre.config.external.deployments && hre.config.external.deployments[hre.network.name]) {
        deploymentPaths.push(...hre.config.external.deployments[hre.network.name]);
    }

    let contracts = {};
    for (const path of deploymentPaths) {
        contracts = {
            ...contracts,
            ...loadContracts(hre, path, provider)
        };
    }

    return {
        signer,
        contracts,
        blockTag,
        hre,

        pickedContract: null,
        pickedMethod: null,
        currentArgs: null,
        txnValue: wei(0),
    };
}

async function printHeader(ctx: InteractContext) {
    console.clear();
    console.log(green(`Interact CLI`));
    console.log(gray('Please review this information:'));
    console.log(
        gray('================================================================================')
    );
    console.log(gray(`> Network: ${ctx.hre.network.name}`));
    console.log(gray(`> Gas price: provider default`));
    console.log(gray(`> Block tag: ${ctx.blockTag || 'latest'}`));

    if (ctx.signer instanceof Ethers.VoidSigner || ctx.blockTag) {
        console.log(gray(`> Read Only: ${await ctx.signer.getAddress()}`));
    } else {
        console.log(yellow(`> Read/Write: ${await ctx.signer.getAddress()}`));
        console.log(yellow(`> Balance of Signer: ${await ctx.signer.getBalance()}`));
    }

    console.log(
        gray('================================================================================')
    );
    console.log('\n');
}

function loadContracts(hre: HardhatRuntimeEnvironment, path: string, provider: Ethers.providers.Provider): {[name: string]: Ethers.Contract} {
    const deployments = loadDeployments(path, hre.network.name, true);
    return _.mapValues(deployments, d => new hre.ethers.Contract(d.address, d.abi, provider));
}

async function printHelpfulInfo(ctx: InteractContext) {
    if (ctx.pickedContract) {
        console.log(gray.inverse(`${ctx.pickedContract} => ${ctx.contracts[ctx.pickedContract!].address}`));
    }
	console.log(gray(`  * Signer: ${await ctx.signer.getAddress()}`));
    console.log('\n');

	/*console.log(gray('  * Recent contracts:'));
	for (let i = 0; i < recentContracts.length; i++) {
		const contract = recentContracts[i];
		console.log(gray(`    ${contract.name}: ${contract.address}`));
	}*/
}

async function pickContract(ctx: InteractContext) {
    const { pickedContract } = await inquirer.prompt([
        {
            type: 'search-list',
            name: 'pickedContract',
            message: 'Pick a CONTRACT:',
            choices: _.keys(ctx.contracts).sort()
        },
    ]);

    ctx.pickedContract = pickedContract;
}

async function pickMethod(ctx: InteractContext) {
    await printHelpfulInfo(ctx);

    const choices = _.keys(ctx.contracts[ctx.pickedContract!].functions).filter(f => f.indexOf('(') != -1).sort();
    choices.unshift(PROMPT_BACK_OPTION);

    const { pickedMethod } = await inquirer.prompt([
        {
            type: 'search-list',
            name: 'pickedMethod',
            message: 'Pick a FUNCTION:',
            choices
        },
    ]);

    if (pickedMethod == PROMPT_BACK_OPTION) {
        ctx.pickedContract = null;
    }
    else {
        ctx.pickedMethod = pickedMethod;
    }
}

async function queryArgs(ctx: InteractContext) {
    const functionInfo = ctx.contracts[ctx.pickedContract!].interface.getFunction(ctx.pickedMethod!);

    const args: any[] = [];

    if (functionInfo.payable) {
        const { value } = await inquirer.prompt([
            {
                type: 'number',
                name: 'value',
                message: 'Function is payable. ETH AMOUNT:',
            },
        ]);

        ctx.txnValue = wei(value);
    }
    else {
        ctx.txnValue = wei(0);
    }

    for (const input of functionInfo.inputs) {

        let rawValue = await promptInputValue(input);

        args.push(rawValue);
    }

    ctx.currentArgs = args;
}

async function executeSelection(ctx: InteractContext) {
    const contract = ctx.contracts[ctx.pickedContract!];
    const functionInfo = contract.interface.getFunction(ctx.pickedMethod!);
    const callData = contract.interface.encodeFunctionData(ctx.pickedMethod!, ctx.currentArgs!);

    if (!functionInfo.constant) {
        let txn: ethers.PopulatedTransaction|null = {};

        // estimate gas
        try {
            txn = await contract.populateTransaction[ctx.pickedMethod!](...ctx.currentArgs!, { from: await ctx.signer.getAddress() });
            const estimatedGas = await contract.estimateGas[ctx.pickedMethod!](...ctx.currentArgs!, { from: await ctx.signer.getAddress() });

            console.log(gray(`  > calldata: ${txn.data}`));
            console.log(gray(`  > estimated gas required: ${estimatedGas}`));
            console.log(gray(`  > gas: ${JSON.stringify(_.pick(txn, 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas'))}`));
            console.log(green(bold('  ✅ txn will succeed')))
        } catch(err) {
            console.log(red('Error: Could not populate transaction (is it failing?)'));
        }

        if (txn?.data) {

        }
        // confirm
        if (!(ctx.signer instanceof Ethers.VoidSigner)) {
            const { confirmation } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'confirmation',
                    message: 'Send transaction?',
                },
            ]);

            if (!confirmation) {
                ctx.pickedMethod = null;
                ctx.currentArgs = null;
                return;
            }
        }

        try {
            const txInfo = await ctx.signer.sendTransaction({
                to: contract.address,
                data: callData,
                value: ctx.txnValue.toBN()
            });
    
            console.log('> hash: ', txInfo.hash);
            console.log('confirming...');
    
            const receipt = await txInfo.wait();

            logTxSucceed(ctx, receipt);
        } catch(err) {
            logTxFail(err);
        }
    }
    else {
        const result = await contract.functions[ctx.pickedMethod!](...ctx.currentArgs!);

        for (let i = 0;i < (functionInfo.outputs?.length || 0);i++) {
            const output = functionInfo.outputs![i];
            console.log(
                cyan(`  ↪ ${output.name || ''}(${output.type}):`),
                printReturnedValue(output, result[i])
            );
        }
    }

    // return to function select
    ctx.pickedMethod = null;
    ctx.currentArgs = null;
}

async function promptInputValue(input: Ethers.utils.ParamType): Promise<any> {
    const name = input.name || input.type;

    let message = name;

    const requiresBytes32Util = input.type.includes('bytes32');
    const isArray = input.type.includes('[]');
    const isNumber = input.type.includes('int');

    if (requiresBytes32Util) {
        message = `${message} (uses toBytes32${
            isArray ? ' - if array, use ["a","b","c"] syntax' : ''
        })`;
    }

    const answer = await inquirer.prompt([
        {
            type: 'input',
            message,
            name,
        },
    ]);

    let processed = answer[name];
    console.log(gray('  > raw inputs:', processed));

    if (isArray) {
        try {
            processed = JSON.parse(processed);
        } catch (err) {
            console.log(red(`Error parsing array input. Please use the indicated syntax.`));
            return promptInputValue(input);
        }
    }

    if (requiresBytes32Util) {
        if (isArray) {
            processed = processed.map((item: string) => Ethers.utils.formatBytes32String(item));
        } else {
            processed = Ethers.utils.formatBytes32String(processed);
        }
    }

    if (isNumber) {
        if (isArray) {
            processed = processed.map((item: string) => parseWeiValue(item));
        } else {
            processed = parseWeiValue(processed);
        }
    }

    if (isArray) {
        processed = processed.map((value: string) => boolify(value));
    } else {
        processed = boolify(processed);
    }

    console.log(
        gray(`  > processed inputs (${isArray ? processed.length : '1'}):`, processed)
    );

    return processed;
}

function parseWeiValue(v: string): Ethers.BigNumber {
    if (v.includes('.')) {
        return wei(v).toBN();
    }
    else {
        return wei(v, 0, true).toBN();
    }
}

function printReturnedValue(output: Ethers.utils.ParamType, value: any): string {
    if (Array.isArray(value)) {
        return value.map(item => printReturnedValue(item, output.baseType)).join(', ');
    } else if (output.type.startsWith('uint') || output.type.startsWith('int')) {
        return `${value.toString()} (${wei(value).toString(5)})`;
    } else if (output.type.startsWith('bytes')) {
        return `${value} (${Buffer.from(value.slice(2), 'hex').toString('utf8')})`;
    } else {
        return value;
    }
}

// Avoid 'false' and '0' being interpreted as bool = true
function boolify(value: any) {
	if (value === 'false' || value === '0') return 0;
	return value;
}



function logTxSucceed(ctx: InteractContext, receipt: Ethers.providers.TransactionReceipt) {
	console.log(green('  ✅ Success'));
	// console.log('receipt', JSON.stringify(receipt, null, 2));

	// Print tx hash
	console.log(gray(`    tx hash: ${receipt.transactionHash}`));

	// Print gas used
	console.log(gray(`    gas used: ${receipt.gasUsed.toString()}`));

	// Print emitted events
	if (receipt.logs && receipt.logs.length > 0) {
        const contractsByAddress = _.keyBy(ctx.contracts, 'address');

		for (let i = 0; i < receipt.logs.length; i++) {
			const log = receipt.logs[i];

			try {
                // find contract matching address of the log
                const logContract = contractsByAddress[log.address];

				const parsedLog = logContract.interface.parseLog(log);
				console.log(gray(`    log ${i}:`), cyan(parsedLog.name));
			} catch (err) {
				console.log(gray(`    log ${i}: unable to decode log - ${JSON.stringify(log)}`));
			}
		}
	}
}

function logTxFail(error: any) {
	console.log(red('  ❌ Error'));

	function findReason(error: any): string {
		if (typeof error === 'string') {
			return error;
		} else {
			if (error.hasOwnProperty('reason')) {
				return error.reason;
			} else if (error.hasOwnProperty('error')) {
				return findReason(error.error);
			}
		}

        return 'unknown';
	}

	const reason = findReason(error);
	if (reason) console.log(red(`    Reason: ${reason}`));

	console.log(gray(JSON.stringify(error, null, 2)));
}