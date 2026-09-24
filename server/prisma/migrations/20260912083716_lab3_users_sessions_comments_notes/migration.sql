-- Lab 3, Issue #29 — users, sessions, ticket ownership, comments and notes.
--
-- THIS FILE IS HAND-EDITED. Prisma generated `DROP TABLE "Requester"` followed
-- by `CREATE TABLE "User"`, because its schema language cannot express a table
-- rename. Applying that would have destroyed all 5 Requester rows and then
-- failed anyway, since re-adding Ticket_requesterId_fkey against an empty User
-- table violates 16 existing Ticket rows.
--
-- The drop/create pair is replaced with ALTER TABLE ... RENAME TO, exactly as
-- docs/lab-03/specification.md §7 requires. Every id is preserved, so every
-- Ticket.requesterId keeps resolving and no ticket row is rewritten (AC-08).
-- MIG-01 and MIG-02 exist to prove it.

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('REQUESTER', 'IT_STAFF', 'ADMINISTRATOR');

-- ---------------------------------------------------------------------------
-- Requester becomes User, in place.
--
-- The foreign key from Ticket is deliberately NOT dropped and re-created:
-- a constraint follows its table through a rename, so Ticket_requesterId_fkey
-- keeps its name and simply points at the renamed table. Dropping it would
-- mean re-validating it against 16 rows for no reason.
-- ---------------------------------------------------------------------------
ALTER TABLE "Requester" RENAME TO "User";
ALTER TABLE "User" RENAME CONSTRAINT "Requester_pkey" TO "User_pkey";
ALTER INDEX "Requester_email_key" RENAME TO "User_email_key";
ALTER SEQUENCE "Requester_id_seq" RENAME TO "User_id_seq";

-- ---------------------------------------------------------------------------
-- New User columns.
--
-- role, mustChangePassword and updatedAt each carry a DEFAULT, so Postgres
-- backfills the existing rows as it adds the column: every migrated account
-- becomes an active REQUESTER that must change its password before it can use
-- the application (specification.md §7 step 3).
--
-- passwordHash has no default in the schema, so it is added nullable, filled,
-- and only then made NOT NULL.
-- ---------------------------------------------------------------------------
ALTER TABLE "User" ADD COLUMN "role" "Role" NOT NULL DEFAULT 'REQUESTER';
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;

-- bcrypt hash (cost 10) of the development initial password 'ChangeMe123!',
-- documented in the README (BR-46). It is a local-development credential only,
-- and every account holding it is flagged mustChangePassword, so it can be used
-- exactly once — to set a real password.
UPDATE "User" SET "passwordHash" = '$2b$10$0yK88TmxPwZRqqur4eTVcexGbmfFq3EJnVMQl6dSFCI/j9/jODreO'
WHERE "passwordHash" IS NULL;

ALTER TABLE "User" ALTER COLUMN "passwordHash" SET NOT NULL;

-- BR-36: email is stored already trimmed and lower-cased, which is what makes
-- the plain unique index enough for case-insensitive uniqueness. This brings
-- the migrated rows into that shape (specification.md §7 step 6). It fails
-- loudly if two existing addresses differ only by capitalisation, which is the
-- correct outcome — that would be a duplicate account needing a human.
UPDATE "User" SET "email" = lower(btrim("email")) WHERE "email" <> lower(btrim("email"));

-- ---------------------------------------------------------------------------
-- Ticket gains ownership and the Requester resolution signal.
-- ---------------------------------------------------------------------------
ALTER TABLE "Ticket" ADD COLUMN     "ownerId" INTEGER,
ADD COLUMN     "requesterResolvedAt" TIMESTAMP(3);

-- BR-29: IT Priority is initialised from Requested Priority. Lab 2 left it
-- null on every row, so the migration backfills it (specification.md §7 step 4,
-- MIG-04). Both enums carry the same three labels, so the cast is total.
UPDATE "Ticket" SET "itPriority" = "requestedPriority"::text::"ITPriority"
WHERE "itPriority" IS NULL;

-- Ticket.ownerId is deliberately left null on every migrated row: they are
-- unassigned until IT Staff claim them, which is the correct starting state
-- under BR-27 (specification.md §7 step 5, MIG-05).

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicComment" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalNote" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- "User_email_key" is not created here: it already exists, renamed above from
-- "Requester_email_key" along with the table that owns it.
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "PublicComment_ticketId_idx" ON "PublicComment"("ticketId");

-- CreateIndex
CREATE INDEX "InternalNote_ticketId_idx" ON "InternalNote"("ticketId");

-- CreateIndex
CREATE INDEX "Ticket_ownerId_idx" ON "Ticket"("ownerId");

-- AddForeignKey
-- Ticket_requesterId_fkey is absent from this list on purpose: it survived the
-- rename untouched and already points at "User".
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicComment" ADD CONSTRAINT "PublicComment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicComment" ADD CONSTRAINT "PublicComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
