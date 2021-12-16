import { expect } from "chai";
import sinon from 'sinon';
import { ethers } from "ethers";
import { resetHardhatContext } from "hardhat/plugins-testing";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import path from "path";

import prompts from 'prompts';
import { readFileSync } from "fs";

describe("task interact", function () {

  let hre: HardhatRuntimeEnvironment

  beforeEach(function () {
    process.chdir(path.join(__dirname, "fixture-projects", 'basic'));
    hre = require('hardhat');
  });

  afterEach(function () {
    resetHardhatContext();
  });


  describe("interact", function () {

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

        expect(result[0].toString()).to.equal('0');
      });

      it('starts up and asks for contract and function', async () => {

        const promptStub = sinon.stub(prompts , 'prompt');
        
        promptStub
          .onCall(0).returns({ pickedContract: 'WETH' })
          .onCall(1).returns({ pickedFunction: 'balanceOf(address)' })
          .onCall(2).returns({ address: ethers.constants.AddressZero })

        const result = await hre.run('interact', { batch: true });

        expect(result[0].toString()).to.equal('0');
      });

      describe('write mode', () => {
        it('can use batch mode for mutable transaction', async () => {
          const signer = (await hre.ethers.getSigners())[0];
  
          await hre.run('interact', { batch: true, contract: 'WETH', func: 'deposit', value: 1.2, args: '[]' });
  
          // call interact again to get the amount deposited
          const deposited = await hre.run('interact', { batch: true, contract: 'WETH', func: 'balanceOf', args: JSON.stringify([signer.address]) });
  
          expect(deposited[0].toString()).to.equal('1200000000000000000');
        });
      });

      describe('read only mode', () => {
        it('can output staged transactions file', async () => {
          const signer = (await hre.ethers.getSigners())[0];
  
          await hre.run('interact', {
            batch: true, 

            impersonate: signer.address,
            driver: 'csv',
            out: 'staged-txns.txt',

            contract: 'WETH', 
            func: 'deposit', 
            value: 1.2, 
            args: '[]' 
          });
  
          // should have output staged transactions file
          const data = readFileSync('staged-txns.txt');
  
          expect(data.toString()).to.contain('0x5FbDB2315678afecb367f032d93F642f64180aa3,0,0xd0e30db0');
        });
      });
    })
  });
});
