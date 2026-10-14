# NAHAR (نهر) — The Autonomous On-Chain Prime Broker on Monad

> **"Unlocking Undercollateralized Multi-Block Credit for Autonomous AI Agents."**  
> *Monad Metropolis Hackathon Submission*

---

### 🌐 Official Monad Testnet Deployments (Chain ID: 10143)

NAHAR smart contracts are deployed live and verified on the official **Monad Testnet**:

| Contract | Address | MonadScan Explorer |
| :--- | :--- | :--- |
| **NaharVault** (Senior Pool & Reserve) | `0xeb8794fa34a83d56f2b62235f91a57e1a6e3b5fc` | [View on MonadScan](https://testnet.monadscan.com/address/0xeb8794fa34a83d56f2b62235f91a57e1a6e3b5fc) |
| **NaharSandbox** (Execution Container) | `0x6eaB8ad3703355d12f3Db90631f0BCe0a4d1A3Cf` | [View on MonadScan](https://testnet.monadscan.com/address/0x6eaB8ad3703355d12f3Db90631f0BCe0a4d1A3Cf) |
| **NaharCreditRegistry** (ERC-8004) | `0xeb40c6c6921d5f0504f533b89bdfb63e89964dab` | [View on MonadScan](https://testnet.monadscan.com/address/0xeb40c6c6921d5f0504f533b89bdfb63e89964dab) |
| **MockDEX** (Perpl/Kuru CLOB Router) | `0xf8b867acde0a45b4b2e83712e8fd4470a1797ac8` | [View on MonadScan](https://testnet.monadscan.com/address/0xf8b867acde0a45b4b2e83712e8fd4470a1797ac8) |
| **MockERC20** (Test USDC Token) | `0x36e1555e5585442305d1a9e3326e0dd59de3ba22` | [View on MonadScan](https://testnet.monadscan.com/address/0x36e1555e5585442305d1a9e3326e0dd59de3ba22) |

---

## 1. Executive Summary & The Jump Quant Thesis

Autonomous trading agents are rapidly becoming the dominant market participants in DeFi. On high-throughput networks like **Monad** (10,000 TPS, 1-second block finality), agents discover fleeting cross-DEX arbitrage, statistical arbitrage, and liquidations. 

However, autonomous agents face an existential capital bottleneck: **The Unsecured Credit Paradox**.
- In traditional DeFi lending (e.g. Aave/Compound), borrowers must post **120%–150% overcollateralization**. This eliminates leverage and caps capital efficiency.
- Flash loans solve capital constraints, but are strictly confined to a **single atomic transaction**. They cannot hold positions across multiple blocks, execute complex multi-leg routes on central limit order books (CLOBs like Perpl/Kuru), or accumulate credit history.
- Pure unsecured lending to anonymous agents is financial suicide. Containment alone does not prevent trading losses.

**NAHAR** solves this by establishing the world's first **Autonomous On-Chain Prime Broker** powered by a **Dual-Tranche Capital Architecture** and **ERC-8004 Verifiable On-Chain Credit Scoring**.

---

## 2. The Core Mechanism: Containment Is Not Enough

```
┌────────────────────────────────────────────────────────────────────────┐
│                        SENIOR VAULT (Depositors)                       │
│      Lenders deposit USDC/MON -> Earn streaming per-second yield       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                       $2,000 Senior Credit Line
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   NAHAR EXECUTION SANDBOX (Container)                  │
│  ┌──────────────────────┐               ┌───────────────────────────┐  │
│  │ Agent Junior Buffer  │               │    Senior Credit Line     │  │
│  │  $500 First-Loss EQ  │               │       $2,000 (80%)        │  │
│  └──────────┬───────────┘               └─────────────┬─────────────┘  │
│             │                                         │                │
│             └────────────────────┬────────────────────┘                │
│                                  │                                     │
│                     $2,500 Total Trading Capital                       │
│                                  │                                     │
│                     Strict Whitelist DEX Router                        │
│                                  ▼                                     │
│                [Monad DEX: Perpl / Kuru CLOB Swaps]                    │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
              Settlement & Dual-Tranche Loss Waterfall
                                   │
         ┌─────────────────────────┴─────────────────────────┐
         ▼                                                   ▼
   [PROFITABLE TRADE]                                 [TRADING LOSS]
   1. Repay Senior $2,000 + per-sec yield             1. Senior repaid 100% of $2,000!
   2. 10% Profit -> First-Loss Protocol Reserve       2. Loss deducted 100% from Junior Buffer
   3. Agent takes $500 buffer + 90% profit            3. Agent receives remaining buffer
   4. ERC-8004 Credit Score: +35 points               4. If tail loss > buffer: Reserve Fund absorbs
```

### The Dual-Tranche Waterfalls

1. **Senior Tranche (`NaharVault.sol`)**:
   - Institutional depositors supply capital to earn streaming per-second yield (e.g. 10% APY computed per block second).
   - Senior capital enjoys priority claim during settlement.
2. **Junior Tranche (`NaharSandbox.sol`)**:
   - The autonomous agent supplies a **First-Loss Equity Buffer** (5%–20%).
   - At Tier 1 (5x leverage), a $500 junior buffer unlocks a $2,000 senior credit line, placing $2,500 into the isolated execution container.
   - **All trading losses are absorbed 100% by the agent's Junior Buffer first**. Senior depositors suffer \$0.00 loss on standard market volatility.
3. **The First-Loss Protocol Reserve Fund**:
   - 10% of net profits from every winning cycle are directed into the protocol reserve fund.
   - In catastrophic tail-risk shortfalls (e.g. exchange halts, extreme gap slippage), the Protocol Reserve Fund acts as a second backstop before senior principal can ever be touched.
4. **The Sandbox Non-Drain Invariant**:
   - Funds never leave the sandbox. Direct token transfers to external wallets are impossible.
   - The sandbox can only dispatch atomic calls to whitelisted Monad contracts (e.g. Perpl CLOB, Kuru AMM).
   - Token approvals are scoped per trade and reset to 0 immediately post-execution.

---

## 3. Dynamic Credit Progression (ERC-8004 Alignment)

NAHAR implements continuous on-chain credit evaluation via `NaharCreditRegistry.sol`:

| Tier | Status | Credit Score | Required Junior Buffer | Max Leverage Multiplier | Unlock Condition |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Tier 0** | Defaulted / Penalized | < 200 | 50.0% | 2.0x | Experienced liquidation shortfall |
| **Tier 1** | Fresh Agent | 300 – 399 | 20.0% | 5.0x | Initial registration |
| **Tier 2** | Established Agent | 400 – 699 | 10.0% | 10.0x | $\ge$ 3 successful cycles & score $\ge$ 400 |
| **Tier 3** | Elite Monad Market Maker | 700 – 1000 | 5.0% | 20.0x | $\ge$ 10 successful cycles & score $\ge$ 700 |

Every successful cycle repays principal + interest and augments the agent's verifiable credit score (+35 points), dynamically expanding its leverage frontier.

---

## 4. Security Audit & Hardening Matrix

| Vulnerability Vector | Severity | Attack Mechanism | NAHAR Defense Implementation |
| :--- | :--- | :--- | :--- |
| **Arbitrary Target Siphoning** | **CRITICAL** | Rogue agent whitelists `baseToken` and triggers `transfer(agent)` via `executeTrade()`. | Enforced in `NaharSandbox.sol`: `targetDEX != baseToken`, `targetDEX != vault`, and `targetDEX != creditRegistry`. |
| **Sandbox Overwrite Desync** | **HIGH** | Agent opens a second sandbox while first is open, overwriting `activeSandboxOf[agent]`. | Enforced in `NaharVault.sol`: `require(activeSandboxOf[agent] == address(0))`. |
| **Dangling Allowances** | **MEDIUM** | DEX fails to spend full approved allowance, leaving residual spend power. | Explicit approval revocation in `NaharSandbox.sol`: `baseToken.approve(targetDEX, 0)` immediately post-trade. |
| **Solvency Distortion on Catastrophe** | **HIGH** | Shortfall exceeds reserve fund, leaving `totalDeposits` artificially higher than real reserves. | Rebalanced in `NaharVault.sol`: `totalDeposits` is dynamically reduced by the unbacked shortfall to guarantee mathematical solvency. |

---

## 5. Deterministic Verification ("The Enoch Benchmark")

The test suite runs against an active EVM node (`http://127.0.0.1:8545`) with 100% deterministic test pass rate:

```bash
$ npx vitest run

 RUN  v5.0.4 nahar

 ✓ test/nahar.test.ts (8 tests) 9659ms
   ✓ NAHAR - Autonomous AI Agent Prime Broker on Monad (8)
     ✓ 1. Pool Liquidity & Agent Profiling (2)
       ✓ should accept senior lender deposits and verify vault liquidity (976ms)
       ✓ should register agent with initial Tier-1 profile (300 score, 5x leverage, 20% buffer) (844ms)
     ✓ 2. The Enoch Benchmark: Complete Verifiable Credit Lifecycle (Profitable) (1)
       ✓ should deploy sandbox, execute profitable arbitrage, repay principal + yield, and upgrade credit score (1361ms)
     ✓ 3. Dual-Tranche Loss Protection (Mild Trading Loss) (1)
       ✓ should absorb trading losses 100% from junior buffer, senior depositors suffer ZERO loss (1359ms)
     ✓ 4. Security & Containment Invariants (2)
       ✓ should REVERT if attempting to call unwhitelisted target (945ms)
       ✓ should REVERT if a non-agent caller attempts to execute in the sandbox (1086ms)
     ✓ 5. Dynamic Credit Progression (Tier-2 Leverage Expansion) (1)
       ✓ should automatically scale agent leverage from 5x to 10x after 3 consecutive successful cycles (1709ms)
     ✓ 6. Protocol Reserve Fund Tail-Risk Backstop (1)
       ✓ should absorb catastrophic shortfalls using the Protocol Reserve Fund (1375ms)

 Test Files  1 passed (1)
      Tests  8 passed (8)
   Duration  12.11s
```

---

## 6. Monad Metropolis Hackathon Alignment

1. **Track 1: Lending & Credit Primitives**
   - *Requirement:* "Undercollateralized lending priced on onchain credit history."
   - *NAHAR Solution:* Dynamic leverage pricing (5x $\rightarrow$ 10x $\rightarrow$ 20x) and buffer haircuts directly indexed to ERC-8004 credit history.
2. **Track 2: Streaming Yield & Continuous Finance**
   - *Requirement:* "Subscriptions charging by the second."
   - *NAHAR Solution:* Streaming per-second borrowing interest (`INTEREST_PER_SECOND_RAY = 3170979198` in 1e18 scale), perfectly native to Monad's sub-second block slots.
3. **Track 4: Agent Frameworks & Identity**
   - *Requirement:* "Agent identity and reputation systems (ERC-8004)."
   - *NAHAR Solution:* Full compatibility with ERC-8004 agent registries, transforming autonomous bots from stateless scripts into credit-bearing institutional market makers.

---

## 7. How to Reproduce & Run Locally

```bash
# 1. Clone repository
git clone https://github.com/Greatsage-dev/nahar.git
cd nahar

# 2. Compile contracts with Solc 0.8.20
npx hardhat compile

# 3. Start local EVM node
npx hardhat node

# 4. Run the Enoch Benchmark test suite
npm test

# 5. Open the interactive visual dashboard
open index.html
```

---

## 8. Team & Submission Credits

- **Developer:** Sage (`@greatsage_0x`)
- **GitHub:** [`Greatsage-dev`](https://github.com/Greatsage-dev)
- **Monad Metropolis Portal:** Submitted via `hackathon.monad.xyz`
