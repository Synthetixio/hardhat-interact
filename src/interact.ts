import _ from 'lodash';

import { extendConfig, subtask, task, types } from "hardhat/config";
import { HardhatConfig, HardhatRuntimeEnvironment, HardhatUserConfig } from "hardhat/types";

import { ethers, ethers as Ethers } from 'ethers';

import { red, bold, gray, green, yellow, cyan } from 'chalk';

import "./type-extensions";
import "@nomiclabs/hardhat-ethers";
import { loadDeployments, normalizePath, normalizePathArray } from "./utils";

import prompts from 'prompts';
import Wei, { wei } from '@synthetixio/wei';
import { appendFileSync } from 'fs';

import stagedTransactions from './staged-transactions';

const PROMPT_BACK_OPTION = { title: '↩ BACK' };

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
interface InteractContext {
    hre: HardhatRuntimeEnvironment;
    contracts: {[name: string]: Ethers.Contract};
    blockTag: number;

    signer: ethers.Signer|null;

    impersonate: string|null;
    stagedTransactionDriver: ((txn: Ethers.PopulatedTransaction) => string)|null;
    stagedTransactionOutputFile: string|null;

    pickContract: string|null;
    pickFunction: string|null;

    currentArgs: any[]|null;
    txnValue: Wei;
};

interface InteractTaskArgs {
    providerUrl: string;
    privateKey?: string;
    blockTag: number;

    impersonate?: string;
    driver?: string;
    out?: string;

    batch: boolean;
    contract: string;
    func: string;
    value: string;
    args: string;
}

task('interact', 'Call contracts with CLI')
.addOptionalParam('privateKey', 'Private key to use to sign txs')
.addOptionalParam('impersonate', 'Pretend to be the specified address. Runs transactions read-only, can export result to staged transactions file')
.addOptionalParam('providerUrl', 'The http provider to use for communicating with the blockchain')
.addOptionalParam('blockTag', 'Specify the block tag to interact at, per ethers.js specification', undefined, types.int)
.addOptionalParam('batch', 'Execute one command with no logs except the value, and exit', false, types.boolean)
.addOptionalParam('driver', 'Format to export staged transactions. Either `gnosis-safe`, `csv`, or `curl` are currently supported.', 'csv')
.addOptionalParam('out', 'Path which staged transactions should be written to', 'staged-transactions.txt')
.addOptionalParam('contract', 'Contract to execute')
.addOptionalParam('func', 'Function to execute')
.addOptionalParam('value', 'Amount ETH to send to payable function (in ETH units)', 0, types.float)
.addOptionalParam('args', 'Arguments for contract and function to execute (json formatted)', '', types.string)
.setAction(async (args, hre) => {

    if (args.privateKey && args.impersonate) {
        console.log(bold(red('Please specify only one of --private-key and --public-key')));
        return 1;
    }

    const ctx = await buildInteractContext(hre, args);

    // -----------------
    // Start interaction
    // -----------------

    if (!args.batch) {
        await printHeader(ctx);
    }

    while (true) {
        if (!ctx.pickContract) {
            ctx.pickContract = await hre.run('interact:pick-contract', { contractNames: _.keys(ctx.contracts) });

            if (!ctx.pickContract) {
                return null;
            }
        }
        else if (!ctx.pickFunction) {
            if (!args.batch) {
                await printHelpfulInfo(ctx);
            }

            ctx.pickFunction = await hre.run('interact:pick-function', { contract: ctx.contracts[ctx.pickContract] });

            if (!ctx.pickFunction) {
                ctx.pickContract = null;
            }
        }
        else if (!ctx.currentArgs) {
            const argData = await hre.run('interact:pick-function-args', { func: ctx.contracts[ctx.pickContract].interface.getFunction(ctx.pickFunction!) });

            if (!argData) {
                ctx.pickFunction = null;
            }
            else {
                ctx.currentArgs = argData.args;
                ctx.txnValue = wei(argData.value);
            }
        }
        else {

            const contract = ctx.contracts[ctx.pickContract!];
            const functionInfo = contract.interface.getFunction(ctx.pickFunction!);
        
            let result;
            if (functionInfo.constant) {
                result = await hre.run('interact:query', {
                    contract,
                    functionSignature: ctx.pickFunction,
                    args: ctx.currentArgs,
                    blockTag: ctx.blockTag,
                    log: !args.batch
                });
            }
            else {
                result = await hre.run('interact:execute', {
                    contract,
                    functionSignature: ctx.pickFunction,
                    args: ctx.currentArgs,
                    value: ctx.txnValue.toBN(),
                    log: !args.batch,
                    signer: ctx.signer,
                    impersonate: ctx.impersonate || undefined
                });
            }

            if (args.batch) {
                return result;
            }
        
            // return to function select
            ctx.pickFunction = null;
            ctx.currentArgs = null;
        }
    }
});

