/*
  Warnings:

  - Added the required column `submission_number` to the `quotes` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "quotes" ADD COLUMN     "submission_number" TEXT NOT NULL;
