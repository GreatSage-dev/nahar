import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";
import fs from "fs";
import path from "path";

// Load compiled artifacts
const loadArtifact = (name: string) => {
  const filePath = path.resolve(`./artifacts/contracts/${name}.sol/${name}.json`);
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return {
    abi: data.abi,
    bytecode: data.bytecode as `0x${string}`,
  };
};

const MockERC20Artifact = loadArtifact("MockERC20");
const NaharCreditRegistryArtifact = loadArtifact("NaharCreditRegistry");
const NaharVaultArtifact = loadArtifact("NaharVault");
const NaharSandboxArtifact = loadArtifact("NaharSandbox");
const MockDEXArtifact = loadArtifact("MockDEX");

const RPC_URL = "http://127.0.0.1:8545";
const transport = http(RPC_URL);

const publicClient = createPublicClient({ chain: hardhat, transport });

// Standard Hardhat dev accounts
const ownerAccount = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const lenderAccount = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const agentAccount = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");

const ownerClient = createWalletClient({ account: ownerAccount, chain: hardhat, transport });
const lenderClient = createWalletClient({ account: lenderAccount, chain: hardhat, transport });
const agentClient = createWalletClient({ account: agentAccount, chain: hardhat, transport });

const deploy = async (client: any, artifact: any, args: any[] = []) => {
  const hash = await client.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return receipt.contractAddress!;
};

async function main() {
  console.log("🚀 Deploying NAHAR smart contracts to local EVM node (http://127.0.0.1:8545)...");

  // 1. Deploy MockERC20 (USDC)
  const baseTokenAddress = await deploy(ownerClient, MockERC20Artifact, ["USD Coin", "USDC", 18]);
  console.log("✅ MockERC20 (USDC) deployed at:", baseTokenAddress);

  // 2. Deploy NaharCreditRegistry
  const creditRegistryAddress = await deploy(ownerClient, NaharCreditRegistryArtifact, []);
  console.log("✅ NaharCreditRegistry deployed at:", creditRegistryAddress);

  // 3. Deploy NaharVault
  const vaultAddress = await deploy(ownerClient, NaharVaultArtifact, [baseTokenAddress, creditRegistryAddress]);
  console.log("✅ NaharVault deployed at:", vaultAddress);

  // Authorize Vault on NaharCreditRegistry
  let tx = await ownerClient.writeContract({
    address: creditRegistryAddress,
    abi: NaharCreditRegistryArtifact.abi,
    functionName: "setAuthorizedVault",
    args: [vaultAddress],
  });
  await publicClient.waitForTransactionReceipt({ hash: tx });
  console.log("✅ NaharVault authorized on NaharCreditRegistry");

  // 4. Deploy MockDEX
  const mockDexAddress = await deploy(ownerClient, MockDEXArtifact, []);
  console.log("✅ MockDEX (Perpl/Kuru CLOB) deployed at:", mockDexAddress);

  // Whitelist MockDEX on Vault
  tx = await ownerClient.writeContract({
    address: vaultAddress,
    abi: NaharVaultArtifact.abi,
    functionName: "setWhitelistedTarget",
    args: [mockDexAddress, true],
  });
  await publicClient.waitForTransactionReceipt({ hash: tx });
  console.log("✅ MockDEX whitelisted on NaharVault");

  // 5. Mint tokens to Senior Lender and Agent
  const LENDER_DEPOSIT = parseEther("100000"); // 100k USDC
  const AGENT_INITIAL = parseEther("10000");   // 10k USDC

  tx = await ownerClient.writeContract({
    address: baseTokenAddress,
    abi: MockERC20Artifact.abi,
    functionName: "mint",
    args: [lenderAccount.address, LENDER_DEPOSIT],
  });
  await publicClient.waitForTransactionReceipt({ hash: tx });

  tx = await ownerClient.writeContract({
    address: baseTokenAddress,
    abi: MockERC20Artifact.abi,
    functionName: "mint",
    args: [agentAccount.address, AGENT_INITIAL],
  });
  await publicClient.waitForTransactionReceipt({ hash: tx });

  // 6. Senior Lender approves and deposits $100k into Vault
  tx = await lenderClient.writeContract({
    address: baseTokenAddress,
    abi: MockERC20Artifact.abi,
    functionName: "approve",
    args: [vaultAddress, LENDER_DEPOSIT],
  });
  await publicClient.waitForTransactionReceipt({ hash: tx });

  tx = await lenderClient.writeContract({
    address: vaultAddress,
    abi: NaharVaultArtifact.abi,
    functionName: "deposit",
    args: [LENDER_DEPOSIT],
  });
  await publicClient.waitForTransactionReceipt({ hash: tx });
  console.log("✅ Senior Lender deposited $100,000 USDC into NaharVault");

  // 7. Register Agent in Credit Registry
  tx = await ownerClient.writeContract({
    address: creditRegistryAddress,
    abi: NaharCreditRegistryArtifact.abi,
    functionName: "registerAgent",
    args: [agentAccount.address],
  });
  await publicClient.waitForTransactionReceipt({ hash: tx });
  console.log("✅ Agent registered in NaharCreditRegistry with Tier-1 baseline (300 score, 5x leverage)");

  // 8. Open initial active Sandbox for Agent: $500 Junior Buffer (unlocks $2,000 Senior Credit = $2,500 total)
  const JUNIOR_BUFFER = parseEther("500");

  tx = await agentClient.writeContract({
    address: baseTokenAddress,
    abi: MockERC20Artifact.abi,
    functionName: "approve",
    args: [vaultAddress, JUNIOR_BUFFER],
  });
  await publicClient.waitForTransactionReceipt({ hash: tx });

  tx = await agentClient.writeContract({
    address: vaultAddress,
    abi: NaharVaultArtifact.abi,
    functionName: "openSandbox",
    args: [agentAccount.address, JUNIOR_BUFFER],
  });
  await publicClient.waitForTransactionReceipt({ hash: tx });
  
  // Read active sandbox address
  const sandboxAddress = await publicClient.readContract({
    address: vaultAddress,
    abi: NaharVaultArtifact.abi,
    functionName: "activeSandboxOf",
    args: [agentAccount.address],
  });
  console.log("✅ Active Sandbox deployed at:", sandboxAddress);

  // 9. Write deployment info to JSON file for frontend consumption
  const deploymentData = {
    rpcUrl: RPC_URL,
    contracts: {
      baseToken: baseTokenAddress,
      creditRegistry: creditRegistryAddress,
      vault: vaultAddress,
      mockDex: mockDexAddress,
      sandbox: sandboxAddress,
    },
    accounts: {
      owner: ownerAccount.address,
      lender: lenderAccount.address,
      agent: agentAccount.address,
      agentKey: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
      lenderKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
    },
    deployedAt: new Date().toISOString()
  };

  fs.writeFileSync("live-deployment.json", JSON.stringify(deploymentData, null, 2));
  console.log("🎉 Successfully generated live-deployment.json!");
}

main().catch(console.error);
