-- CreateTable
CREATE TABLE "TicketNumberCounter" (
    "year" INTEGER NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TicketNumberCounter_pkey" PRIMARY KEY ("year")
);
