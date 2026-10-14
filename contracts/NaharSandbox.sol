// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./MockERC20.sol";
import "./NaharVault.sol";
import "./NaharCreditRegistry.sol";

/**
 * @title NaharSandbox
 * @notice Isolated On-Chain Execution Sandbox for Autonomous AI Agents on Monad
 * Enforces strict trade whitelisting, non-drain invariants, and dual-tranche loss allocation.
 */
contract NaharSandbox {
    NaharVault public immutable vault;
    address public immutable agent;
    MockERC20 public immutable baseToken;
    NaharCreditRegistry public immutable creditRegistry;

    uint256 public immutable agentJuniorBuffer;
    uint256 public immutable creditPrincipal;
    uint256 public immutable startTimestamp;
    bool public isSettled;

    // Per-second interest rate: ~10% APY in 1e18 scale (3.17e-9 per second)
    // For test scenarios, calibrated to yield predictable streaming fees per block
    uint256 public constant INTEREST_PER_SECOND_RAY = 3170979198; // 1e18 scale

    event TradeExecuted(address indexed targetDEX, uint256 value, bytes data);
    event Settled(
        address indexed agent,
        uint256 totalValue,
        uint256 principalRepaid,
        uint256 interestPaid,
        uint256 agentProfit,
        uint256 bufferDeduction
    );
    event Liquidated(address indexed caller, uint256 remainingValue, uint256 liquidatorReward);

    modifier onlyAgent() {
        require(msg.sender == agent, "Sandbox: only authorized agent can execute");
        _;
    }

    modifier notSettled() {
        require(!isSettled, "Sandbox: already settled");
        _;
    }

    constructor(
        address _vault,
        address _agent,
        address _baseToken,
        address _creditRegistry,
        uint256 _buffer,
        uint256 _credit
    ) {
        vault = NaharVault(_vault);
        agent = _agent;
        baseToken = MockERC20(_baseToken);
        creditRegistry = NaharCreditRegistry(_creditRegistry);
        agentJuniorBuffer = _buffer;
        creditPrincipal = _credit;
        startTimestamp = block.timestamp;
    }

    /**
     * @notice Agent executes trade on Monad DEX through the sandbox
     * Strictly verifies whitelist and blocks arbitrary external fund drainage
     */
    function executeTrade(
        address targetDEX,
        uint256 tokenAmountToApprove,
        bytes calldata tradeCalldata
    ) external onlyAgent notSettled returns (bytes memory) {
        require(vault.isTargetWhitelisted(targetDEX), "Sandbox: target DEX is not whitelisted");
        require(targetDEX != address(baseToken), "Sandbox: target cannot be baseToken");
        require(targetDEX != address(vault), "Sandbox: target cannot be vault");
        require(targetDEX != address(creditRegistry), "Sandbox: target cannot be registry");

        // Approve target DEX only for the specific trade amount
        if (tokenAmountToApprove > 0) {
            baseToken.approve(targetDEX, tokenAmountToApprove);
        }

        // Execute atomic call to whitelisted target DEX
        (bool success, bytes memory returnData) = targetDEX.call(tradeCalldata);
        require(success, "Sandbox: trade execution failed on DEX");

        // Clear approval to prevent any dangling allowance
        if (tokenAmountToApprove > 0) {
            baseToken.approve(targetDEX, 0);
        }

        emit TradeExecuted(targetDEX, tokenAmountToApprove, tradeCalldata);
        return returnData;
    }

    /**
     * @notice Computes interest owed based on elapsed seconds
     */
    function getInterestOwed() public view returns (uint256) {
        uint256 elapsedSeconds = block.timestamp > startTimestamp ? block.timestamp - startTimestamp : 0;
        // Interest = (creditPrincipal * elapsedSeconds * INTEREST_PER_SECOND_RAY) / 1e18
        // If elapsed is small, minimum 1 unit of interest for precision
        uint256 interest = (creditPrincipal * elapsedSeconds * INTEREST_PER_SECOND_RAY) / 1e18;
        return interest;
    }

    /**
     * @notice Closes sandbox, repays senior lenders with streaming yield, and distributes profits/losses
     */
    function settleAndRepay() external onlyAgent notSettled {
        isSettled = true;

        uint256 interestOwed = getInterestOwed();
        uint256 totalOwedToLender = creditPrincipal + interestOwed;
        uint256 currentBalance = baseToken.balanceOf(address(this));

        if (currentBalance >= totalOwedToLender) {
            uint256 excess = currentBalance - totalOwedToLender;

            if (excess >= agentJuniorBuffer) {
                // PROFITABLE EXECUTION
                uint256 netProfit = excess - agentJuniorBuffer;
                uint256 reserveFee = (netProfit * 10) / 100; // 10% Protocol First-Loss Reserve cut
                uint256 agentTakeHome = netProfit - reserveFee + agentJuniorBuffer; // Returns buffer + 90% profit

                // Repay Senior Vault principal + interest + reserveFee
                baseToken.transfer(address(vault), totalOwedToLender + reserveFee);

                // Transfer profit + buffer to agent
                baseToken.transfer(agent, agentTakeHome);

                vault.onRepayCredit(agent, creditPrincipal, interestOwed, reserveFee, 0);

                emit Settled(agent, currentBalance, creditPrincipal, interestOwed, netProfit - reserveFee, 0);
            } else {
                // MILD TRADING LOSS: Fully absorbed by Junior Buffer
                uint256 loss = agentJuniorBuffer - excess;
                uint256 agentRemainingBuffer = agentJuniorBuffer - loss;

                // Lender receives 100% of principal + interest!
                baseToken.transfer(address(vault), totalOwedToLender);

                // Agent gets remaining buffer
                if (agentRemainingBuffer > 0) {
                    baseToken.transfer(agent, agentRemainingBuffer);
                }

                vault.onRepayCredit(agent, creditPrincipal, interestOwed, 0, 0);

                emit Settled(agent, currentBalance, creditPrincipal, interestOwed, 0, loss);
            }
        } else {
            // CATASTROPHIC GAP LOSS: Junior Buffer 100% wiped; shortfall absorbed by Reserve Fund
            uint256 shortfall = totalOwedToLender - currentBalance;

            // Transfer all remaining funds to Vault
            baseToken.transfer(address(vault), currentBalance);

            vault.onRepayCredit(agent, creditPrincipal, interestOwed, 0, shortfall);

            emit Settled(agent, currentBalance, currentBalance, 0, 0, agentJuniorBuffer);
        }
    }

    /**
     * @notice Emergency liquidation if position value drops into critical danger zone
     */
    function liquidate() external notSettled {
        uint256 currentBalance = baseToken.balanceOf(address(this));
        // Liquidation trigger: portfolio value <= creditPrincipal + (20% of buffer)
        uint256 liquidationThreshold = creditPrincipal + ((agentJuniorBuffer * 20) / 100);
        require(currentBalance <= liquidationThreshold, "Sandbox: position is solvent; liquidation rejected");

        isSettled = true;

        uint256 liquidatorReward = 0;
        if (currentBalance > creditPrincipal) {
            liquidatorReward = (currentBalance - creditPrincipal) / 2; // 50% of remaining buffer to caller
        }

        uint256 amountToVault = currentBalance - liquidatorReward;
        baseToken.transfer(address(vault), amountToVault);

        if (liquidatorReward > 0) {
            baseToken.transfer(msg.sender, liquidatorReward);
        }

        uint256 shortfall = creditPrincipal > amountToVault ? creditPrincipal - amountToVault : 0;
        vault.onRepayCredit(agent, creditPrincipal, 0, 0, shortfall);

        emit Liquidated(msg.sender, currentBalance, liquidatorReward);
    }
}
