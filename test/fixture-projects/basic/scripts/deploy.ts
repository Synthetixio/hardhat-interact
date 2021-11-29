import { existsSync, mkdirSync } from "fs";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const { writeFileSync } = require("fs");

export async function run(hre: HardhatRuntimeEnvironment) {
    // We get the contract to deploy
    const WETH = await hre.ethers.getContractFactory("WETH");
    const weth = await WETH.deploy();
  
    console.log('WETH deployed to:', weth.address);

    if (!existsSync('deployments')) {
        mkdirSync('deployments');
    }
    if (!existsSync('deployments/hardhat')) {
        mkdirSync('deployments/hardhat');
    }

    writeFileSync('deployments/hardhat/WETH.json', JSON.stringify({
        address: weth.address,
        abi: JSON.parse(weth.interface.format('json') as string)
    }))
}
  