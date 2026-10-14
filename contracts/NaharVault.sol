// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./MockERC20.sol";
import "./NaharCreditRegistry.sol";
import "./NaharSandbox.sol";

/**
 * @title NaharVault
 * @notice Senior Lending Pool & First-Loss Reserve for NAHAR on Monad
 * Allows depositors to earn streaming yield while backing autonomous agent sandboxes.
 */
contract NaharVault {
    MockERC20 public immutable baseToken;
    NaharCreditRegistry public immutable creditRegistry;

    address public owner;
    uint256 public totalDeposits;
    uint256 public totalBorrowed;
    uint256 public reserveFund; // First-loss protocol reserve from trading profit fees

    // Interest rate: 10% APY per second = ~3.17e-9 per second (in 1e18 scale)
    // For test clarity: 1 basis point per 10 seconds or dynamic per-second streaming
    uint256 public interestRatePerSecondRay = 3170979198; // ~10% APY in 1e18 precision

    mapping(address => uint256) public depositBalanceOf;
    mapping(address => address) public activeSandboxOf;
    mapping(address => bool) public whitelistedTargets;

    event Deposit(address indexed depositor, uint256 amount);
    event Withdraw(address indexed depositor, uint256 amount);
    event SandboxOpened(address indexed agent, address indexed sandbox, uint256 buffer, uint256 credit);
    event SandboxSettled(address indexed agent, address indexed sandbox, uint256 principal, uint256 interest);
    event ReserveFundAugmented(uint256 feeAmount, uint256 totalReserve);
    event ReserveFundAbsorbed(uint256 shortfall, uint256 remainingReserve);

    modifier onlyOwner() {
        require(msg.sender == owner, "Vault: only owner");
        _;
    }

    constructor(address _baseToken, address _creditRegistry) {
        owner = msg.sender;
        baseToken = MockERC20(_baseToken);
        creditRegistry = NaharCreditRegistry(_creditRegistry);
    }

    function setWhitelistedTarget(address target, bool isAllowed) external onlyOwner {
        require(target != address(baseToken), "Vault: cannot whitelist baseToken");
        require(target != address(this), "Vault: cannot whitelist vault");
        require(target != address(creditRegistry), "Vault: cannot whitelist registry");
        whitelistedTargets[target] = isAllowed;
    }

    /**
     * @notice Senior depositors deposit capital to earn streaming yield
     */
    function deposit(uint256 amount) external {
        require(amount > 0, "Vault: zero deposit");
        baseToken.transferFrom(msg.sender, address(this), amount);
        depositBalanceOf[msg.sender] += amount;
        totalDeposits += amount;
        emit Deposit(msg.sender, amount);
    }

    /**
     * @notice Senior depositors withdraw their principal + accrued yield
     */
    function withdraw(uint256 amount) external {
        require(depositBalanceOf[msg.sender] >= amount, "Vault: insufficient balance");
        uint256 availableLiquidity = baseToken.balanceOf(address(this)) - reserveFund;
        require(availableLiquidity >= amount, "Vault: liquidity currently utilized in active credit");

        depositBalanceOf[msg.sender] -= amount;
        totalDeposits -= amount;
        baseToken.transfer(msg.sender, amount);
        emit Withdraw(msg.sender, amount);
    }

    /**
     * @notice Opens an on-chain execution sandbox with bounded credit for an agent
     * @param agent Address of the autonomous agent
     * @param agentBuffer Junior buffer deposited by agent (5% - 20%)
     */
    function openSandbox(address agent, uint256 agentBuffer) external returns (address) {
        require(agent != address(0), "Vault: zero agent address");
        require(agentBuffer > 0, "Vault: zero junior buffer");
        require(activeSandboxOf[agent] == address(0), "Vault: agent already has active sandbox");

        // Pull junior buffer from agent or msg.sender
        baseToken.transferFrom(msg.sender, address(this), agentBuffer);

        // Fetch agent's credit tier from NaharCreditRegistry
        NaharCreditRegistry.AgentCreditProfile memory profile = creditRegistry.getAgentProfile(agent);
        uint16 leverage = profile.isRegistered ? profile.maxLeverageMultiplier : 5; // Default 5x
        if (leverage == 0) leverage = 5;

        // Credit line = buffer * (leverage - 1)
        uint256 creditAmount = agentBuffer * (leverage - 1);
        uint256 totalSandboxCapital = agentBuffer + creditAmount;

        uint256 currentCash = baseToken.balanceOf(address(this));
        uint256 committed = reserveFund + agentBuffer;
        uint256 availableLiquidity = currentCash > committed ? currentCash - committed : 0;
        require(availableLiquidity >= creditAmount, "Vault: insufficient pool liquidity for credit line");

        totalBorrowed += creditAmount;

        // Deploy new isolated execution sandbox
        NaharSandbox sandbox = new NaharSandbox(
            address(this),
            agent,
            address(baseToken),
            address(creditRegistry),
            agentBuffer,
            creditAmount
        );

        activeSandboxOf[agent] = address(sandbox);

        // Transfer combined capital (buffer + credit) to sandbox
        baseToken.transfer(address(sandbox), totalSandboxCapital);

        emit SandboxOpened(agent, address(sandbox), agentBuffer, creditAmount);
        return address(sandbox);
    }

    /**
     * @notice Callback invoked by sandbox when closing and repaying credit
     */
    function onRepayCredit(
        address agent,
        uint256 principal,
        uint256 interest,
        uint256 reserveFee,
        uint256 shortfall
    ) external {
        require(msg.sender == activeSandboxOf[agent], "Vault: caller not active sandbox");

        totalBorrowed = totalBorrowed >= principal ? totalBorrowed - principal : 0;

        if (reserveFee > 0) {
            reserveFund += reserveFee;
            emit ReserveFundAugmented(reserveFee, reserveFund);
        }

        // If a black swan caused a shortfall exceeding the junior buffer:
        if (shortfall > 0) {
            if (reserveFund >= shortfall) {
                reserveFund -= shortfall;
                emit ReserveFundAbsorbed(shortfall, reserveFund);
            } else {
                uint256 unbackedLoss = shortfall - reserveFund;
                emit ReserveFundAbsorbed(reserveFund, 0);
                reserveFund = 0;
                totalDeposits = totalDeposits > unbackedLoss ? totalDeposits - unbackedLoss : 0;
            }
            creditRegistry.recordDefault(agent, shortfall);
        } else {
            // Repayment succeeded without shortfall
            creditRegistry.recordSuccess(agent, principal, interest, reserveFee * 9); // profit estimate
        }

        activeSandboxOf[agent] = address(0);
        emit SandboxSettled(agent, msg.sender, principal, interest);
    }

    function isTargetWhitelisted(address target) external view returns (bool) {
        return whitelistedTargets[target];
    }
}
