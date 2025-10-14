import { cookies } from "next/headers";
export type User = { id: string; email: string };
export async function getUser(): Promise<User> {
  const ck = (await cookies()).get("demo_user")?.value;
  if (ck) return JSON.parse(ck);
  return { id: "demo", email: "demo@aluno.com" };
}
export async function requireCredit(_userId: string) { return true; }
