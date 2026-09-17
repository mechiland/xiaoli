-- Custom SQL migration file, put your code below! ---- Custom migration (core): drizzle-kit 0.31 cannot emit expression indexes correctly.
-- SQLite treats NULLs as distinct, so global handles (chat_id NULL) need ifnull() to be unique (ARCHITECTURE §4.1).
CREATE UNIQUE INDEX `handles_owner_kind_value_chat_uq` ON `handles` (`owner_id`, `kind`, `value`, ifnull(`chat_id`, 0));
