/**
 * Admin impersonation form — ORCID input in the admin header.
 * Submits to POST /api/admin/impersonate, then redirects to /
 * so the admin sees the app as the target user.
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ImpersonateForm() {
  const router = useRouter();
  const [orcid, setOrcid] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orcid: orcid.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to impersonate");
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input
        type="text"
        placeholder="ORCID to impersonate"
        value={orcid}
        onChange={(e) => {
          setOrcid(e.target.value);
          setError("");
        }}
        className="w-48 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 placeholder:text-gray-400"
      />
      <button
        type="submit"
        disabled={loading || !orcid.trim()}
        className="rounded-md bg-gray-100 px-2.5 py-1 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
      >
        {loading ? "..." : "Go"}
      </button>
      {error && (
        <span className="text-xs text-red-600 max-w-48 truncate" title={error}>
          {error}
        </span>
      )}
    </form>
  );
}
