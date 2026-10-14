import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  defineChain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import fs from "fs";
import path from "path";

// Define Monad Testnet Chain
export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testnet-rpc.monad.xyz"] },
    public: { http: ["https://testnet-rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: { name: "MonadScan", url: "https://testnet.monadscan.com" },
  },
  testnet: true,
});

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
const MockDEXArtifact = loadArtifact("MockDEX");

const RPC_URL = "https://testnet-rpc.monad.xyz";
const transport = http(RPC_URL);
const publicClient = createPublicClient({ chain: monadTestnet, transport });

const DEPLOYER_PK = (process.env.DEPLOYER_PK || "0xae46d09f035bc982dace3561de1a6eef670a7490a577d0ef89113c8c59838b6a") as `0x${string}`;
const deployerAccount = privateKeyToAccount(DEPLOYER_PK);
const walletClient = createWalletClient({ account: deployerAccount, chain: monadTestnet, transport });

const deployContract = async (artifact: any, args: any[] = []) => {
  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args,
  });
  console.log(`📡 Submitted deploy tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`✅ Deployed at: ${receipt.contractAddress} (Block #${receipt.blockNumber})`);
  return receipt.contractAddress!;
};

async function main() {
  console.log("==================================================");
  console.log("⚡ NAHAR // MONAD TESTNET AUTOMATED DEPLOYMENT");
  console.log(`🎯 Deployer Address: ${deployerAccount.address}`);
  console.log("==================================================");

  // Check balance and wait if 0
  let balance = await publicClient.getBalance({ address: deployerAccount.address });
  console.log(`💰 Current MON Balance: ${formatEther(balance)} MON`);

  if (balance === 0n) {
    console.log("⏳ Waiting for testnet MON to arrive from faucet...");
    while (balance === 0n) {
      await new Promise((r) => setTimeout(r, 4000));
      balance = await publicClient.getBalance({ address: deployerAccount.address });
      if (balance > 0n) {
        console.log(`🎉 Detected incoming funds! Balance: ${formatEther(balance)} MON`);
        break;
      }
      process.stdout.write(".");
    }
  }

  console.log("\n🚀 Commencing live contract deployment to Monad Testnet (Chain ID: 10143)...");

  // 1. MockERC20 (USDC)
  console.log("\n1/4 Deploying MockERC20 (USDC)...");
  const baseTokenAddress = await deployContract(MockERC20Artifact, ["USD Coin", "USDC", 18]);

  // 2. NaharCreditRegistry
  console.log("\n2/4 Deploying NaharCreditRegistry...");
  const creditRegistryAddress = await deployContract(NaharCreditRegistryArtifact, []);

  // 3. NaharVault
  console.log("\n3/4 Deploying NaharVault...");
  const vaultAddress = await deployContract(NaharVaultArtifact, [baseTokenAddress, creditRegistryAddress]);

  // Authorize Vault on Registry
  let tx = await walletClient.writeContract({
    address: creditRegistryAddress,
    abi: NaharCreditRegistryArtifact.abi,
    functionName: "setAuthorizedVault",
    args: [vaultAddress],
  });
  await publicClient.waitForTransactionReceipt({ hash: tx });
  console.log("✅ Authorized NaharVault on Credit Registry");

  // 4. MockDEX
  console.log("\n4/4 Deploying MockDEX (Perpl / Kuru simulator)...");
  const mockDexAddress = await deployContract(MockDEXArtifact, []);

  // Whitelist MockDEX on Vault
  tx = await walletClient.writeContract({
    address: vaultAddress,
    abi: NaharVaultArtifact.abi,
    functionName: "setWhitelistedTarget",
    args: [mockDexAddress, true],
  });
  await publicClient.waitForTransactionReceipt({ hash: tx });
  console.log("✅ Whitelisted MockDEX on NaharVault");

  // Mint test USDC & Initial Senior Capital
  const SENIOR_LIQUIDITY = parseEther("100000"); // $100k USDC
  tx = await walletClient.writeContract({
    address: baseTokenAddress,
    abi: MockERC20Artifact.abi,
    functionName: "mint",
    args: [deployerAccount.address, SENIOR_LIQUIDITY + parseEther("10000")],
  });
  await publicClient.waitForTransactionReceipt({ hash: tx });

  tx = await walletClient.writeContract({
    address: baseTokenAddress,
    abi: MockERC20Artifact.abi,
    functionName: "approve",
    args: [vaultAddress, SENIOR_LIQUIDITY],
  });
  await publicClient.waitForTransactionReceipt({ hash: tx });

  tx = await walletClient.writeContract({
    address: vaultAddress,
    abi: NaharVaultArtifact.abi,
    functionName: "deposit",
    args: [SENIOR_LIQUIDITY],
  });
  await publicClient.waitForTransactionReceipt({ hash: tx });
  console.log("✅ Initialized Senior Liquidity Vault with $100,000 USDC");

  // Register Agent & Open initial Sandbox
  tx = await walletClient.writeContract({
    address: creditRegistryAddress,
    abi: NaharCreditRegistryArtifact.abi,
    functionName: "registerAgent",
    args: [deployerAccount.address],
  });
  await publicClient.waitForTransactionReceipt({ hash: tx });

  const JUNIOR_BUFFER = parseEther("500");
  tx = await walletClient.writeContract({
    address: baseTokenAddress,
    abi: MockERC20Artifact.abi,
    functionName: "approve",
    args: [vaultAddress, JUNIOR_BUFFER],
  });
  await publicClient.waitForTransactionReceipt({ hash: tx });

  tx = await walletClient.writeContract({
    address: vaultAddress,
    abi: NaharVaultArtifact.abi,
    functionName: "openSandbox",
    args: [deployerAccount.address, JUNIOR_BUFFER],
  });
  await publicClient.waitForTransactionReceipt({ hash: tx });

  const sandboxAddress = await publicClient.readContract({
    address: vaultAddress,
    abi: NaharVaultArtifact.abi,
    functionName: "activeSandboxOf",
    args: [deployerAccount.address],
  });
  console.log("✅ Deployed Active Execution Sandbox at:", sandboxAddress);

  // Output record
  const deploymentData = {
    network: "Monad Testnet",
    chainId: 10143,
    rpcUrl: RPC_URL,
    explorer: "https://testnet.monadscan.com",
    contracts: {
      baseToken: baseTokenAddress,
      creditRegistry: creditRegistryAddress,
      vault: vaultAddress,
      mockDex: mockDexAddress,
      activeSandbox: sandboxAddress,
    },
    explorerUrls: {
      vault: `https://testnet.monadscan.com/address/${vaultAddress}`,
      sandbox: `https://testnet.monadscan.com/address/${sandboxAddress}`,
      creditRegistry: `https://testnet.monadscan.com/address/${creditRegistryAddress}`,
      mockDex: `https://testnet.monadscan.com/address/${mockDexAddress}`,
      baseToken: `https://testnet.monadscan.com/address/${baseTokenAddress}`,
    },
    deployedAt: new Date().toISOString(),
  };

  fs.writeFileSync("monad-testnet-deployment.json", JSON.stringify(deploymentData, null, 2));

  console.log("\n==================================================");
  console.log("🎉 MONAD TESTNET DEPLOYMENT SUCCESSFUL!");
  console.log("==================================================");
  console.log(`Vault:          ${deploymentData.explorerUrls.vault}`);
  console.log(`Sandbox:        ${deploymentData.explorerUrls.sandbox}`);
  console.log(`CreditRegistry: ${deploymentData.explorerUrls.creditRegistry}`);
  console.log(`MockDEX:        ${deploymentData.explorerUrls.mockDex}`);
  console.log(`BaseToken USDC: ${deploymentData.explorerUrls.baseToken}`);
  console.log("==================================================");
}

main().catch(console.error);
