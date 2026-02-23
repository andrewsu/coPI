/**
 * Admin landing page — redirects to the Users Overview.
 *
 * Per specs/admin-dashboard.md: "The default admin landing page"
 * is the Users Overview at /admin/users.
 */

import { redirect } from "next/navigation";

export default function AdminPage() {
  redirect("/admin/users");
}
