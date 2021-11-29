// We load the plugin here.
import { task } from "hardhat/config";
import { HardhatUserConfig } from "hardhat/types";

import { run as runDeploy } from './scripts/deploy';

import "../../../";

task('deploy', 'Deploy the contract')
.setAction(async (_, hre) => {
  await runDeploy(hre);
});

const config: HardhatUserConfig = {
  solidity: "0.7.3",
  defaultNetwork: "hardhat",
};

export default config;
