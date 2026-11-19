import { invalid, type Instant, type PlainDate } from "@pas/kernel";

export type FeedFormat = "bordereaux_csv" | "acord_xml";
export type FeedChannel = "sftp" | "email";
export type FeedSchedule = "daily" | "weekly" | "monthly";

export interface FeedDestination {
  host?: string;
  path?: string;
  username?: string;
  email?: string;
}

/** Scheduled exports for carriers without an API, with PAS as system of record (PLAN §12). */
export interface Feed {
  id: string;
  carrierId: string;
  name: string;
  format: FeedFormat;
  channel: FeedChannel;
  destination: FeedDestination;
  schedule: FeedSchedule;
  status: "active" | "paused";
  lastRunAt: Instant | null;
  createdAt: Instant;
  updatedAt: Instant;
}

export interface FeedDelivery {
  id: string;
  feedId: string;
  periodFrom: PlainDate;
  periodTo: PlainDate;
  status: "delivered" | "failed";
  fileName: string;
  storageKey: string | null;
  records: number;
  bytes: number;
  channel: FeedChannel;
  detail: string | null;
  deliveredAt: Instant;
}

export function assertFeed(feed: Pick<Feed, "name" | "channel" | "destination">) {
  if (!feed.name.trim()) throw invalid("Name the feed");

  if (feed.channel === "email" && !/^[^@\s]+@[^@\s]+$/.test(feed.destination.email ?? "")) {
    throw invalid("Enter the email address that receives the feed");
  }

  if (feed.channel === "sftp" && !feed.destination.host?.trim()) {
    throw invalid("Enter the SFTP host");
  }
}

/** The period a run covers: scheduled runs end the day before `today`, "send now" includes it. */
export function feedPeriod(
  schedule: FeedSchedule,
  today: PlainDate,
  options: { includeToday?: boolean } = {},
): { from: PlainDate; to: PlainDate } {
  const to = options.includeToday ? today : today.subtract({ days: 1 });

  const from =
    schedule === "daily"
      ? to
      : schedule === "weekly"
        ? to.subtract({ days: 6 })
        : to.subtract({ months: 1 }).add({ days: 1 });

  return { from, to };
}
