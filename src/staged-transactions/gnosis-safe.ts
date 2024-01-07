import { ethers } from 'ethers';

export default function stageGnosisSafe(txn: ethers.ContractTransaction): string {
    return `send_custom ${txn.to} ${txn.value || 0} ${txn.data}`;
}
