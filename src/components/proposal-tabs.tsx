/**
 * ProposalTabs — Tab navigation between Queue and Archive views.
 *
 * Client component that renders tab buttons and conditionally displays
 * either the SwipeQueue or ArchiveTab based on the active tab.
 *
 * Spec reference: specs/swipe-interface.md — the swipe interface has
 * a Queue (main swipe view) and an Archive tab.
 */

"use client";

import { useState } from "react";
import { SwipeQueue } from "@/components/swipe-queue";
import { ArchiveTab } from "@/components/archive-tab";

interface ProposalTabsProps {
  hasMatchPool: boolean;
}

type Tab = "queue" | "archive";

export function ProposalTabs({ hasMatchPool }: ProposalTabsProps) {
  const [activeTab, setActiveTab] = useState<Tab>("queue");

  return (
    <div>
      {/* Tab bar */}
      <div className="flex justify-center mb-6">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
          <button
            onClick={() => setActiveTab("queue")}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "queue"
                ? "bg-gray-900 text-white"
                : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
            }`}
          >
            Queue
          </button>
          <button
            onClick={() => setActiveTab("archive")}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "archive"
                ? "bg-gray-900 text-white"
                : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
            }`}
          >
            Archive
          </button>
        </div>
      </div>

      {/* Tab content */}
      {activeTab === "queue" && <SwipeQueue hasMatchPool={hasMatchPool} />}
      {activeTab === "archive" && <ArchiveTab />}
    </div>
  );
}
