const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const tokenAddress = process.env.PYUSD_TOKEN_ADDRESS;
  const arbiter = process.env.ARBITER_ADDRESS || deployer.address;
  const feeRecipient = process.env.FEE_RECIPIENT_ADDRESS || deployer.address;

  if (!tokenAddress) {
    throw new Error("Set PYUSD_TOKEN_ADDRESS to the deployed 6-decimal payment token address.");
  }

  const escrow = await ethers.deployContract("FreelanciaEscrow", [
    tokenAddress,
    deployer.address,
    arbiter,
    feeRecipient
  ]);
  await escrow.waitForDeployment();

  console.log(`FreelanciaEscrow deployed to ${await escrow.getAddress()}`);
  console.log(`Payment token: ${tokenAddress}`);
  console.log(`Arbiter: ${arbiter}`);
  console.log(`Fee recipient: ${feeRecipient}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
