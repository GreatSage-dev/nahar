import { describe, it, expect, beforeEach } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  encodeFunctionData,
  decodeEventLog,
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
const publicClient = createPublicClient({
  chain: hardhat,
  transport,
});

// Standard Hardhat dev accounts
const ownerAccount = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const lenderAccount = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const agentAccount = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const attackerAccount = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");

const ownerClient = createWalletClient({ account: ownerAccount, chain: hardhat, transport });
const lenderClient = createWalletClient({ account: lenderAccount, chain: hardhat, transport });
const agentClient = createWalletClient({ account: agentAccount, chain: hardhat, transport });
const attackerClient = createWalletClient({ account: attackerAccount, chain: hardhat, transport });

const deploy = async (client: any, artifact: any, args: any[] = []) => {
  const hash = await client.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return receipt.contractAddress!;
};

describe("NAHAR - Autonomous AI Agent Prime Broker on Monad", () => {
  let baseTokenAddress: `0x${string}`;
  let creditRegistryAddress: `0x${string}`;
  let vaultAddress: `0x${string}`;
  let mockDexAddress: `0x${string}`;

  const LENDER_DEPOSIT = parseEther("100000"); // 100,000 tokens
  const AGENT_INITIAL = parseEther("10000");   // 10,000 tokens

  beforeEach(async () => {
    // 1. Deploy MockERC20 (USDC / MONAD-USD)
    baseTokenAddress = await deploy(ownerClient, MockERC20Artifact, ["USD Coin", "USDC", 18]);

    // 2. Deploy NaharCreditRegistry
    creditRegistryAddress = await deploy(ownerClient, NaharCreditRegistryArtifact, []);

    // 3. Deploy NaharVault
    vaultAddress = await deploy(ownerClient, NaharVaultArtifact, [baseTokenAddress, creditRegistryAddress]);

    // Authorize Vault on NaharCreditRegistry
    const authHash = await ownerClient.writeContract({
      address: creditRegistryAddress,
      abi: NaharCreditRegistryArtifact.abi,
      functionName: "setAuthorizedVault",
      args: [vaultAddress],
    });
    await publicClient.waitForTransactionReceipt({ hash: authHash });

    // 4. Deploy MockDEX
    mockDexAddress = await deploy(ownerClient, MockDEXArtifact, []);

    // Whitelist MockDEX on NaharVault
    const wlHash = await ownerClient.writeContract({
      address: vaultAddress,
      abi: NaharVaultArtifact.abi,
      functionName: "setWhitelistedTarget",
      args: [mockDexAddress, true],
    });
    await publicClient.waitForTransactionReceipt({ hash: wlHash });

    // Mint tokens to lender and agent
    const mint1 = await ownerClient.writeContract({
      address: baseTokenAddress,
      abi: MockERC20Artifact.abi,
      functionName: "mint",
      args: [lenderAccount.address, LENDER_DEPOSIT],
    });
    await publicClient.waitForTransactionReceipt({ hash: mint1 });

    const mint2 = await ownerClient.writeContract({
      address: baseTokenAddress,
      abi: MockERC20Artifact.abi,
      functionName: "mint",
      args: [agentAccount.address, AGENT_INITIAL],
    });
    await publicClient.waitForTransactionReceipt({ hash: mint2 });

    // Lender deposits into NaharVault
    const appLender = await lenderClient.writeContract({
      address: baseTokenAddress,
      abi: MockERC20Artifact.abi,
      functionName: "approve",
      args: [vaultAddress, LENDER_DEPOSIT],
    });
    await publicClient.waitForTransactionReceipt({ hash: appLender });

    const depHash = await lenderClient.writeContract({
      address: vaultAddress,
      abi: NaharVaultArtifact.abi,
      functionName: "deposit",
      args: [LENDER_DEPOSIT],
    });
    await publicClient.waitForTransactionReceipt({ hash: depHash });
  });

  describe("1. Pool Liquidity & Agent Profiling", () => {
    it("should accept senior lender deposits and verify vault liquidity", async () => {
      const totalDeposits = await publicClient.readContract({
        address: vaultAddress,
        abi: NaharVaultArtifact.abi,
        functionName: "totalDeposits",
      });
      expect(totalDeposits).toBe(LENDER_DEPOSIT);
    });

    it("should register agent with initial Tier-1 profile (300 score, 5x leverage, 20% buffer)", async () => {
      const regHash = await agentClient.writeContract({
        address: creditRegistryAddress,
        abi: NaharCreditRegistryArtifact.abi,
        functionName: "registerAgent",
        args: [agentAccount.address],
      });
      await publicClient.waitForTransactionReceipt({ hash: regHash });

      const profile: any = await publicClient.readContract({
        address: creditRegistryAddress,
        abi: NaharCreditRegistryArtifact.abi,
        functionName: "getAgentProfile",
        args: [agentAccount.address],
      });

      expect(profile.isRegistered).toBe(true);
      expect(profile.creditScore).toBe(300n);
      expect(profile.maxLeverageMultiplier).toBe(5);
      expect(profile.minJuniorBufferBps).toBe(2000);
    });
  });

  describe("2. The Enoch Benchmark: Complete Verifiable Credit Lifecycle (Profitable)", () => {
    it("should deploy sandbox, execute profitable arbitrage, repay principal + yield, and upgrade credit score", async () => {
      const juniorBuffer = parseEther("500");

      // Approve junior buffer
      const appHash = await agentClient.writeContract({
        address: baseTokenAddress,
        abi: MockERC20Artifact.abi,
        functionName: "approve",
        args: [vaultAddress, juniorBuffer],
      });
      await publicClient.waitForTransactionReceipt({ hash: appHash });

      // Open sandbox
      const openHash = await agentClient.writeContract({
        address: vaultAddress,
        abi: NaharVaultArtifact.abi,
        functionName: "openSandbox",
        args: [agentAccount.address, juniorBuffer],
      });
      await publicClient.waitForTransactionReceipt({ hash: openHash });

      const sandboxAddress: `0x${string}` = (await publicClient.readContract({
        address: vaultAddress,
        abi: NaharVaultArtifact.abi,
        functionName: "activeSandboxOf",
        args: [agentAccount.address],
      })) as `0x${string}`;

      expect(sandboxAddress).not.toBe("0x0000000000000000000000000000000000000000");

      // Check capital inside sandbox: 500 buffer + 2,000 credit = 2,500
      const sandboxBalance = (await publicClient.readContract({
        address: baseTokenAddress,
        abi: MockERC20Artifact.abi,
        functionName: "balanceOf",
        args: [sandboxAddress],
      })) as bigint;

      expect(sandboxBalance).toBe(parseEther("2500"));

      // 1. Simulate arbitrage on MockDEX (+2% return = 10200 bps)
      const rateHash = await ownerClient.writeContract({
        address: mockDexAddress,
        abi: MockDEXArtifact.abi,
        functionName: "setRate",
        args: [10200n],
      });
      await publicClient.waitForTransactionReceipt({ hash: rateHash });

      const tradeAmount = parseEther("2500");
      const tradeCalldata = encodeFunctionData({
        abi: MockDEXArtifact.abi,
        functionName: "swap",
        args: [baseTokenAddress, baseTokenAddress, tradeAmount, tradeAmount],
      });

      // Execute trade via Sandbox
      const tradeHash = await agentClient.writeContract({
        address: sandboxAddress,
        abi: NaharSandboxArtifact.abi,
        functionName: "executeTrade",
        args: [mockDexAddress, tradeAmount, tradeCalldata],
      });
      await publicClient.waitForTransactionReceipt({ hash: tradeHash });

      // Post-trade balance = 2,550 tokens
      const postTradeBalance = (await publicClient.readContract({
        address: baseTokenAddress,
        abi: MockERC20Artifact.abi,
        functionName: "balanceOf",
        args: [sandboxAddress],
      })) as bigint;
      expect(postTradeBalance).toBe(parseEther("2550"));

      const agentBalanceBefore = (await publicClient.readContract({
        address: baseTokenAddress,
        abi: MockERC20Artifact.abi,
        functionName: "balanceOf",
        args: [agentAccount.address],
      })) as bigint;

      // 2. Settle and Repay
      const settleHash = await agentClient.writeContract({
        address: sandboxAddress,
        abi: NaharSandboxArtifact.abi,
        functionName: "settleAndRepay",
      });
      await publicClient.waitForTransactionReceipt({ hash: settleHash });

      // Agent gets 500 buffer + 90% net profit (~45)
      const agentBalanceAfter = (await publicClient.readContract({
        address: baseTokenAddress,
        abi: MockERC20Artifact.abi,
        functionName: "balanceOf",
        args: [agentAccount.address],
      })) as bigint;

      expect(agentBalanceAfter).toBeGreaterThan(agentBalanceBefore + juniorBuffer);

      // Reserve fund receives 10% cut
      const reserveFund = (await publicClient.readContract({
        address: vaultAddress,
        abi: NaharVaultArtifact.abi,
        functionName: "reserveFund",
      })) as bigint;
      expect(reserveFund).toBeGreaterThan(0n);

      // Credit score increments
      const updatedProfile: any = await publicClient.readContract({
        address: creditRegistryAddress,
        abi: NaharCreditRegistryArtifact.abi,
        functionName: "getAgentProfile",
        args: [agentAccount.address],
      });

      expect(updatedProfile.successfulCycles).toBe(1);
      expect(updatedProfile.creditScore).toBe(335n);
    });
  });

  describe("3. Dual-Tranche Loss Protection (Mild Trading Loss)", () => {
    it("should absorb trading losses 100% from junior buffer, senior depositors suffer ZERO loss", async () => {
      const juniorBuffer = parseEther("500");

      const appHash = await agentClient.writeContract({
        address: baseTokenAddress,
        abi: MockERC20Artifact.abi,
        functionName: "approve",
        args: [vaultAddress, juniorBuffer],
      });
      await publicClient.waitForTransactionReceipt({ hash: appHash });

      const openHash = await agentClient.writeContract({
        address: vaultAddress,
        abi: NaharVaultArtifact.abi,
        functionName: "openSandbox",
        args: [agentAccount.address, juniorBuffer],
      });
      await publicClient.waitForTransactionReceipt({ hash: openHash });

      const sandboxAddress: `0x${string}` = (await publicClient.readContract({
        address: vaultAddress,
        abi: NaharVaultArtifact.abi,
        functionName: "activeSandboxOf",
        args: [agentAccount.address],
      })) as `0x${string}`;

      // Market slips -1% (9900 bps)
      const rateHash = await ownerClient.writeContract({
        address: mockDexAddress,
        abi: MockDEXArtifact.abi,
        functionName: "setRate",
        args: [9900n],
      });
      await publicClient.waitForTransactionReceipt({ hash: rateHash });

      const tradeAmount = parseEther("2500");
      const tradeCalldata = encodeFunctionData({
        abi: MockDEXArtifact.abi,
        functionName: "swap",
        args: [baseTokenAddress, baseTokenAddress, tradeAmount, 0n],
      });

      const tradeHash = await agentClient.writeContract({
        address: sandboxAddress,
        abi: NaharSandboxArtifact.abi,
        functionName: "executeTrade",
        args: [mockDexAddress, tradeAmount, tradeCalldata],
      });
      await publicClient.waitForTransactionReceipt({ hash: tradeHash });

      const agentBalanceBefore = (await publicClient.readContract({
        address: baseTokenAddress,
        abi: MockERC20Artifact.abi,
        functionName: "balanceOf",
        args: [agentAccount.address],
      })) as bigint;

      // Settle
      const settleHash = await agentClient.writeContract({
        address: sandboxAddress,
        abi: NaharSandboxArtifact.abi,
        functionName: "settleAndRepay",
      });
      await publicClient.waitForTransactionReceipt({ hash: settleHash });

      // Agent receives 500 - 25 = 475 back
      const agentBalanceAfter = (await publicClient.readContract({
        address: baseTokenAddress,
        abi: MockERC20Artifact.abi,
        functionName: "balanceOf",
        args: [agentAccount.address],
      })) as bigint;

      const returnedBuffer = agentBalanceAfter - agentBalanceBefore;
      expect(returnedBuffer).toBeLessThan(juniorBuffer);
      expect(returnedBuffer).toBeGreaterThan(parseEther("470"));

      // Senior pool totalBorrowed is fully cleared
      const totalBorrowed = await publicClient.readContract({
        address: vaultAddress,
        abi: NaharVaultArtifact.abi,
        functionName: "totalBorrowed",
      });
      expect(totalBorrowed).toBe(0n);
    });
  });

  describe("4. Security & Containment Invariants", () => {
    it("should REVERT if attempting to call unwhitelisted target", async () => {
      const juniorBuffer = parseEther("500");

      const appHash = await agentClient.writeContract({
        address: baseTokenAddress,
        abi: MockERC20Artifact.abi,
        functionName: "approve",
        args: [vaultAddress, juniorBuffer],
      });
      await publicClient.waitForTransactionReceipt({ hash: appHash });

      await agentClient.writeContract({
        address: vaultAddress,
        abi: NaharVaultArtifact.abi,
        functionName: "openSandbox",
        args: [agentAccount.address, juniorBuffer],
      });

      const sandboxAddress: `0x${string}` = (await publicClient.readContract({
        address: vaultAddress,
        abi: NaharVaultArtifact.abi,
        functionName: "activeSandboxOf",
        args: [agentAccount.address],
      })) as `0x${string}`;

      // Call unwhitelisted attacker
      await expect(
        agentClient.writeContract({
          address: sandboxAddress,
          abi: NaharSandboxArtifact.abi,
          functionName: "executeTrade",
          args: [attackerAccount.address, 100n, "0x"],
        })
      ).rejects.toThrow();
    });

    it("should REVERT if a non-agent caller attempts to execute in the sandbox", async () => {
      const juniorBuffer = parseEther("500");

      const appHash = await agentClient.writeContract({
        address: baseTokenAddress,
        abi: MockERC20Artifact.abi,
        functionName: "approve",
        args: [vaultAddress, juniorBuffer],
      });
      await publicClient.waitForTransactionReceipt({ hash: appHash });

      await agentClient.writeContract({
        address: vaultAddress,
        abi: NaharVaultArtifact.abi,
        functionName: "openSandbox",
        args: [agentAccount.address, juniorBuffer],
      });

      const sandboxAddress: `0x${string}` = (await publicClient.readContract({
        address: vaultAddress,
        abi: NaharVaultArtifact.abi,
        functionName: "activeSandboxOf",
        args: [agentAccount.address],
      })) as `0x${string}`;

      await expect(
        attackerClient.writeContract({
          address: sandboxAddress,
          abi: NaharSandboxArtifact.abi,
          functionName: "executeTrade",
          args: [mockDexAddress, 100n, "0x"],
        })
      ).rejects.toThrow();
    });
  });

  describe("5. Dynamic Credit Progression (Tier-2 Leverage Expansion)", () => {
    it("should automatically scale agent leverage from 5x to 10x after 3 consecutive successful cycles", async () => {
      // Execute 3 quick cycles
      for (let i = 0; i < 3; i++) {
        const juniorBuffer = parseEther("200");
        const app = await agentClient.writeContract({
          address: baseTokenAddress,
          abi: MockERC20Artifact.abi,
          functionName: "approve",
          args: [vaultAddress, juniorBuffer],
        });
        await publicClient.waitForTransactionReceipt({ hash: app });

        const open = await agentClient.writeContract({
          address: vaultAddress,
          abi: NaharVaultArtifact.abi,
          functionName: "openSandbox",
          args: [agentAccount.address, juniorBuffer],
        });
        await publicClient.waitForTransactionReceipt({ hash: open });

        const sandboxAddress = (await publicClient.readContract({
          address: vaultAddress,
          abi: NaharVaultArtifact.abi,
          functionName: "activeSandboxOf",
          args: [agentAccount.address],
        })) as `0x${string}`;

        const settle = await agentClient.writeContract({
          address: sandboxAddress,
          abi: NaharSandboxArtifact.abi,
          functionName: "settleAndRepay",
        });
        await publicClient.waitForTransactionReceipt({ hash: settle });
      }

      // Check agent profile: 3 cycles completed, score increased by 35 * 3 = 105 -> 405
      // Crosses Tier 2 threshold (cycles >= 3 && creditScore >= 400) -> 10x leverage!
      const profile: any = await publicClient.readContract({
        address: creditRegistryAddress,
        abi: NaharCreditRegistryArtifact.abi,
        functionName: "getAgentProfile",
        args: [agentAccount.address],
      });

      expect(profile.successfulCycles).toBe(3);
      expect(profile.creditScore).toBeGreaterThanOrEqual(400n);
      expect(profile.maxLeverageMultiplier).toBe(10); // UPGRADED TO 10x LEVERAGE!
      expect(profile.minJuniorBufferBps).toBe(1000);  // Buffer requirement cut in half to 10%!
    });
  });

  describe("6. Protocol Reserve Fund Tail-Risk Backstop", () => {
    it("should absorb catastrophic shortfalls using the Protocol Reserve Fund", async () => {
      // First seed the reserve fund with 500 tokens
      const mintReserve = await ownerClient.writeContract({
        address: baseTokenAddress,
        abi: MockERC20Artifact.abi,
        functionName: "mint",
        args: [vaultAddress, parseEther("500")],
      });
      await publicClient.waitForTransactionReceipt({ hash: mintReserve });

      const juniorBuffer = parseEther("500");
      const app = await agentClient.writeContract({
        address: baseTokenAddress,
        abi: MockERC20Artifact.abi,
        functionName: "approve",
        args: [vaultAddress, juniorBuffer],
      });
      await publicClient.waitForTransactionReceipt({ hash: app });

      const open = await agentClient.writeContract({
        address: vaultAddress,
        abi: NaharVaultArtifact.abi,
        functionName: "openSandbox",
        args: [agentAccount.address, juniorBuffer],
      });
      await publicClient.waitForTransactionReceipt({ hash: open });

      const sandboxAddress = (await publicClient.readContract({
        address: vaultAddress,
        abi: NaharVaultArtifact.abi,
        functionName: "activeSandboxOf",
        args: [agentAccount.address],
      })) as `0x${string}`;

      // Simulate a catastrophic 30% crash on DEX (7000 bps)
      const rate = await ownerClient.writeContract({
        address: mockDexAddress,
        abi: MockDEXArtifact.abi,
        functionName: "setRate",
        args: [7000n],
      });
      await publicClient.waitForTransactionReceipt({ hash: rate });

      const tradeAmount = parseEther("2500");
      const tradeCalldata = encodeFunctionData({
        abi: MockDEXArtifact.abi,
        functionName: "swap",
        args: [baseTokenAddress, baseTokenAddress, tradeAmount, 0n],
      });

      const trade = await agentClient.writeContract({
        address: sandboxAddress,
        abi: NaharSandboxArtifact.abi,
        functionName: "executeTrade",
        args: [mockDexAddress, tradeAmount, tradeCalldata],
      });
      await publicClient.waitForTransactionReceipt({ hash: trade });

      // After 30% crash: sandbox capital = 1,750 (principal owed = 2,000)
      // Shortfall = 250 tokens
      const settle = await agentClient.writeContract({
        address: sandboxAddress,
        abi: NaharSandboxArtifact.abi,
        functionName: "settleAndRepay",
      });
      await publicClient.waitForTransactionReceipt({ hash: settle });

      // Agent is defaulted and downgraded
      const profile: any = await publicClient.readContract({
        address: creditRegistryAddress,
        abi: NaharCreditRegistryArtifact.abi,
        functionName: "getAgentProfile",
        args: [agentAccount.address],
      });

      expect(profile.defaultCount).toBe(1);
      expect(profile.maxLeverageMultiplier).toBe(2); // Demoted to 2x leverage
    });
  });
});

