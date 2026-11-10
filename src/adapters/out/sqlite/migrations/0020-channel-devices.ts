import { type Kysely, sql } from "kysely";

// The browser that subscribed a push channel (plan v1.0 step 5a): logging out removes its
// subscriptions for the account's plans and responses, so a borrowed browser stops receiving them;
// the channel goes with the device. Channels made before have no device.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table notification_channels
    add column device_id text references devices (id) on delete cascade
  `.execute(db);
  await sql`create index notification_channels_device on notification_channels (device_id)`.execute(
    db,
  );
}
