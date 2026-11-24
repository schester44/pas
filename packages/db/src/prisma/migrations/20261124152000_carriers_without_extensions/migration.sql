-- Carriers connect through a configured connector or feeds; tenant code isn't a connection mode.
UPDATE "carriers" SET "mode" = 'connector' WHERE "mode" = 'extension';

-- AlterTable
ALTER TABLE "carriers" DROP COLUMN "extension_key";

