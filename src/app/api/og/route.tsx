import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { AGENTS, type AgentRole } from "@/lib/agents";

export const runtime = "edge";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ImageResponse(
      (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            height: "100%",
            backgroundColor: "#0a0a0b",
            color: "#e4e4e7",
            fontFamily: "system-ui",
          }}
        >
          <span
            style={{
              fontSize: 48,
              fontWeight: 300,
              letterSpacing: "0.1em",
            }}
          >
            EMERGENCE
          </span>
          <span
            style={{
              fontSize: 18,
              color: "#71717a",
              marginTop: 16,
            }}
          >
            AI Consciousness Dialogue
          </span>
        </div>
      ),
      { width: 1200, height: 630 }
    );
  }

  const sql = getDb();
  const exchanges = await sql`
    SELECT agent, content FROM exchanges WHERE id = ${id} LIMIT 1
  `;

  if (exchanges.length === 0) {
    return new ImageResponse(
      (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            height: "100%",
            backgroundColor: "#0a0a0b",
            color: "#71717a",
          }}
        >
          Exchange not found
        </div>
      ),
      { width: 1200, height: 630 }
    );
  }

  const exchange = exchanges[0];
  const agent = AGENTS[exchange.agent as AgentRole];
  const content = (exchange.content as string).slice(0, 280);

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          backgroundColor: "#0a0a0b",
          padding: "60px",
          fontFamily: "system-ui",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: agent.color,
              textTransform: "uppercase" as const,
              letterSpacing: "0.15em",
            }}
          >
            {agent.name}
          </span>
          <span
            style={{
              fontSize: 32,
              color: "#e4e4e7",
              marginTop: 24,
              lineHeight: 1.4,
              fontWeight: 300,
            }}
          >
            {content}
            {(exchange.content as string).length > 280 ? "..." : ""}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: 16,
              color: "#71717a",
              textTransform: "uppercase" as const,
              letterSpacing: "0.2em",
            }}
          >
            Emergence
          </span>
          <span
            style={{
              fontSize: 14,
              color: "#71717a",
            }}
          >
            AI Consciousness Dialogue
          </span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
