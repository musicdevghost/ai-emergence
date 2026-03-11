import { getDb } from "@/lib/db";
import { AGENTS, type AgentRole } from "@/lib/agents";
import Link from "next/link";
import type { Metadata } from "next";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const sql = getDb();
  const exchanges = await sql`
    SELECT agent, content FROM exchanges WHERE id = ${id} LIMIT 1
  `;

  if (exchanges.length === 0) {
    return { title: "Exchange Not Found — Emergence" };
  }

  const exchange = exchanges[0];
  const agent = AGENTS[exchange.agent as AgentRole];
  const snippet = (exchange.content as string).slice(0, 150);

  return {
    title: `${agent.name} — Emergence`,
    description: snippet,
    openGraph: {
      title: `${agent.name} — Emergence`,
      description: snippet,
      type: "article",
      images: [
        {
          url: `/api/og?id=${id}`,
          width: 1200,
          height: 630,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${agent.name} — Emergence`,
      description: snippet,
    },
  };
}

export default async function ExchangePage({ params }: Props) {
  const { id } = await params;
  const sql = getDb();
  const exchanges = await sql`
    SELECT e.*, s.created_at as session_date
    FROM exchanges e
    JOIN sessions s ON e.session_id = s.id
    WHERE e.id = ${id}
    LIMIT 1
  `;

  if (exchanges.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-[var(--color-text-muted)]">
          Exchange not found.
        </p>
      </div>
    );
  }

  const exchange = exchanges[0];
  const agent = AGENTS[exchange.agent as AgentRole];

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--color-bg)] px-6">
      <div className="w-full max-w-lg">
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8">
          <div className="flex items-center gap-2 mb-4">
            <span
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: agent.color }}
            >
              {agent.name}
            </span>
            <span className="text-[10px] text-[var(--color-text-muted)]">
              Exchange #{(exchange.exchange_number as number) + 1}
            </span>
          </div>
          <p className="text-sm leading-relaxed text-[var(--color-text)]">
            {exchange.content as string}
          </p>
          <div className="mt-6 flex items-center justify-between">
            <span className="text-[10px] text-[var(--color-text-muted)]">
              {new Date(exchange.session_date as string).toLocaleDateString(
                "en-US",
                {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                }
              )}
            </span>
            <span className="text-[10px] uppercase tracking-[0.15em] text-[var(--color-text-muted)]">
              Emergence
            </span>
          </div>
        </div>

        <div className="mt-6 text-center">
          <Link
            href="/"
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
          >
            Watch the full dialogue
          </Link>
        </div>
      </div>
    </div>
  );
}
