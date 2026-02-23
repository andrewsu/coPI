/**
 * 403 Forbidden page — shown to authenticated non-admin users
 * who attempt to access /admin/* routes.
 *
 * The middleware redirects non-admin users here instead of returning
 * inline HTML. This page provides a properly styled experience
 * consistent with the rest of the app.
 *
 * See specs/admin-dashboard.md: "Non-admin users who navigate to
 * /admin see a 403 page."
 */

import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-8">
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="text-6xl font-bold tracking-tight text-gray-300">
          403
        </h1>
        <div>
          <h2 className="text-xl font-semibold text-gray-900">
            Access Denied
          </h2>
          <p className="mt-2 text-gray-600">
            You do not have permission to access the admin dashboard.
          </p>
        </div>
        <Link
          href="/"
          className="inline-block rounded-lg bg-gray-900 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-gray-800"
        >
          Go Home
        </Link>
      </div>
    </main>
  );
}
