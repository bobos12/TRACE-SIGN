import { z } from "zod";
import { userRoute } from "@/lib/api";
import { db, t } from "@/lib/db";
import { hashPassword } from "@/lib/crypto";
import { env } from "@/lib/env";
import { conflict } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Adds a team member to the signed-in user's workspace. */
export const POST = userRoute(async (req, _ctx, user) => {
  const b = z
    .object({
      email: z.string().trim().toLowerCase().email(),
      name: z.string().trim().min(1).max(120),
      role: z.enum(["admin", "member"]),
      password: z.string().min(12, "Use at least 12 characters").max(200),
    })
    .parse(await req.json());
  if (b.email === env.adminEmail()) throw conflict("That address is the built-in owner account.");
  const [row] = await db
    .insert(t.users)
    .values({ orgId: user.orgId, email: b.email, name: b.name, role: b.role, passwordHash: hashPassword(b.password) })
    .onConflictDoNothing()
    .returning({ id: t.users.id });
  if (!row) throw conflict("A user with that email already exists.");
  return { id: row.id };
}, { manage: true });
