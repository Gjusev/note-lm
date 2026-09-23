import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppNav } from "@/components/nav";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-paper flex flex-col">
      <AppNav userName={session.user.name || session.user.email} />
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
