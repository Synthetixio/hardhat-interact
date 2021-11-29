import _ from 'lodash';

import { extendConfig, task, types } from "hardhat/config";
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

    pickContract: string|null;
    pickFunction: string|null;

    currentArgs: any[]|null;
    txnValue: Wei;
};

interface InteractTaskArgs {
    providerUrl: string;
    privateKey?: string;
    publicKey?: string;
    blockTag: number;

    batch: boolean;
    contract: string;
    func: string;
    value: string;
    args: string;
}

task('interact', 'Call contracts with CLI')
.addOptionalParam('privateKey', 'Private key to use to sign txs')
.addOptionalParam('publicKey', 'Address to ')
.addOptionalParam('providerUrl', 'The http provider to use for communicating with the blockchain')
.addOptionalParam('blockTag', 'Specify the block tag to interact at, per ethers.js specification')
.addOptionalParam('batch', 'Execute one command with no logs except the value, and exit', false, types.boolean)
.addOptionalParam('contract', 'Contract to execute')
.addOptionalParam('func', 'Function to execute')
.addOptionalParam('value', 'Amount ETH to send to payable function (in ETH units)', 0, types.float)
.addOptionalParam('args', 'Arguments for contract and function to execute (json formatted)', '', types.string)
.setAction(async (args, hre) => {

    if (args.privateKey && args.publicKey) {
        console.log(bold(red('Please specify only one of --private-key and --public-key')));
        return 1;
    }

    const ctx = await buildInteractContext(hre, args);

    inquirer.registerPrompt('search-list', require('inquirer-search-list'));

    // -----------------
    // Start interaction
    // -----------------

    if (!args.batch) {
        await printHeader(ctx);
    }

    while (true) {
        if (!ctx.pickContract) {
            await pickContract(ctx);
        }
        else if (!ctx.pickFunction) {
            if (!args.batch) {
                await printHelpfulInfo(ctx);
            }

            await pickFunction(ctx);
        }
        else if (!ctx.currentArgs) {
            await queryArgs(ctx);
        }
        else {
            const result = await executeSelection(ctx, args.batch);

            if (args.batch) {
                return result;
            }
        }
    }
});

async function buildInteractContext(hre: HardhatRuntimeEnvironment, args: InteractTaskArgs): Promise<InteractContext> {
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

    const signer = publicKey ? 
        new hre.ethers.VoidSigner(publicKey || hre.ethers.constants.AddressZero, provider) : // use signer from public key (can't actually sign)
            (privateKey ?
                new hre.ethers.Wallet(privateKey!, provider) :        // use signer from provided private key
                (await hre.ethers.getSigners())[0])                   // use default signer

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

        pickContract: args.contract || null,
        pickFunction: args.func || null,
        currentArgs: args.args ? JSON.parse(args.args) : null,
        txnValue: wei(args.value || 0),
    };
}

async function printHeader(ctx: InteractContext) {

    // retrieve balance of the signer address
    // this isnt always necessary but it serves as a nice test that the provider is working
    // and prevents the UI from lurching later if its queried later
    const signerBalance = wei(await ctx.signer.getBalance());

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

        if(signerBalance.gt(1)) {
            console.log(green(`> Signer Balance: ${signerBalance.toString(2)}`));
        }
        else if (signerBalance.gt(0.1)) {
            console.log(yellow(`> Signer Balance: ${signerBalance.toString(4)}`));
        }
        else {
            console.log(red(`> WARNING! Low signer balance: ${signerBalance.toString(4)}`));
        }
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
    if (ctx.pickContract) {
        console.log(gray.inverse(`${ctx.pickContract} => ${ctx.contracts[ctx.pickContract!].address}`));
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

    ctx.pickContract = pickedContract;
}

async function pickFunction(ctx: InteractContext) {
    const choices = _.keys(ctx.contracts[ctx.pickContract!].functions).filter(f => f.indexOf('(') != -1).sort();
    choices.unshift(PROMPT_BACK_OPTION);

    const { pickedFunction } = await inquirer.prompt([
        {
            type: 'search-list',
            name: 'pickedFunction',
            message: 'Pick a FUNCTION:',
            choices
        },
    ]);

    if (pickedFunction == PROMPT_BACK_OPTION) {
        ctx.pickContract = null;
    }
    else {
        ctx.pickFunction = pickedFunction;
    }
}

async function queryArgs(ctx: InteractContext) {
    const functionInfo = ctx.contracts[ctx.pickContract!].interface.getFunction(ctx.pickFunction!);

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

async function executeSelection(ctx: InteractContext, batch: boolean) {
    const contract = ctx.contracts[ctx.pickContract!];
    const functionInfo = contract.interface.getFunction(ctx.pickFunction!);
    const callData = contract.interface.encodeFunctionData(ctx.pickFunction!, ctx.currentArgs!);

    let returned: string|null = null;

    if (!functionInfo.constant) {
        let txn: ethers.PopulatedTransaction|null = {};

        // estimate gas
        try {
            txn = await contract.populateTransaction[ctx.pickFunction!](...ctx.currentArgs!, { from: await ctx.signer.getAddress() });
            const estimatedGas = await contract.estimateGas[ctx.pickFunction!](...ctx.currentArgs!, { from: await ctx.signer.getAddress() });

            if (!batch) {
                console.log(gray(`  > calldata: ${txn.data}`));
                console.log(gray(`  > estimated gas required: ${estimatedGas}`));
                console.log(gray(`  > gas: ${JSON.stringify(_.pick(txn, 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas'))}`));
                console.log(green(bold('  ✅ txn will succeed')));
            }
        } catch(err) {
            console.error(red('Error: Could not populate transaction (is it failing?)'));
        }

        // confirm
        if (!(ctx.signer instanceof Ethers.VoidSigner) && !batch) {
            const { confirmation } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'confirmation',
                    message: 'Send transaction?',
                },
            ]);

            if (!confirmation) {
                ctx.pickFunction = null;
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
    
            if (!batch) {
                console.log('> hash: ', txInfo.hash);
                console.log('confirming...');
            }
    
            const receipt = await txInfo.wait();

            if (!batch) {
                logTxSucceed(ctx, receipt);
            }
            else {
                console.log(receipt.transactionHash);
            }
        } catch(err) {
            logTxFail(err);
        }
    }
    else {
        const result = await contract.functions[ctx.pickFunction!](...ctx.currentArgs!);

        for (let i = 0;i < (functionInfo.outputs?.length || 0);i++) {
            const output = functionInfo.outputs![i];

            if (batch) {
                console.log(result[i].toString());
                returned = result[0].toString();
            }
            else {
                console.log(
                    cyan(`  ↪ ${output.name || ''}(${output.type}):`),
                    printReturnedValue(output, result[i])
                );
            }
        }
    }

    // return to function select
    ctx.pickFunction = null;
    ctx.currentArgs = null;

    return returned;
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
             
                for (let i = 0;i < (parsedLog.args.length || 0);i++) {
                    const output = parsedLog.args[i];
                    const paramType = logContract.interface.getEvent(parsedLog.name).inputs[i];

                    console.log(
                        cyan(`  ↪ ${output.name || ''}(${output.type}):`),
                        printReturnedValue(paramType, output)
                    );
                }
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