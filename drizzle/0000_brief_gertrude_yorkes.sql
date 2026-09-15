CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`message_id` integer NOT NULL,
	`kind` text NOT NULL,
	`file_name` text,
	`selected` integer DEFAULT false NOT NULL,
	`r2_key` text,
	`byte_size` integer,
	`mime` text,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attachments_owner_idx` ON `attachments` (`owner_id`);--> statement-breakpoint
CREATE INDEX `attachments_message_idx` ON `attachments` (`message_id`);--> statement-breakpoint
CREATE TABLE `chats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`note` text,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chats_owner_idx` ON `chats` (`owner_id`);--> statement-breakpoint
CREATE INDEX `chats_owner_title_idx` ON `chats` (`owner_id`,`title`);--> statement-breakpoint
CREATE TABLE `import_messages` (
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`import_id` integer NOT NULL,
	`message_id` integer NOT NULL,
	PRIMARY KEY(`import_id`, `message_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `import_messages_owner_idx` ON `import_messages` (`owner_id`);--> statement-breakpoint
CREATE INDEX `import_messages_message_idx` ON `import_messages` (`message_id`);--> statement-breakpoint
CREATE TABLE `imports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`chat_id` integer,
	`file_name` text NOT NULL,
	`file_sha256` text NOT NULL,
	`exported_at` text,
	`parser_version` text NOT NULL,
	`status` text NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`new_message_count` integer DEFAULT 0 NOT NULL,
	`date_from` text,
	`date_to` text,
	`stats` text NOT NULL,
	`error` text,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `imports_owner_idx` ON `imports` (`owner_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `imports_owner_sha_uq` ON `imports` (`owner_id`,`file_sha256`);--> statement-breakpoint
