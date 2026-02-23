/**
 * Impersonation banner — shown at the top of every page when an admin
 * is impersonating another user. Provides a "Stop" button to end
 * impersonation and return to the admin's real identity.
 */

"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ImpersonationBanner() {
  const { data: session } = useSession();
  const router = useRouter();
  const [stopping, setStopping] = useState(false);

  if (!session?.user?.isImpersonating) return null;

  async function handleStop() {
    setStopping(true);
    await fetch("/api/admin/impersonate", { method: "DELETE" });
    router.push("/admin");
    router.refresh();
  }

  return (
    <div className="bg-amber-100 border-b border-amber-300 px-4 py-2 text-sm text-amber-900 flex items-center justify-center gap-3">
      <span>
        Impersonating <strong>{session.user.name}</strong>{" "}
        <span className="text-amber-700">({session.user.orcid})</span>
      </span>
      <button
        onClick={handleStop}
        disabled={stopping}
        className="rounded bg-amber-200 px-2.5 py-0.5 text-xs font-medium text-amber-900 hover:bg-amber-300 disabled:opacity-50"
      >
        {stopping ? "Stopping..." : "Stop Impersonating"}
      </button>
    </div>
  );
}
