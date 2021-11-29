import { expect } from "chai";
import sinon from 'sinon';
import { ethers } from "ethers";
import { resetHardhatContext } from "hardhat/plugins-testing";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import path from "path";

import inquirer from 'inquirer';

describe("Integration tests examples", function () {

  let hre: HardhatRuntimeEnvironment

  beforeEach(function () {
    process.chdir(path.join(__dirname, "fixture-projects", 'basic'));
    hre = require('hardhat');
  });

  afterEach(function () {
    resetHardhatContext();
  });


  describe("task interact", function () {

    it('task is defined and has correct properties', () => {
      expect(hre.tasks['interact']).to.exist;
    });

    describe('when deployed a contract', () => {
      beforeEach(async () => {
        await hre.run('compile');
        await hre.run('deploy');
      });

      it('can use batch mode for single function call', async () => {

        const result = await hre.run('interact', { batch: true, contract: 'WETH', func: 'balanceOf(address)', args: JSON.stringify([ethers.constants.AddressZero]) });

        expect(result).to.equal('0');
      });

      it('starts up and asks for contract and function', async () => {

        const promptStub = sinon.stub(inquirer, 'prompt')
        
        promptStub
          .onCall(0).returns({ pickedContract: 'WETH' })
          .onCall(1).returns({ pickedFunction: 'balanceOf(address)' })
          .onCall(2).returns({ address: ethers.constants.AddressZero })

        const result = await hre.run('interact', { batch: true });

        expect(result).to.equal('0');
      });

      it('can use batch mode for mutable transaction', async () => {
        const signer = (await hre.ethers.getSigners())[0];

        await hre.run('interact', { batch: true, contract: 'WETH', func: 'deposit', value: 1.2, args: '[]' });

        // call interact again to get the amount deposited
        const deposited = await hre.run('interact', { batch: true, contract: 'WETH', func: 'balanceOf', args: JSON.stringify([signer.address]) });

        expect(deposited).to.equal('1200000000000000000');
      });
    })
  });
});
