const { expect } = require("chai");
const { ethers, network } = require("hardhat");

describe("FreelanciaEscrow", function () {
  let token;
  let escrow;
  let admin;
  let client;
  let freelancer;
  let arbiter;
  let feeRecipient;
  let outsider;

  const tokens = (value) => BigInt(value) * 1_000_000n;
  const Status = { Funded: 1n, Submitted: 2n, RevisionRequested: 3n, Disputed: 4n, Released: 5n, Refunded: 6n };

  async function createEscrow(amount = tokens(100), secondsUntilDeadline = 3600) {
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const deadline = now + secondsUntilDeadline + 10;
    await token.connect(client).approve(await escrow.getAddress(), amount);
    await escrow.connect(client).createEscrow(freelancer.address, amount, deadline);
    return { id: await escrow.nextEscrowId() - 1n, deadline };
  }

  beforeEach(async function () {
    [admin, client, freelancer, arbiter, feeRecipient, outsider] = await ethers.getSigners();
    token = await ethers.deployContract("MockPYUSD", [admin.address]);
    escrow = await ethers.deployContract("FreelanciaEscrow", [
      await token.getAddress(),
      admin.address,
      arbiter.address,
      feeRecipient.address
    ]);
    await token.mint(client.address, tokens(1000));
  });

  it("locks 6-decimal PYUSD and releases payment net of the 2% fee", async function () {
    const { id } = await createEscrow(tokens(100));
    expect(await token.balanceOf(await escrow.getAddress())).to.equal(tokens(100));
    expect((await escrow.escrows(id)).status).to.equal(Status.Funded);

    await escrow.connect(freelancer).submitWork(id);
    await expect(escrow.connect(client).release(id))
      .to.emit(escrow, "EscrowReleased")
      .withArgs(id, tokens(98), tokens(2));

    expect(await token.balanceOf(freelancer.address)).to.equal(tokens(98));
    expect(await token.balanceOf(feeRecipient.address)).to.equal(tokens(2));
    expect((await escrow.escrows(id)).status).to.equal(Status.Released);
  });

  it("supports revisions before final delivery and release", async function () {
    const { id } = await createEscrow();
    await escrow.connect(freelancer).submitWork(id);
    await expect(escrow.connect(client).requestRevision(id))
      .to.emit(escrow, "RevisionRequested")
      .withArgs(id, client.address, 1);
    expect((await escrow.escrows(id)).status).to.equal(Status.RevisionRequested);
    await escrow.connect(freelancer).submitWork(id);
    await escrow.connect(client).release(id);
    expect((await escrow.escrows(id)).revisionCount).to.equal(1);
    expect((await escrow.escrows(id)).status).to.equal(Status.Released);
  });

  it("allows only participants to raise disputes and only an arbiter to resolve", async function () {
    const { id } = await createEscrow();
    await expect(escrow.connect(outsider).raiseDispute(id)).to.be.revertedWithCustomError(escrow, "UnauthorizedParticipant");
    await escrow.connect(freelancer).raiseDispute(id);
    await expect(escrow.connect(client).release(id)).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    await expect(escrow.connect(outsider).resolveDispute(id, true)).to.be.reverted;
    await expect(escrow.connect(arbiter).resolveDispute(id, false))
      .to.emit(escrow, "DisputeResolved")
      .withArgs(id, false);
    expect(await token.balanceOf(client.address)).to.equal(tokens(1000));
    expect((await escrow.escrows(id)).status).to.equal(Status.Refunded);
  });

  it("allows the arbiter to release disputed work with the standard fee", async function () {
    const { id } = await createEscrow(tokens(100));
    await escrow.connect(freelancer).submitWork(id);
    await escrow.connect(client).raiseDispute(id);
    await expect(escrow.connect(arbiter).resolveDispute(id, true))
      .to.emit(escrow, "DisputeResolved")
      .withArgs(id, true);
    expect(await token.balanceOf(freelancer.address)).to.equal(tokens(98));
    expect(await token.balanceOf(feeRecipient.address)).to.equal(tokens(2));
    expect((await escrow.escrows(id)).status).to.equal(Status.Released);
  });

  it("refunds the client after a delivery timeout, with no fee", async function () {
    const { id, deadline } = await createEscrow(tokens(100), 3600);
    await network.provider.send("evm_setNextBlockTimestamp", [deadline + 1]);
    await network.provider.send("evm_mine");
    await expect(escrow.connect(client).claimTimeoutRefund(id))
      .to.emit(escrow, "EscrowRefunded")
      .withArgs(id, client.address, tokens(100));
    expect(await token.balanceOf(client.address)).to.equal(tokens(1000));
    expect((await escrow.escrows(id)).status).to.equal(Status.Refunded);
  });

  it("enforces role controls and pauses escrow activity", async function () {
    await expect(escrow.connect(outsider).pause()).to.be.reverted;
    await escrow.connect(admin).pause();
    await expect(createEscrow()).to.be.revertedWithCustomError(escrow, "EnforcedPause");
    await escrow.connect(admin).unpause();
    await createEscrow();
  });

  it("rejects invalid amount, deadline, and repeated terminal actions", async function () {
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await expect(
      escrow.connect(client).createEscrow(freelancer.address, 0, now + 3600)
    ).to.be.revertedWithCustomError(escrow, "InvalidAmount");
    await expect(
      escrow.connect(client).createEscrow(freelancer.address, tokens(1), now + 10)
    ).to.be.revertedWithCustomError(escrow, "InvalidDeadline");

    const { id } = await createEscrow();
    await escrow.connect(freelancer).submitWork(id);
    await escrow.connect(client).release(id);
    await expect(escrow.connect(client).release(id)).to.be.revertedWithCustomError(escrow, "InvalidStatus");
  });
});
