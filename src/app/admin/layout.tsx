/**
 * Admin layout — shared wrapper for all /admin/* pages.
 *
 * Provides a consistent header with navigation links to all admin sections
 * (Users, Proposals, Stats) and a back-to-app link. Server component.
 *
 * Access control is handled by middleware (isAdmin check on JWT).
 * See specs/admin-dashboard.md for admin dashboard specification.
 */

import Link from "next/link";
import { ImpersonateForm } from "@/components/admin/impersonate-form";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link
              href="/admin"
              className="text-xl font-bold tracking-tight text-gray-900"
            >
              CoPI <span className="text-sm font-normal text-gray-500">Admin</span>
            </Link>
            <nav className="flex items-center gap-4">
              <Link
                href="/admin/users"
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                Users
              </Link>
              <Link
                href="/admin/proposals"
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                Proposals
              </Link>
              <Link
                href="/admin/stats"
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                Stats
              </Link>
              <Link
                href="/admin/jobs"
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                Jobs
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <ImpersonateForm />
            <Link
              href="/"
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Back to App
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        {children}
      </main>
    </div>
  );
}
