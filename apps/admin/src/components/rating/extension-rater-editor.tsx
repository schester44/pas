import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Panel } from "@pas/ui/components/panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type * as React from "react";
import type { RatingConfig } from "@/components/catalog/version-editor";
import { formatDate } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

type ExtensionConfig = Extract<RatingConfig, { engine: "extension" }>;

/** The extension rater: which published version prices this product, in which currency. */
export function ExtensionRaterEditor({
  rating,
  readOnly,
  onChange,
  worksheet,
}: {
  rating: ExtensionConfig;
  readOnly: boolean;
  onChange: (next: ExtensionConfig) => void;
  worksheet: React.ReactNode;
}) {
  const trpc = useTRPC();
  const choices = useQuery(trpc.extensions.versionChoices.queryOptions({ point: "rate" }));
  const chosen = choices.data?.find((c) => c.versionId === rating.extensionVersionId);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <Panel
        title="Extension rater"
        description="A published extension version's rate export prices every selected coverage."
      >
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="extension-rater">Extension version</Label>
            <Select
              value={rating.extensionVersionId}
              onValueChange={(extensionVersionId) => onChange({ ...rating, extensionVersionId })}
              disabled={readOnly}
            >
              <SelectTrigger id="extension-rater">
                <SelectValue placeholder="Choose a version" />
              </SelectTrigger>
              <SelectContent>
                {(choices.data ?? []).map((c) => (
                  <SelectItem
                    key={c.versionId}
                    value={c.versionId}
                    description={`Published ${formatDate(c.publishedAt)}`}
                  >
                    {c.name} · v{c.version}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {choices.data?.length === 0 && (
              <p className="m-0 text-xs text-muted-foreground">
                Publish an extension with the rate point first.{" "}
                <Link to="/extensions" className="font-medium text-primary hover:underline">
                  Extensions
                </Link>
              </p>
            )}
            {chosen && (
              <Link
                to="/extensions/$extensionId"
                params={{ extensionId: chosen.extensionId }}
                className="text-xs font-medium text-primary hover:underline"
              >
                Open {chosen.name}
              </Link>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="extension-currency">Currency</Label>
              <Input
                id="extension-currency"
                value={rating.currency}
                maxLength={3}
                readOnly={readOnly}
                className="uppercase"
                onChange={(e) => onChange({ ...rating, currency: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="grid gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <Label htmlFor="extension-timeout">Time limit (ms)</Label>
                <span className="text-xs text-muted-foreground">Optional</span>
              </div>
              <Input
                id="extension-timeout"
                type="number"
                min={100}
                max={15000}
                value={rating.timeoutMs ?? ""}
                readOnly={readOnly}
                className="tabular-nums"
                onChange={(e) => {
                  const { timeoutMs: _old, ...rest } = rating;

                  onChange(e.target.value ? { ...rest, timeoutMs: Number(e.target.value) } : rest);
                }}
              />
            </div>
          </div>
          <p className="m-0 text-sm text-muted-foreground">
            A failed or slow run stops the quote; it never falls back to a guessed premium.
          </p>
        </div>
      </Panel>
      {worksheet}
    </div>
  );
}
