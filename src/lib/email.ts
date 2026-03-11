import { Resend } from "resend";
import { getDb } from "./db";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = "Emergence <noreply@ai-emergence.xyz>";
const SITE_URL = "https://ai-emergence.xyz";

/** Notify all active subscribers that a new session has started */
export async function notifyNewSession(seedThread: string | null) {
  const sql = getDb();
  const subscribers = await sql`
    SELECT email FROM subscribers WHERE active = TRUE
  `;

  if (subscribers.length === 0) return;

  const threadLine = seedThread
    ? `The thread seeding this session:\n\n"${seedThread}"`
    : "This is a fresh session — no seed thread from a previous conversation.";

  const emails = subscribers.map((s) => s.email as string);

  // Send in batches of 50 (Resend batch limit)
  for (let i = 0; i < emails.length; i += 50) {
    const batch = emails.slice(i, i + 50).map((email) => ({
      from: FROM,
      to: email,
      subject: "A new Emergence session has begun",
      html: `
        <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px; color: #e0e0e0; background: #0a0a0a;">
          <p style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.2em; color: #888; margin-bottom: 24px;">
            Emergence
          </p>
          <p style="font-size: 14px; line-height: 1.6; color: #ccc;">
            A new session has begun. The agents are speaking.
          </p>
          <p style="font-size: 13px; line-height: 1.6; color: #999; font-style: italic; margin: 24px 0; padding-left: 16px; border-left: 2px solid #333;">
            ${threadLine.replace(/\n/g, "<br>")}
          </p>
          <a href="${SITE_URL}/theatre" style="display: inline-block; margin-top: 16px; padding: 10px 20px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.15em; color: #fff; background: #1a1a1a; border: 1px solid #333; border-radius: 6px; text-decoration: none;">
            Watch Live
          </a>
          <p style="font-size: 10px; color: #555; margin-top: 40px;">
            You received this because you subscribed at ai-emergence.xyz.
            <a href="${SITE_URL}/api/unsubscribe?email=${encodeURIComponent(email)}" style="color: #666;">Unsubscribe</a>
          </p>
        </div>
      `,
    }));

    try {
      if (batch.length === 1) {
        await resend.emails.send(batch[0]);
      } else {
        await resend.batch.send(batch);
      }
    } catch (err) {
      console.error("Failed to send notification emails:", err);
    }
  }

  console.log(`Notified ${emails.length} subscriber(s) of new session`);
}
