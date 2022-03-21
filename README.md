# hardhat-interact

_Run queries and transactions against contracts using a handy CLI which integrates with your deployments._

A [Hardhat](https://hardhat.org) plugin.

## What

This plugin implements a CLI to allow you to run read or write queries against your deployed contracts on any network! It uses deployment manifests exported in either hardhat or `truffle` format. This plugin also includes a command to import arbitrary contracts from etherscan as needed.

## Installation

```bash
npm install --save-dev hardhat-interact @nomiclabs/hardhat-ethers
```

Import the plugin in your `hardhat.config.js`:

```js
require("hardhat-interact");
```

Or if you are using TypeScript, in your `hardhat.config.ts`:

```ts
import "hardhat-interact";
```

## Required plugins

- [@nomiclabs/hardhat-ethers](https://github.com/nomiclabs/hardhat/tree/master/packages/hardhat-ethers)

## Tasks

This plugin adds the _interact_ task to Hardhat:

```
$ npx hardhat --network mainnet interact

Interact CLI
Please review this information:
================================================================================
> Network: mainnet
> Gas price: provider default
> Block tag: latest
> Read Only: 0x0000000000000000000000000000000000000000
================================================================================


? Pick a CONTRACT: (Press <enter> to submit)
❯ AddressResolver
  CollateralManager
  CollateralManagerState
  CollateralShort
  CollateralUtil
  DappMaintenance
  DebtCache
(Move up and down to reveal more choices)
```

Note that the network specified by `--network` above must exist in hardhat configuration, and the network should have a preexisting deployment of your contracts.

Follow the on-screen instructions to select a contract, then a function, and finally the arguments. If its read-only, you can choose to view the return value of the function. If it is a writable, state-changing function, you will be prompted to sign the transaction and submit it to the network.

The interact command supports a few command line arguments. To see an updated list, use `npx hardhat interact --help`.

### The `import-contracts` task

It is often desirable to pull arbitrary 3rd party contract definitions into your project in order to interact with them. To simplify this process,
`hardhat-interact` bundles a command, `import-contracts` to read the definitions from etherscan and insert them into your deployment directory for immediate use.

To use, you just need the contract address:

```
$ npx hardhat --network mainnet import-contract 0x7c22547779c8aa41bae79e03e8383a0befbcecf0
contract deployment artifact Wrapper.json written successfully
```

Now you can use the contract with `interact` like you would any other.

For more options, use `--help`.

## Configuration

This plugin extends the `ProjectPathsUserConfig` object with an optional
`deployments` field. This field specifies the location of the deployment artifacts (either `hardhat-deploy` or `truffle` compatible) within your repository. By default, this value is `./deployments/`.

This is an example of how to set it:

```js
module.exports = {
  paths: {
    deployments: "publish/deployed",
  },
};
```

## Development

In order to work on the plugin vs. a real set of contracts (e.g. Synthetix contracts):

1. git clone and npm install this repo
2. in one terminal run `npm run watch` to build on changes
3. in the repo that's using the plugin change `require('hardhat-interact');` to `require('/path/to/your/local/hardhat-interact/dist/src');`
4. in second terminal run the chain (e.g. mainnet fork) with the contracts (e.g. `npm run fork:ovm` in synthetix folder)
5. finally, in third terminal run the interact tool e.g. `npx hardhat --network mainnet-ovm interact --provider-url http://localhost:8545`
