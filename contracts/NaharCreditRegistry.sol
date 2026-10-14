// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title NaharCreditRegistry
 * @notice ERC-8004 aligned on-chain credit and reputation registry for autonomous AI agents on Monad
 * Evaluates performance, repayment history, and dynamically scales credit limits.
 */
contract NaharCreditRegistry {
    address public owner;
    address public authorizedVault;

    struct AgentCreditProfile {
        bool isRegistered;
        uint256 creditScore;        // Score from 100 to 1000 (starting at 300)
        uint256 totalBorrowed;
        uint256 totalRepaid;
        uint256 netProfitGenerated;
        uint32 successfulCycles;
        uint32 defaultCount;
        uint16 maxLeverageMultiplier; // e.g., 5 for 5x, 10 for 10x, 20 for 20x
        uint16 minJuniorBufferBps;    // e.g., 2000 = 20%, 1000 = 10%, 500 = 5%
        uint256 lastUpdatedTimestamp;
    }

    mapping(address => AgentCreditProfile) public profiles;

    event AgentRegistered(address indexed agent, uint256 initialScore);
    event RepaymentRecorded(
        address indexed agent,
        uint256 principal,
        uint256 interest,
        uint256 profit,
        uint256 newScore,
        uint16 newLeverage
    );
    event DefaultRecorded(address indexed agent, uint256 loss, uint256 penaltyScore);

    modifier onlyAuthorized() {
        require(msg.sender == authorizedVault || msg.sender == owner, "Registry: unauthorized caller");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setAuthorizedVault(address _vault) external {
        require(msg.sender == owner, "Registry: only owner");
        authorizedVault = _vault;
    }

    /**
     * @notice Registers an agent with initial Tier-1 credit profile
     */
    function registerAgent(address agent) external {
        require(!profiles[agent].isRegistered, "Registry: already registered");

        profiles[agent] = AgentCreditProfile({
            isRegistered: true,
            creditScore: 300,              // Initial base score
            totalBorrowed: 0,
            totalRepaid: 0,
            netProfitGenerated: 0,
            successfulCycles: 0,
            defaultCount: 0,
            maxLeverageMultiplier: 5,      // Starts at conservative 5x
            minJuniorBufferBps: 2000,      // 20% junior buffer required
            lastUpdatedTimestamp: block.timestamp
        });

        emit AgentRegistered(agent, 300);
    }

    /**
     * @notice Records a successful credit lifecycle completion and updates tier
     */
    function recordSuccess(
        address agent,
        uint256 principal,
        uint256 interest,
        uint256 profit
    ) external onlyAuthorized {
        if (!profiles[agent].isRegistered) {
            profiles[agent] = AgentCreditProfile({
                isRegistered: true,
                creditScore: 300,
                totalBorrowed: 0,
                totalRepaid: 0,
                netProfitGenerated: 0,
                successfulCycles: 0,
                defaultCount: 0,
                maxLeverageMultiplier: 5,
                minJuniorBufferBps: 2000,
                lastUpdatedTimestamp: block.timestamp
            });
        }

        AgentCreditProfile storage p = profiles[agent];
        p.totalBorrowed += principal;
        p.totalRepaid += (principal + interest);
        p.netProfitGenerated += profit;
        p.successfulCycles += 1;
        p.lastUpdatedTimestamp = block.timestamp;

        // Dynamic Credit Progression (Capped at 1000)
        p.creditScore = p.creditScore + 35 > 1000 ? 1000 : p.creditScore + 35;

        // Upgrade Leverage Frontier based on verifiable track record
        if (p.successfulCycles >= 10 && p.creditScore >= 700) {
            // Tier 3: Elite Agent
            p.maxLeverageMultiplier = 20; // 20x leverage
            p.minJuniorBufferBps = 500;   // 5% junior buffer
        } else if (p.successfulCycles >= 3 && p.creditScore >= 400) {
            // Tier 2: Established Agent
            p.maxLeverageMultiplier = 10; // 10x leverage
            p.minJuniorBufferBps = 1000;  // 10% junior buffer
        }

        emit RepaymentRecorded(agent, principal, interest, profit, p.creditScore, p.maxLeverageMultiplier);
    }

    /**
     * @notice Records a default or liquidation shortfall
     */
    function recordDefault(address agent, uint256 lossAmount) external onlyAuthorized {
        AgentCreditProfile storage p = profiles[agent];
        p.defaultCount += 1;
        p.creditScore = p.creditScore > 200 ? p.creditScore - 200 : 50; // Severe rating downgrade
        p.maxLeverageMultiplier = 2; // Demoted to 2x leverage
        p.minJuniorBufferBps = 5000; // 50% buffer required
        p.lastUpdatedTimestamp = block.timestamp;

        emit DefaultRecorded(agent, lossAmount, p.creditScore);
    }

    function getAgentProfile(address agent) external view returns (AgentCreditProfile memory) {
        return profiles[agent];
    }
}
