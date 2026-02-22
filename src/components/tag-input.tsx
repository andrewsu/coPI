/**
 * TagInput — reusable editable chip/tag list for array profile fields.
 *
 * Used by both the onboarding review page and the profile edit page
 * to manage array fields like techniques, disease areas, etc.
 *
 * Features:
 * - Add items via Enter key or Add button
 * - Remove items via X button on each chip
 * - Case-insensitive duplicate prevention
 * - Optional minimum item count with validation message
 */

"use client";

import { useCallback, useState } from "react";

export interface TagInputProps {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  minItems?: number;
  helpText?: string;
}

export function TagInput({
  label,
  items,
  onChange,
  minItems,
  helpText,
}: TagInputProps) {
  const [inputValue, setInputValue] = useState("");

  const addItem = useCallback(() => {
    const trimmed = inputValue.trim();
    if (trimmed && !items.some((i) => i.toLowerCase() === trimmed.toLowerCase())) {
      onChange([...items, trimmed]);
      setInputValue("");
    }
  }, [inputValue, items, onChange]);

  const removeItem = useCallback(
    (index: number) => {
      onChange(items.filter((_, i) => i !== index));
    },
    [items, onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addItem();
      }
    },
    [addItem],
  );

  const tooFew = minItems !== undefined && items.length < minItems;

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      {helpText && (
        <p className="mt-0.5 text-xs text-gray-500">{helpText}</p>
      )}
      <div className="mt-1.5 flex flex-wrap gap-2">
        {items.map((item, idx) => (
          <span
            key={idx}
            className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-sm text-blue-800"
          >
            {item}
            <button
              type="button"
              onClick={() => removeItem(idx)}
              className="ml-0.5 text-blue-400 hover:text-blue-700 focus:outline-none"
              aria-label={`Remove ${item}`}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          </span>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type and press Enter to add"
          className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={addItem}
          disabled={!inputValue.trim()}
          className="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Add
        </button>
      </div>
      {tooFew && (
        <p className="mt-1 text-xs text-red-600">
          At least {minItems} required (currently {items.length})
        </p>
      )}
    </div>
  );
}
