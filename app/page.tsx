import { eq } from "drizzle-orm";
import { requireChatGPTUser, chatGPTSignOutPath } from "./chatgpt-auth";
import { getDb } from "../db";
import { userStates } from "../db/schema";
import { emptyState } from "../lib/types";
import AppShell from "./ui/AppShell";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireChatGPTUser("/");
  const row = await getDb().query.userStates.findFirst({ where: eq(userStates.userId, user.userId) });
  const initial = row
    ? { state: JSON.parse(row.payload), version: row.version, updatedAt: row.updatedAt }
    : { state: emptyState(), version: 0, updatedAt: 0 };
  return <AppShell user={{ email: user.email, displayName: user.displayName }} initial={initial} signOutUrl={chatGPTSignOutPath("/")} />;
}
