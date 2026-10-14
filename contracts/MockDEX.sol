// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./MockERC20.sol";

/**
 * @title MockDEX
 * @notice Simulates an on-chain CLOB/AMM exchange on Monad (Perpl / Kuru)
 * Allows executing swaps, simulated arbitrage gains, and controlled slippage for testing.
 */
contract MockDEX {
    // Exchange rate in basis points (10000 = 1:1, 10200 = +2% profit, 9800 = -2% loss)
    uint256 public exchangeRateBps = 10000;

    event Swapped(
        address indexed caller,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    function setRate(uint256 _rateBps) external {
        exchangeRateBps = _rateBps;
    }

    /**
     * @notice Swaps tokenIn for tokenOut using current rate
     */
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) external returns (uint256 amountOut) {
        require(amountIn > 0, "DEX: zero amount in");

        // Pull tokenIn from caller
        MockERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);

        // Calculate amountOut based on exchangeRateBps
        amountOut = (amountIn * exchangeRateBps) / 10000;
        require(amountOut >= minAmountOut, "DEX: slippage limit exceeded");

        // Mint or transfer tokenOut to caller
        MockERC20(tokenOut).mint(msg.sender, amountOut);

        emit Swapped(msg.sender, tokenIn, tokenOut, amountIn, amountOut);
    }
}
