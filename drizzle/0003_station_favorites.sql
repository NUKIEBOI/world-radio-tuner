CREATE TABLE `station_favorites` (
	`uuid` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`stream_url` text NOT NULL,
	`homepage` text NOT NULL,
	`country` text NOT NULL,
	`country_code` text NOT NULL,
	`state` text NOT NULL,
	`tags` text NOT NULL,
	`codec` text NOT NULL,
	`bitrate` integer NOT NULL,
	`created_at` integer NOT NULL
);
