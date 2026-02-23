import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import "./globals.css";

export const metadata: Metadata = {
  title: "CoPI - Collaborative PI Matching",
  description:
    "Discover synergistic collaboration opportunities with fellow researchers",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        <Providers>
          <ImpersonationBanner />
          {children}
        </Providers>
      </body>
    </html>
  );
}
