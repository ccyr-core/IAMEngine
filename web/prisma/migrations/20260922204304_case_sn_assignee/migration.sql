-- AlterTable
ALTER TABLE "CaseRequest" ADD COLUMN     "snAssignedTo" TEXT,
ADD COLUMN     "snAssignedToEmail" TEXT,
ADD COLUMN     "snAssigneeCheckedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "CaseRequest_snAssigneeCheckedAt_idx" ON "CaseRequest"("snAssigneeCheckedAt");
