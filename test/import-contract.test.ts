import { expect } from "chai";
import sinon from 'sinon';
import { ethers } from "ethers";
import { resetHardhatContext } from "hardhat/plugins-testing";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import path from "path";

import axios from 'axios';
import { existsSync, readFileSync } from "fs";

describe("task interact", function () {

  let hre: HardhatRuntimeEnvironment

  before(function () {
    // fake etherscan response
    const returnData = JSON.parse(readFileSync(__dirname + '/data/etherscan-getsourcecode.json').toString('utf8'));
    sinon.stub(axios, 'get').returns({ data: returnData } as any);
  })

  beforeEach(function () {
    process.chdir(path.join(__dirname, "fixture-projects", 'basic'));
    hre = require('hardhat');
  });

  afterEach(function () {
    resetHardhatContext();
  });


  describe("import-contract", function () {
    it('task is defined and has correct properties', () => {
      expect(hre.tasks['import-contract']).to.exist;
    });

    it('downloads contract from etherscan', async () => {
      const outputtedFile = await hre.run('import-contract', {
        name: 'TestContract',
        address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      });

      expect(outputtedFile).to.equal(hre.config.paths.deployments + '/hardhat/TestContract.json');
      expect(existsSync(outputtedFile)).to.be.true;

      const contents = JSON.parse(readFileSync(outputtedFile).toString());

      expect(contents.address).to.equal('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2');
      expect(contents.abi.length).to.be.gt(2);
    });

    it('detects name of contract from etherscan', async () => {
      const outputtedFile = await hre.run('import-contract', {
        address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      });

      expect(outputtedFile).to.equal(hre.config.paths.deployments + '/hardhat/WETH9.json');
    });
  });
});