async function buildInteractContext(hre: HardhatRuntimeEnvironment, args: InteractTaskArgs): Promise<InteractContext> {
    let { providerUrl, privateKey, impersonate, blockTag } = args;

    // load private key
    const envPrivateKey = process.env.DEPLOY_PRIVATE_KEY;

    if (!privateKey && envPrivateKey) {
        privateKey = envPrivateKey;
    }

    const provider = providerUrl ?
        new hre.ethers.providers.JsonRpcProvider(providerUrl) :
        new hre.ethers.providers.Web3Provider(hre.network.provider as any);

    let signer = null;
    if (privateKey) {
        signer = new hre.ethers.Wallet(privateKey!, provider)
    }
    else {
        const signers = await hre.ethers.getSigners()

        if (signers && signers.length) {
            signer = signers[0];
        }
    }

    // load contracts
    const contracts = await hre.run('interact:load-contracts', { provider });

    return {
        contracts,
        blockTag,
        hre,

        signer,

        impersonate: impersonate || null,
        stagedTransactionDriver: args.driver ? stagedTransactions[args.driver as keyof typeof stagedTransactions] : null,
        stagedTransactionOutputFile: args.out || null,

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
    const signerBalance = ctx.signer ? wei(await ctx.signer.getBalance()) : wei(0);

    console.log(green(`Interact CLI`));
    console.log(gray('Please review this information:'));
    console.log(
        gray('================================================================================')
    );
    console.log(gray(`> Network: ${ctx.hre.network.name}`));
    console.log(gray(`> Gas price: provider default`));
    console.log(gray(`> Block tag: ${ctx.blockTag || 'latest'}`));

    if (ctx.blockTag || ctx.impersonate) {
        console.log(gray(`> Read Only: ${ctx.impersonate}`));
    } else if (ctx.signer) {
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
    else {
        console.log(gray('> No signer specified (check hardhat config or use --private-key)'));
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
	console.log(gray(`  * Signer: ${ctx.impersonate ? ctx.impersonate : (ctx.signer ? await ctx.signer.getAddress() : 'None')}`));
    console.log('\n');

	/*console.log(gray('  * Recent contracts:'));
	for (let i = 0; i < recentContracts.length; i++) {
		const contract = recentContracts[i];
		console.log(gray(`    ${contract.name}: ${contract.address}`));
	}*/
}

subtask('interact:load-contracts', 'Returns `ethers.Contract` objects which can be queried or executed against for this project')
.addOptionalParam('provider', 'ethers.Provider which should be attached to the contract', null, types.any)
.setAction(async ({ provider }: { provider: Ethers.providers.Provider }, hre) => {
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

    return contracts;
});

subtask('interact:pick-contract', 'Shows an interactive UI to select a contract. The selected contract name is returned')
.addParam('contractNames', 'Name of contracts which can be selected', null, types.any)
.addParam('contracts', 'Name of contracts which can be selected', null, types.any)
.setAction(async ({ contractNames }: { contractNames: string[] }) => {
    const { pickedContract } = await prompts.prompt([
        {
            type: 'autocomplete',
            name: 'pickedContract',
            message: 'Pick a CONTRACT:',
            choices: contractNames.sort().map((s) => ({title: s })),
            suggest: suggestBySubtring
        },
    ]);

    return pickedContract;
});

subtask('interact:pick-function', 'Shows an interactive UI to select a function to execute. The selected function signature is returned')
.addParam('contract', 'Contract to select function from', null, types.any)
.setAction(async ({ contract }: { contract: ethers.Contract }) => {
    const functionSignatures = _.keys(contract.functions).filter(f => f.indexOf('(') != -1)

    const choices = functionSignatures.sort().map((s) => ({title: s }));
    choices.unshift(PROMPT_BACK_OPTION);

    const { pickedFunction } = await prompts.prompt([
        {
            type: 'autocomplete',
            name: 'pickedFunction',
            message: 'Pick a FUNCTION:',
            choices,
            suggest: suggestBySubtring
        },
    ]);

    return pickedFunction == PROMPT_BACK_OPTION.title ? null : pickedFunction;
});

subtask('interact:pick-function-args', 'Shows an interactive UI to specify the arguments (and if its payable, the eth to send) for a function. The arguments array is returned')
.addParam('func', 'ethers function fragment to retrieve arguments for', null, types.any)
.setAction(async ({ func }: { func: Ethers.utils.FunctionFragment }) => {
    const args: any[] = [];
    let value: ethers.BigNumber = wei(0).toBN();

    if (func.payable) {
        const { txnValue } = await prompts.prompt([
            {
                type: 'number',
                name: 'txnValue',
                message: 'Function is payable. ETH AMOUNT (in eth units):',
            },
        ]);

        value = wei(txnValue).toBN();
    }

    for (const input of func.inputs) {

        let rawValue = await promptInputValue(input);

        if (!rawValue) {
            return null;
        }

        args.push(rawValue);
    }

    return { args, value };
});

subtask('interact:query', 'Executes a read-only query, returning the result')
.addParam('contract', 'Interact context', null, types.any)
.addParam('functionSignature', 'Which function to query')
.addParam('args', 'Array of arguments to the function call', null, types.any)
.addOptionalParam('blockTag', 'Perform archive query on the given block tag', 'latest', types.any)
.addParam('log', 'Set to `true` to print diagnostic and user-friendly info', false, types.boolean)
.setAction(async ({ contract, functionSignature, args, blockTag, log }: { contract: ethers.Contract, functionSignature: string, args: any[], blockTag: number, log: boolean }, hre: HardhatRuntimeEnvironment) => {

    const functionInfo = contract.interface.getFunction(functionSignature);

    let result = [];
    try {
        result = await contract.functions[functionSignature!](...args, { blockTag });
    } catch(err) {
        console.error('failed query:', err);
        return null;
    }

    if (log) {
        for (let i = 0;i < (functionInfo.outputs?.length || 0);i++) {
            const output = functionInfo.outputs![i];

            console.log(
                cyan(`  ↪ ${output.name || ''}(${output.type}):`),
                printReturnedValue(output, result[i])
            );
        }
    }

    return result;
});

subtask('interact:execute', 'Executes a mutable txn and wait for it to complete, or appends it to staged transactions, returning diagnostic information as necessary')
.addParam('contract', 'Interact context', null, types.any)
.addParam('functionSignature', 'Which function to query')
.addParam('args', 'Array of arguments to the function call', null, types.any)
.addOptionalParam('value', 'Amount of eth to send to a payable function', Ethers.constants.Zero, types.any)
.addOptionalParam('impersonate', 'Account to pretend to run the transaction as for verification and transaction staging')
.addOptionalParam('out', 'File', 'staged-txns.txt')
.addOptionalParam('signer', 'Account to sign with, if the transaction is to be executed immediately', null, types.any)
.addParam('log', 'Set to `true` to print diagnostic and user-friendly info', false, types.boolean)
.setAction(async ({ contract, functionSignature, args, value, log, signer, impersonate, out }: { contract: ethers.Contract, functionSignature: string, args: any[], value: any, log: boolean, signer: Ethers.Signer, impersonate: string, out: string }, hre: HardhatRuntimeEnvironment) => {

    if (!signer) {
        const signers = await hre.ethers.getSigners();
        if (signers && signers.length) {
            signer = await signers[0];
        }
    }

    const callData = contract.interface.encodeFunctionData(functionSignature, args);

    let txn: ethers.PopulatedTransaction|null = {};

    // estimate gas
    try {
        txn = await contract.populateTransaction[functionSignature](...args, { from: impersonate || await signer.getAddress() });
        const estimatedGas = await contract.estimateGas[functionSignature](...args, { from: impersonate || await signer.getAddress() });

        if (log) {
            console.log(gray(`  > calldata: ${txn.data}`));
            console.log(gray(`  > estimated gas required: ${estimatedGas}`));
            console.log(gray(`  > gas: ${JSON.stringify(_.pick(txn, 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas'))}`));
            console.log(green(bold('  ✅ txn will succeed')));
        }
    } catch(err) {
        console.error(red('Error: Could not populate transaction (is it failing?)'));
    }

    if (impersonate) {

        if (log) {
            const { confirmation } = await prompts.prompt([
                {
                    type: 'confirm',
                    name: 'confirmation',
                    message: 'Write staged transaction?',
                },
            ]);

            if (!confirmation) {
                return null;
            }
        }

        // write a staged transaction
        await hre.run('interact:stage-txn', { txn, contract, functionSignature, args, value, out });

        if (log)
            console.log(`> staged transaction appended to ${out}`)
    }
    else if (signer != null) {

        if (log) {
            const { confirmation } = await prompts.prompt([
                {
                    type: 'confirm',
                    name: 'confirmation',
                    message: 'Send transaction?',
                },
            ]);

            if (!confirmation) {
                return null;
            }
        }

        let txInfo;
        try {
            txInfo = await signer.sendTransaction({
                to: contract.address,
                data: callData,
                value: Ethers.BigNumber.from(value)
            });
    
            if (log) {
                console.log('> hash: ', txInfo.hash);
                console.log('confirming...');
            }
    
            const receipt = await txInfo.wait();

            if (log) {
                await logTxSucceed(hre, receipt);
            }

            return receipt.transactionHash;
        } catch(err) {
            logTxFail(err);
            return txInfo?.hash;
        }
    }
    else {
        console.log('not submitting transaction because in read-only mode');
    }
});


subtask('interact:stage-txn', 'Executes a mutable txn and wait for it to complete, or appends it to staged transactions, returning diagnostic information as necessary')
.addParam('txn', 'Transaction to stage', null, types.any)
.addParam('contract', 'Interact context', null, types.any)
.addParam('functionSignature', 'Which function to query')
.addParam('args', 'Array of arguments to the function call', null, types.any)
.addOptionalParam('value', 'Amount of eth to send to a payable function', Ethers.constants.Zero, types.any)
.addOptionalParam('out', 'File to export staged transactions to', 'staged-txns.txt')
.setAction(async ({ txn, out }: { txn: Ethers.PopulatedTransaction, out: string }) => {
    appendFileSync(out, `${stagedTransactions.csv(txn)}\n`);
});

async function promptInputValue(input: Ethers.utils.ParamType): Promise<any> {
    const name = input.name || input.type;

    let message = input.name ? `${input.name} (${input.type})` : input.type;

    for(let i = 0;i < 5;i++) {
        try {
            const answer = await prompts.prompt([
                {
                    type: 'text',
                    message,
                    name,
                },
            ]);

            if (!answer[name]) {
                return null;
            }

            // if there is a problem this will throw and user will be forced to re-enter data
            return parseInput(input, answer[name]);
        } catch(err) {
            console.error('invalid input: ', err);
        }
    }
}

function parseInput(input: Ethers.utils.ParamType, rawValue: string): any {
    const requiresBytes32Util = input.type.includes('bytes32');
    const isArray = input.type.includes('[]');
    const isNumber = input.type.includes('int');

    let processed = isArray ? JSON.parse(rawValue) : rawValue;
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

    //const processed = preprocessInput(input, type, hre);
    if (processed !== rawValue) {

        console.log(
            gray(`  > processed inputs (${isArray ? processed.length : '1'}):`, processed)
        );
    }
  
    // Encode user's input to validate it
    Ethers.utils.defaultAbiCoder.encode([input.type], [processed]);
  
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
    if (output?.baseType === 'tuple') {  // handle structs        
        return '\n' + output?.components.map(
            (comp, ind) => `${comp.name}: ${printReturnedValue(comp, value[ind])}`
        ).join('\n');
    } else if (output?.baseType === 'array' && Array.isArray(value)) {  // handle arrays
        return value.map(item => printReturnedValue(output.arrayChildren, item)).join(', ');
    } else if (output?.type.startsWith('uint') || output?.type.startsWith('int')) {
        return `${value.toString()} (${wei(value).toString(5)})`;
    } else if (output?.type.startsWith('bytes')) {
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



async function logTxSucceed(hre: HardhatRuntimeEnvironment, receipt: Ethers.providers.TransactionReceipt) {
	console.log(green('  ✅ Success'));
	// console.log('receipt', JSON.stringify(receipt, null, 2));

	// Print tx hash
	console.log(gray(`    tx hash: ${receipt.transactionHash}`));

	// Print gas used
	console.log(gray(`    gas used: ${receipt.gasUsed.toString()}`));

	// Print emitted events
	if (receipt.logs && receipt.logs.length > 0) {
        const contractsByAddress = _.keyBy(await hre.run('interact:load-contracts'), 'address');

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

        return error.toString();
	}

	const reason = findReason(error);
	if (reason) console.log(red(`    Reason: ${reason}`));

	console.log(gray(JSON.stringify(error, null, 2)));
}

// filters choices by subtrings that don't have to be continuous e.g. 'ybtc' will match 'SynthsBTC'
const suggestBySubtring = (input: string, choices: [{ title: string }]) =>
Promise.resolve(choices.filter(choice => { 
    const titleStr = choice.title.toLowerCase();
    let index = 0;
    for (let c of input.toLowerCase()) {
        index = titleStr.indexOf(c, index);
        if (index === -1) {
            return false; // not found
        } else {
            index += 1; // start from next index
        }
    }
    return true;
}))
