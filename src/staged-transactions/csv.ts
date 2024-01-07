import { ethers } from 'ethers';

export default function stageCsv(txn: ethers.ContractTransaction): string {
    return `${txn.to},${txn.value || 0},${txn.data}`;
}
