import { HardhatConfig } from "hardhat/types";
import fs from 'fs';
import path from 'path';

export function normalizePathArray(config: HardhatConfig, paths: string[]): string[] {
    const newArray: string[] = [];
    for (const value of paths) {
        if (value) {
            newArray.push(normalizePath(config, value, value));
        }
    }
    return newArray;
}

export function normalizePath(
    config: HardhatConfig,
    userPath: string | undefined,
    defaultPath: string
  ): string {
    if (userPath === undefined) {
        userPath = path.join(config.paths.root, defaultPath);
    } else {
        if (!path.isAbsolute(userPath)) {
            userPath = path.normalize(path.join(config.paths.root, userPath));
        }
    }
    return userPath;
}

// adopted from hardhat-deploy's function: https://github.com/wighawag/hardhat-deploy/blob/f96f725a9f5ac46493a7cc18e95f1fb6258f48c2/src/utils.ts
export const traverse = function (
    dir: string,
    result: any[] = [],
    topDir?: string,
    filter?: (name: string, stats: any) => boolean // TODO any is Stats
  ): Array<{
    name: string;
    path: string;
    relativePath: string;
    mtimeMs: number;
    directory: boolean;
  }> {
    fs.readdirSync(dir).forEach((name) => {
      const fPath = path.resolve(dir, name);
      const stats = fs.statSync(fPath);
      if ((!filter && !name.startsWith('.')) || (filter && filter(name, stats))) {
        const fileStats = {
          name,
          path: fPath,
          relativePath: path.relative(topDir || dir, fPath),
          mtimeMs: stats.mtimeMs,
          directory: stats.isDirectory(),
        };
        if (fileStats.directory) {
          result.push(fileStats);
          return traverse(fPath, result, topDir || dir, filter);
        }
        result.push(fileStats);
      }
    });
    return result;
};

export function loadDeployments(
    deploymentsPath: string,
    subPath: string,
    onlyABIAndAddress?: boolean,
    expectedChainId?: string,
    truffleChainId?: string
): {[name: string]: { address: string, abi: any}} {
    const deploymentsFound: {[name: string]: any} = {};
    const deployPath = path.join(deploymentsPath, subPath);
  
    let filesStats;
    try {
      filesStats = traverse(
        deployPath,
        undefined,
        undefined,
        (name) => !name.startsWith('.') && name !== 'solcInputs'
      );
    } catch (e) {
      // console.log('no folder at ' + deployPath);
      return {};
    }
    if (filesStats.length > 0) {
      if (expectedChainId) {
        const chainIdFilepath = path.join(deployPath, '.chainId');
        if (fs.existsSync(chainIdFilepath)) {
          const chainIdFound = fs.readFileSync(chainIdFilepath).toString().trim();
          if (expectedChainId !== chainIdFound) {
            throw new Error(
              `Loading deployment in folder '${deployPath}' (with chainId: ${chainIdFound}) for a different chainId (${expectedChainId})`
            );
          }
        } else {
          throw new Error(
            `with hardhat-deploy >= 0.6 you are expected to create a '.chainId' file in the deployment folder`
          );
        }
      }
    }
    let fileNames: string[] = filesStats.map((a) => a.relativePath);
    fileNames = fileNames.sort((a, b) => {
      if (a < b) {
        return -1;
      }
      if (a > b) {
        return 1;
      }
      return 0;
    });
  
    for (const fileName of fileNames) {
      if (fileName.substr(fileName.length - 5) === '.json') {
        const deploymentFileName = path.join(deployPath, fileName);
        let deployment = JSON.parse(
          fs.readFileSync(deploymentFileName).toString()
        );
        
        if (!deployment.address && deployment.networks) {
          if (truffleChainId && deployment.networks[truffleChainId]) {
            // TRUFFLE support
            const truffleDeployment = deployment as any; // TruffleDeployment;
            deployment.address =
              truffleDeployment.networks[truffleChainId].address;
            deployment.transactionHash =
              truffleDeployment.networks[truffleChainId].transactionHash;
          }
        }
        if (onlyABIAndAddress) {
          deployment = {
            address: deployment.address,
            abi: deployment.abi,
            linkedData: deployment.linkedData,
          };
        }
        const name = fileName.slice(0, fileName.length - 5);
        // console.log('fetching ' + deploymentFileName + '  for ' + name);
  
        deploymentsFound[name] = deployment;
      }
    }
    return deploymentsFound;
  }