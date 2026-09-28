import { AppNav } from "@/components/nav";
import { getLocalContext } from "@/lib/storage/local";
import { getOrCreateProfile } from "@/lib/services/profile";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Local app: the profile always exists — no session redirect. The
  // middleware guarantees the app-session cookie before we get here.
  const { db } = getLocalContext();
  const profile = await getOrCreateProfile(db);

  return (
    <div className="min-h-screen bg-paper flex flex-col">
      <AppNav userName={profile.name} />
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
