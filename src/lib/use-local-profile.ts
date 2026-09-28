"use client";

import { useQuery } from "@tanstack/react-query";

export interface LocalProfileData {
  user: { id: string; name: string; email: string };
}

/** Local single-user profile — replaces Better Auth's useSession. Same result
 *  shape (`data.user.id`) so call sites stay unchanged. */
export function useLocalProfile() {
  return useQuery({
    queryKey: ["profile"],
    queryFn: async (): Promise<LocalProfileData | null> => {
      const res = await fetch("/api/auth/local");
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: Infinity,
  });
}
