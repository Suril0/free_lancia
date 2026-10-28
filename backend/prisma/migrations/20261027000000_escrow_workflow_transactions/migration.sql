ALTER TABLE "Escrow" ADD COLUMN "submittedTx" TEXT;
ALTER TABLE "Escrow" ADD COLUMN "revisionTx" TEXT;
ALTER TABLE "Escrow" ADD COLUMN "disputeTx" TEXT;

CREATE UNIQUE INDEX "Escrow_submittedTx_key" ON "Escrow"("submittedTx");
CREATE UNIQUE INDEX "Escrow_revisionTx_key" ON "Escrow"("revisionTx");
CREATE UNIQUE INDEX "Escrow_disputeTx_key" ON "Escrow"("disputeTx");

ALTER TABLE "Dispute" ADD COLUMN "resolutionTx" TEXT;
ALTER TABLE "Dispute" ADD COLUMN "releaseToFreelancer" BOOLEAN;

CREATE UNIQUE INDEX "Dispute_resolutionTx_key" ON "Dispute"("resolutionTx");
