CREATE TABLE `conversation_segments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`chat_id` integer NOT NULL,
	`start_seq` integer NOT NULL,
	`end_seq` integer NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text NOT NULL,
	`message_count` integer NOT NULL,
	`summary` text NOT NULL,
	`summary_norm` text NOT NULL,
	`topics` text DEFAULT '[]' NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`import_id` integer,
	`job_id` integer,
	`source_kind` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `conversation_segments_owner_idx` ON `conversation_segments` (`owner_id`);--> statement-breakpoint
CREATE INDEX `conversation_segments_owner_chat_started_idx` ON `conversation_segments` (`owner_id`,`chat_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `conversation_segments_owner_import_idx` ON `conversation_segments` (`owner_id`,`import_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_segments_span_uq` ON `conversation_segments` (`owner_id`,`chat_id`,`start_seq`,`end_seq`);--> statement-breakpoint
CREATE TABLE `loops` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`person_id` integer NOT NULL,
	`direction` text NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`text_norm` text NOT NULL,
	`due_at` text,
	`opened_message_id` integer,
	`opened_at` text NOT NULL,
	`closed_message_id` integer,
	`closed_at` text,
	`closed_reason` text,
	`status` text NOT NULL,
	`import_id` integer,
	`job_id` integer,
	`source_kind` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`opened_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`closed_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `loops_owner_idx` ON `loops` (`owner_id`);--> statement-breakpoint
CREATE INDEX `loops_owner_person_status_idx` ON `loops` (`owner_id`,`person_id`,`status`);--> statement-breakpoint
CREATE INDEX `loops_owner_import_idx` ON `loops` (`owner_id`,`import_id`);--> statement-breakpoint
CREATE INDEX `loops_owner_status_norm_idx` ON `loops` (`owner_id`,`status`,`text_norm`);--> statement-breakpoint
CREATE INDEX `loops_owner_due_idx` ON `loops` (`owner_id`,`due_at`);--> statement-breakpoint
CREATE TABLE `segment_participants` (
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`segment_id` integer NOT NULL,
	`person_id` integer NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`segment_id`, `person_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`segment_id`) REFERENCES `conversation_segments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `segment_participants_owner_idx` ON `segment_participants` (`owner_id`);--> statement-breakpoint
CREATE INDEX `segment_participants_person_idx` ON `segment_participants` (`person_id`,`segment_id`);