CREATE INDEX `imports_owner_created_idx` ON `imports` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`chat_id` integer NOT NULL,
	`first_import_id` integer,
	`sender_handle_id` integer,
	`sender_name` text NOT NULL,
	`sent_at` text NOT NULL,
	`seq` integer NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`meta` text,
	`fingerprint` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`first_import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`sender_handle_id`) REFERENCES `handles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `messages_owner_idx` ON `messages` (`owner_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `messages_chat_seq_uq` ON `messages` (`chat_id`,`seq`);--> statement-breakpoint
CREATE INDEX `messages_owner_chat_sent_idx` ON `messages` (`owner_id`,`chat_id`,`sent_at`);--> statement-breakpoint
CREATE INDEX `messages_first_import_idx` ON `messages` (`first_import_id`);--> statement-breakpoint
CREATE INDEX `messages_sender_handle_idx` ON `messages` (`sender_handle_id`);--> statement-breakpoint
CREATE TABLE `handles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`person_id` integer,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`value_norm` text NOT NULL,
	`chat_id` integer,
	`status` text NOT NULL,
	`import_id` integer,
	`source_kind` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `handles_owner_idx` ON `handles` (`owner_id`);--> statement-breakpoint
CREATE INDEX `handles_owner_value_norm_idx` ON `handles` (`owner_id`,`value_norm`);--> statement-breakpoint
CREATE INDEX `handles_person_idx` ON `handles` (`person_id`);--> statement-breakpoint
CREATE TABLE `persons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`label` text NOT NULL,
	`is_self` integer DEFAULT false NOT NULL,
	`merged_into_id` integer,
	`pinned` integer DEFAULT false NOT NULL,
	`avatar_r2_key` text,
	`last_message_at` text,
	`label_sort` text DEFAULT '' NOT NULL,
	`import_id` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`merged_into_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `persons_owner_idx` ON `persons` (`owner_id`);--> statement-breakpoint
CREATE INDEX `persons_owner_label_sort_idx` ON `persons` (`owner_id`,`label_sort`);--> statement-breakpoint
CREATE TABLE `relations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`from_person_id` integer NOT NULL,
	`to_person_id` integer NOT NULL,
	`type` text NOT NULL,
	`label` text,
	`status` text NOT NULL,
	`import_id` integer,
	`source_kind` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `relations_owner_idx` ON `relations` (`owner_id`);--> statement-breakpoint
CREATE INDEX `relations_from_idx` ON `relations` (`from_person_id`);--> statement-breakpoint
CREATE INDEX `relations_to_idx` ON `relations` (`to_person_id`);--> statement-breakpoint
CREATE INDEX `relations_owner_import_idx` ON `relations` (`owner_id`,`import_id`);--> statement-breakpoint
CREATE TABLE `claim_mentions` (
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`claim_id` integer NOT NULL,
	`person_id` integer NOT NULL,
	PRIMARY KEY(`claim_id`, `person_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `claim_mentions_owner_idx` ON `claim_mentions` (`owner_id`);--> statement-breakpoint
CREATE INDEX `claim_mentions_person_idx` ON `claim_mentions` (`person_id`);--> statement-breakpoint
CREATE TABLE `claims` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`person_id` integer NOT NULL,
	`statement` text NOT NULL,
	`statement_norm` text NOT NULL,
	`category` text NOT NULL,
	`valid_from` text,
	`valid_to` text,
	`learned_at` text NOT NULL,
	`confidence` real,
	`sensitive` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`status_reason` text,
	`status_changed_at` text NOT NULL,
	`supersedes_claim_id` integer,
	`superseded_by_claim_id` integer,
	`import_id` integer,
	`job_id` integer,
	`source_kind` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `claims_owner_idx` ON `claims` (`owner_id`);--> statement-breakpoint
CREATE INDEX `claims_owner_person_status_idx` ON `claims` (`owner_id`,`person_id`,`status`);--> statement-breakpoint
CREATE INDEX `claims_owner_import_idx` ON `claims` (`owner_id`,`import_id`);--> statement-breakpoint
CREATE INDEX `claims_owner_status_norm_idx` ON `claims` (`owner_id`,`status`,`statement_norm`);--> statement-breakpoint
CREATE TABLE `event_participants` (
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`event_id` integer NOT NULL,
	`person_id` integer NOT NULL,
	PRIMARY KEY(`event_id`, `person_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `event_participants_owner_idx` ON `event_participants` (`owner_id`);--> statement-breakpoint
CREATE INDEX `event_participants_person_idx` ON `event_participants` (`person_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`summary` text NOT NULL,
	`happened_at` text,
	`place` text,
	`status` text NOT NULL,
	`import_id` integer,
	`source_kind` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `events_owner_idx` ON `events` (`owner_id`);--> statement-breakpoint
CREATE INDEX `events_owner_import_idx` ON `events` (`owner_id`,`import_id`);--> statement-breakpoint
CREATE TABLE `evidence` (
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` integer NOT NULL,
	`message_id` integer NOT NULL,
	PRIMARY KEY(`target_type`, `target_id`, `message_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `evidence_owner_idx` ON `evidence` (`owner_id`);--> statement-breakpoint
CREATE INDEX `evidence_owner_message_idx` ON `evidence` (`owner_id`,`message_id`);--> statement-breakpoint
CREATE TABLE `important_dates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`person_id` integer NOT NULL,
	`kind` text NOT NULL,
	`day` integer,
	`month` integer,
	`year` integer,
	`calendar` text NOT NULL,
	`is_leap_month` integer DEFAULT false NOT NULL,
	`label` text,
	`status` text NOT NULL,
	`import_id` integer,
	`source_kind` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `important_dates_owner_idx` ON `important_dates` (`owner_id`);--> statement-breakpoint
CREATE INDEX `important_dates_person_idx` ON `important_dates` (`person_id`);--> statement-breakpoint
CREATE INDEX `important_dates_owner_import_idx` ON `important_dates` (`owner_id`,`import_id`);--> statement-breakpoint
CREATE TABLE `extraction_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`import_id` integer NOT NULL,
	`window_start_seq` integer NOT NULL,
	`window_end_seq` integer NOT NULL,
	`focus_start_seq` integer NOT NULL,
	`focus_end_seq` integer NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`locked_at` text,
	`model` text,
	`prompt_version` text,
	`raw_output` text,
	`error` text,
	`items_created` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `extraction_jobs_owner_idx` ON `extraction_jobs` (`owner_id`);--> statement-breakpoint
CREATE INDEX `extraction_jobs_import_status_idx` ON `extraction_jobs` (`import_id`,`status`);--> statement-breakpoint
CREATE TABLE `llm_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`purpose` text NOT NULL,
	`import_id` integer,
	`job_id` integer,
	`eval_run_id` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cache_hit_tokens` integer,
	`latency_ms` integer NOT NULL,
	`attempt` integer NOT NULL,
	`mode` text NOT NULL,
	`cassette_key` text,
	`raw_output` text,
	`finish_reason` text,
	`error_code` text,
	`error_message` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `llm_calls_owner_created_idx` ON `llm_calls` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `llm_calls_import_idx` ON `llm_calls` (`import_id`);--> statement-breakpoint
CREATE INDEX `llm_calls_created_idx` ON `llm_calls` (`created_at`);--> statement-breakpoint
CREATE TABLE `review_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` integer NOT NULL,
	`action` text NOT NULL,
	`before` text,
	`after` text,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `review_log_owner_idx` ON `review_log` (`owner_id`);--> statement-breakpoint
CREATE INDEX `review_log_owner_target_idx` ON `review_log` (`owner_id`,`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`self_display_names` text DEFAULT '[]' NOT NULL,
	`extract_model` text,
	`high_confidence_threshold` real DEFAULT 0.8 NOT NULL,
	`onboarded_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
