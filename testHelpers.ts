import { resetHardhatContext } from "hardhat/plugins-testing";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import path from "path";

export function useEnvironment(fixtureProjectName: string): () => HardhatRuntimeEnvironment {
  let hre: HardhatRuntimeEnvironment

  beforeEach(function () {
    process.chdir(path.join(__dirname, "fixture-projects", fixtureProjectName));
    hre = require('hardhat');
  });

  afterEach(function () {
    resetHardhatContext();
  });

  return () => hre;
}
