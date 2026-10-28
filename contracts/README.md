# Freelancia escrow contracts

This directory contains delivery step 5 only: a Hardhat project for an ERC-20
freelance escrow. The contract targets Solidity 0.8.24 and is designed to use
a 6-decimal PYUSD-compatible token; escrow amounts are specified in the token's
smallest unit (for example, `100 PYUSD` is `100_000_000`).

## State machine

`Funded → Submitted → Released` is the normal path. The client may instead
request a revision (`Submitted → RevisionRequested`), after which the
freelancer can submit again. Either participant can dispute an unresolved
escrow (`Funded`, `Submitted`, or `RevisionRequested → Disputed`); only an
account with `ARBITER_ROLE` can resolve it to release or refund. If no work has
been submitted by the agreed deadline, the client can claim a full refund from
`Funded`. The deadline must be at least one hour and at most 365 days in the
future when the escrow is created.

Successful release pays 98% to the freelancer and 2% to the configured fee
recipient. Refunds have no fee. `DEFAULT_ADMIN_ROLE` manages the arbiter role,
fee recipient, and pause state. Pausing blocks new escrows and state-changing
participant/arbiter operations. The contract uses SafeERC20, reentrancy
protection, and checks-effects-interactions for funds movement.

## Development

```sh
npm install
npm test
npm run compile
```

Deploy an already-deployed PYUSD-compatible token to Sepolia by setting
`SEPOLIA_RPC_URL`, `PRIVATE_KEY`, and `PYUSD_TOKEN_ADDRESS`. Optionally set
`ARBITER_ADDRESS` and `FEE_RECIPIENT_ADDRESS`; both default to the deployer.

```sh
npm run deploy:sepolia
```

`MockPYUSD` is for local testing only. It has six decimals and owner-controlled
minting. This prototype has no on-chain delivery content, automated
adjudication, or dispute appeal process. It is unaudited and must not be used
with real funds without an independent security review.
