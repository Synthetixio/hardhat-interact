import { ethers } from "ethers";


export default function stageGnosisSafe(txn: ethers.PopulatedTransaction): string {
    return `send_custom ${txn.to} ${txn.value || 0} ${txn.data}`;
}