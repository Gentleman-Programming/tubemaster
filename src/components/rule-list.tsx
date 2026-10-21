"use client";

import { Button, EmptyState } from "@/components/ui";

type Rule = {
  id: number;
  name: string;
  matchField: string;
  matchType: string;
  matchValue: string;
  playlistTitle: string;
  enabled: boolean;
};

export function RuleList({
  rules,
  onDelete,
}: {
  rules: Rule[];
  onDelete: (id: number) => void;
}) {
  if (rules.length === 0) {
    return (
      <EmptyState title="No rules yet. Create one above to get started." />
    );
  }

  return (
    <div className="space-y-3">
      {rules.map((rule) => (
        <div
          key={rule.id}
          className="flex items-center justify-between gap-4 rounded-panel border border-line bg-surface-2 p-4 transition-colors hover:border-rose/30"
        >
          <div>
            <p className="font-medium text-fg">{rule.name}</p>
            <p className="mt-1 text-sm text-subtle">
              If{" "}
              <span className="font-mono text-sky">
                {rule.matchField}
              </span>{" "}
              <span className="font-mono text-muted">{rule.matchType}</span>{" "}
              <span className="font-mono text-rose">
                &quot;{rule.matchValue}&quot;
              </span>{" "}
              → add to{" "}
              <span className="font-semibold text-fg">{rule.playlistTitle}</span>
            </p>
          </div>
          <Button variant="danger" size="sm" onClick={() => onDelete(rule.id)}>
            Delete
          </Button>
        </div>
      ))}
    </div>
  );
}
