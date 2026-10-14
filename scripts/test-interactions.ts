import { createPublicClient, createWalletClient, http, parseEther, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";
import fs from "fs";

const dep = JSON.parse(fs.readFileSync("live-deployment.json", "utf8"));
const transport = http(dep.rpcUrl);
const publicClient = createPublicClient({ chain: hardhat, transport });

const agentAccount = privateKeyToAccount(dep.accounts.agentKey);
const lenderAccount = privateKeyToAccount(dep.accounts.lenderKey);
const ownerAccount = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");

const agentClient = createWalletClient({ account: agentAccount, chain: hardhat, transport });
const lenderClient = createWalletClient({ account: lenderAccount, chain: hardhat, transport });
const ownerClient = createWalletClient({ account: ownerAccount, chain: hardhat, transport });

// Load ABI
const loadAbi = (name: string) => JSON.parse(fs.readFileSync(`./artifacts/contracts/${name}.sol/${name}.json`, "utf8")).abi;
const MockERC20Abi = loadAbi("MockERC20");
const NaharVaultAbi = loadAbi("NaharVault");
const NaharSandboxAbi = loadAbi("NaharSandbox");
const MockDEXAbi = loadAbi("MockDEX");
const NaharCreditRegistryAbi = loadAbi("NaharCreditRegistry");

async function main() {
  console.log("=== Testing Real On-Chain Interactions ===");
  
  // 1. Check current sandbox balance
  let sbBal = await publicClient.readContract({
    address: dep.contracts.baseToken,
    abi: MockERC20Abi,
    functionName: "balanceOf",
    args: [dep.contracts.sandbox],
  });
  console.log("Initial Sandbox Balance:", formatEther(sbBal), "USDC");

  // 2. Execute an Arbitrage trade (+2%) via sandbox
  // First set MockDEX rate to 10200
  let tx = await ownerClient.writeContract({
    address: dep.contracts.mockDex,
    abi: MockDEXAbi,
    functionName: "setRate",
    args: [10200n],
  });
  await publicClient.waitForTransactionReceipt({ hash: tx });
  console.log("✅ Set MockDEX rate to 10200 (+2%)");

  // Encode MockDEX.swap(baseToken, baseToken, 2500, 2500)
  const { encodeFunctionData } = await import("viem");
  const swapData = encodeFunctionData({
    abi: MockDEXAbi,
    functionName: "swap",
    args: [
      dep.contracts.baseToken,
      dep.contracts.baseToken,
      parseEther("2500"),
      parseEther("2500")
    ]
  });

  tx = await agentClient.writeContract({
    address: dep.contracts.sandbox,
    abi: NaharSandboxAbi,
    functionName: "executeTrade",
    args: [dep.contracts.mockDex, parseEther("2500"), swapData],
  });
  const rc = await publicClient.waitForTransactionReceipt({ hash: tx });
  console.log("✅ Executed Trade on-chain in Block:", rc.blockNumber, "Tx:", tx);

  sbBal = await publicClient.readContract({
    address: dep.contracts.baseToken,
    abi: MockERC20Abi,
    functionName: "balanceOf",
    args: [dep.contracts.sandbox],
  });
  console.log("Post-Trade Sandbox Balance:", formatEther(sbBal), "USDC (Expected 2550)");

  // 3. Reconcile and settle waterfall
  tx = await agentClient.writeContract({
    address: dep.contracts.sandbox,
    abi: NaharSandboxAbi,
    functionName: "settleAndRepay",
    args: [],
  });
  const rcSettle = await publicClient.waitForTransactionReceipt({ hash: tx });
  console.log("✅ Settled Sandbox on-chain in Block:", rcSettle.blockNumber, "Tx:", tx);

  // Check agent credit profile
  const profile = await publicClient.readContract({
    address: dep.contracts.creditRegistry,
    abi: NaharCreditRegistryAbi,
    functionName: "getAgentProfile",
    args: [agentAccount.address],
  });
  console.log("✅ Agent Profile after Settle:", {
    score: profile.creditScore.toString(),
    cycles: profile.successfulCycles.toString(),
    leverage: profile.maxLeverageMultiplier.toString(),
  });

  // Re-open fresh sandbox for the frontend to use
  const JUNIOR_BUFFER = parseEther("500");
  tx = await agentClient.writeContract({
    address: dep.contracts.baseToken,
    abi: MockERC20Abi,
    functionName: "approve",
    args: [dep.contracts.vault, JUNIOR_BUFFER],
  });
  await publicClient.waitForTransactionReceipt({ hash: tx });

  tx = await agentClient.writeContract({
    address: dep.contracts.vault,
    abi: NaharVaultAbi,
    functionName: "openSandbox",
    args: [agentAccount.address, JUNIOR_BUFFER],
  });
  await publicClient.waitForTransactionReceipt({ hash: tx });

  const newSandbox = await publicClient.readContract({
    address: dep.contracts.vault,
    abi: NaharVaultAbi,
    functionName: "activeSandboxOf",
    args: [agentAccount.address],
  });
  console.log("✅ Fresh Sandbox re-opened at:", newSandbox);

  // Update live-deployment.json with the new active sandbox
  dep.contracts.sandbox = newSandbox;
  fs.writeFileSync("live-deployment.json", JSON.stringify(dep, null, 2));
  console.log("✅ live-deployment.json updated with new active sandbox!");
}

main().catch(console.error);
