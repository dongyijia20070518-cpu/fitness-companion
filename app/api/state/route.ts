import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { userStates } from "../../../db/schema";
import { emptyState, type AppState } from "../../../lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const row = await getDb().query.userStates.findFirst({ where: eq(userStates.userId, user.userId) });
  if (!row) return NextResponse.json({ state: emptyState(), version: 0, updatedAt: 0 });
  return NextResponse.json({ state: JSON.parse(row.payload), version: row.version, updatedAt: row.updatedAt });
}

export async function PUT(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json()) as { state?: AppState; baseVersion?: number };
  if (!body.state || body.state.schemaVersion !== 2 || typeof body.baseVersion !== "number") {
    return NextResponse.json({ error: "invalid_state" }, { status: 400 });
  }
  const serialized = JSON.stringify(body.state);
  if (serialized.length > 900_000) return NextResponse.json({ error: "state_too_large" }, { status: 413 });
  const db = getDb();
  const current = await db.query.userStates.findFirst({ where: eq(userStates.userId, user.userId) });
  if (current && current.version !== body.baseVersion) {
    return NextResponse.json({ state: JSON.parse(current.payload), version: current.version, updatedAt: current.updatedAt }, { status: 409 });
  }
  const now = Date.now();
  const nextVersion = (current?.version ?? 0) + 1;
  if (current) {
    await db.update(userStates).set({ email: user.email, payload: serialized, version: nextVersion, updatedAt: now }).where(eq(userStates.userId, user.userId));
  } else {
    await db.insert(userStates).values({ userId: user.userId, email: user.email, payload: serialized, version: nextVersion, createdAt: now, updatedAt: now });
  }
  return NextResponse.json({ version: nextVersion, updatedAt: now });
}

export async function DELETE() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await getDb().delete(userStates).where(eq(userStates.userId, user.userId));
  return NextResponse.json({ ok: true });
}
