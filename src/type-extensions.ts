// To extend one of Hardhat's types, you need to import the module where it has been defined, and redeclare it.
import 'hardhat/types/config';

declare module 'hardhat/types/config' {
    interface HardhatUserConfig {
        external?: {
            deployments?: {
                [networkName: string]: string[];
            };
        };
    }

    interface HardhatConfig {
        external: {
            deployments: {
                [networkName: string]: string[];
            };
        };
    }

    interface ProjectPathsUserConfig {
        deployments?: string;
    }

    interface ProjectPathsConfig {
        deployments: string;
    }

    // from hardhat-ignition
    export interface ProjectPathsUserConfig {
        ignition?: string;
    }
    export interface ProjectPathsConfig {
        ignition?: string;
    }
}
