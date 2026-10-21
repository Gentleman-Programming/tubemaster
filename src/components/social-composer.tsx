"use client";

import { useEffect, useState } from "react";
import type { JsonObject, SocialAccount, SocialPlatform, SocialPost } from "@/lib/social/contracts";
import {
  callSocialApi,
  describePlatformOptions,
  formatBytes,
  formatScheduledLocal,
  formatScheduledUtc,
  platformChip,
  platformLabel,
  SOCIAL_CAPTION_MAX_LENGTH,
  TIKTOK_PRIVACY_OPTIONS,
  TIKTOK_UNAUDITED_NOTICE,
  toLocalDateTime,
  type SocialApiResult,
  type SocialFetcher,
} from "@/lib/social/presentation";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";

/** Client copy of the queue preview reply; the server type lives in a server-only module. */
export type SocialPostPreview = {
  post: SocialPost;
  scheduledAtUtc: string;
  account: { id: string; platform: SocialPlatform; displayName: string };
  video: { stagingFile: string; size: number };
  confirmationToken: string;
  confirmationExpiresAt: string;
};

export type SocialSchedule = { mode: "now" } | { mode: "at"; localDateTime: string; timezone: string };

export type SocialPreviewBody = {
  platform: SocialPlatform;
  stagingFile: string;
  caption: string;
  platformOptions: JsonObject;
  schedule: SocialSchedule;
};

export type ComposerForm = {
  platform: SocialPlatform | "";
  caption: string;
  privacyLevel: string;
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
  shareToFeed: boolean;
  mode: "now" | "at";
  date: string;
  time: string;
  timezone: string;
};

export const emptyComposerForm: ComposerForm = {
  platform: "",
  caption: "",
  privacyLevel: "SELF_ONLY",
  disableComment: false,
  disableDuet: false,
  disableStitch: false,
  shareToFeed: true,
  mode: "now",
  date: "",
  time: "",
  timezone: "",
};

type StagedVideo = { stagingFile: string; filename: string; size?: number };
type ComposerErrors = Partial<Record<"video" | "platform" | "caption" | "schedule", string>>;

const defaultFetcher: SocialFetcher = (url, init) => fetch(url, init);
const STAGING_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}\.(mp4|mov|webm|mkv)$/i;

function isTimezone(value: string): boolean {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function validateComposer(form: ComposerForm, stagingFile: string, connected: SocialPlatform[]): ComposerErrors {
  const errors: ComposerErrors = {};
  if (!/\.(mp4|mov|webm|mkv)$/i.test(stagingFile)) errors.video = "Choose a video (mp4, mov, webm or mkv) to stage.";
  if (!form.platform || !connected.includes(form.platform)) errors.platform = "Choose a connected account.";
  if (!form.caption.trim()) errors.caption = "Enter a caption.";
  else if (form.caption.length > SOCIAL_CAPTION_MAX_LENGTH) errors.caption = `Caption must be at most ${SOCIAL_CAPTION_MAX_LENGTH} characters.`;
  if (form.mode === "at") {
    if (!toLocalDateTime(form.date, form.time)) errors.schedule = "Enter a valid date and time.";
    else if (!isTimezone(form.timezone)) errors.schedule = "Enter a valid IANA timezone, such as America/New_York.";
  }
  return errors;
}

export function buildPreviewBody(form: ComposerForm, stagingFile: string): SocialPreviewBody {
  const platform = form.platform as SocialPlatform;
  const platformOptions: JsonObject =
    platform === "tiktok"
      ? { privacyLevel: form.privacyLevel, disableComment: form.disableComment, disableDuet: form.disableDuet, disableStitch: form.disableStitch }
      : { shareToFeed: form.shareToFeed };
  const localDateTime = toLocalDateTime(form.date, form.time);
  const schedule: SocialSchedule =
    form.mode === "at" && localDateTime ? { mode: "at", localDateTime, timezone: form.timezone } : { mode: "now" };
  return { platform, stagingFile, caption: form.caption, platformOptions, schedule };
}

export async function stageSocialVideo(
  file: File,
  fetcher: SocialFetcher = defaultFetcher,
): Promise<{ ok: true; staged: Required<StagedVideo> } | { ok: false; message: string }> {
  const body = new FormData();
  body.append("file", file);
  try {
    const response = await fetcher("/api/youtube/upload/stage", { method: "POST", body });
    if (response.status === 401) return { ok: false, message: "Session expired. Sign in again before staging." };
    if (response.status === 400) return { ok: false, message: "Video could not be staged. Check its extension and size, then try again." };
    if (!response.ok) return { ok: false, message: "Video staging is unavailable. Try again later." };
    const staged = (await response.json()) as Partial<StagedVideo>;
    if (typeof staged.stagingFile !== "string" || !STAGING_FILE_PATTERN.test(staged.stagingFile)) {
      return { ok: false, message: "Video staging returned an unexpected reply. Try again." };
    }
    return {
      ok: true,
      staged: { stagingFile: staged.stagingFile, filename: staged.filename ?? file.name, size: staged.size ?? file.size },
    };
  } catch {
    return { ok: false, message: "Video staging is unavailable. Try again later." };
  }
}

const jsonPost = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** Creates a draft and returns what will be posted; nothing is published by this call. */
export function requestPostPreview(body: SocialPreviewBody, fetcher: SocialFetcher = defaultFetcher): Promise<SocialApiResult<SocialPostPreview>> {
  return callSocialApi<SocialPostPreview>(fetcher, "/api/social/posts", jsonPost(body));
}

export function confirmSocialPost(postId: string, confirmationToken: string, fetcher: SocialFetcher = defaultFetcher): Promise<SocialApiResult<SocialPost>> {
  return callSocialApi<SocialPost>(fetcher, `/api/social/posts/${encodeURIComponent(postId)}/confirm`, jsonPost({ confirmationToken }));
}

const optionsFieldsetClass = "space-y-3 rounded-panel border border-line bg-glass p-4";
const legendClass = "px-1 font-mono text-xs uppercase tracking-widest text-subtle";
/** Selectable chip around a native radio; the checked state comes from the input itself. */
const choiceChipClass =
  "flex cursor-pointer items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-dim transition-colors hover:border-rose/40 has-checked:border-rose/60 has-checked:bg-rose/10 has-checked:text-fg has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-rose has-disabled:cursor-not-allowed has-disabled:opacity-50";
const termClass = "font-mono text-xs uppercase tracking-widest text-subtle sm:pt-0.5";

export function SocialPostPreviewCard({
  preview,
  videoName,
  displayTimezone,
  publishNow = false,
  busy,
  onConfirm,
  onBack,
}: {
  preview: SocialPostPreview;
  videoName?: string;
  /** Used for "publish now" posts, which the queue stores in UTC. */
  displayTimezone: string;
  publishNow?: boolean;
  busy: boolean;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const { post } = preview;
  const timezone = publishNow ? displayTimezone : post.timezone;
  return (
    <div aria-label="Post preview" className="space-y-4 rounded-card border border-rose/40 bg-surface p-5 text-sm shadow-glow">
      <p className="flex items-start gap-2 font-medium text-fg">
        <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-rose" />
        Review exactly what will be posted. Nothing is posted until you confirm.
      </p>
      <dl className="grid gap-x-4 gap-y-3 rounded-panel border border-line-soft bg-glass p-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <dt className={termClass}>Account</dt>
        <dd className="flex items-center gap-2 text-fg">
          <span aria-hidden="true" className={cn("size-2 rounded-full", platformChip(preview.account.platform).dotClassName)} />
          {preview.account.displayName} ({platformLabel(preview.account.platform)})
        </dd>
        <dt className={termClass}>Video</dt>
        <dd className="font-mono text-xs text-dim">{videoName ?? preview.video.stagingFile} · {formatBytes(preview.video.size)}</dd>
        <dt className={termClass}>Caption</dt>
        <dd className="whitespace-pre-wrap break-words text-fg">{post.caption}</dd>
        <dt className={termClass}>Options</dt>
        <dd>
          <ul className="space-y-0.5 font-mono text-xs text-dim">{describePlatformOptions(post.platform, post.platformOptions).map((line) => <li key={line}>{line}</li>)}</ul>
        </dd>
        <dt className={termClass}>When</dt>
        <dd className="space-y-0.5">
          {publishNow && <p className="text-dim">As soon as you confirm (within 5 minutes of this preview).</p>}
          <p className="font-mono text-fg">{formatScheduledLocal(preview.scheduledAtUtc, timezone)}</p>
          <p className="font-mono text-xs text-subtle"><time dateTime={preview.scheduledAtUtc}>{formatScheduledUtc(preview.scheduledAtUtc)}</time></p>
        </dd>
      </dl>
      <p className="text-xs text-muted">
        This confirmation expires at <span className="font-mono">{formatScheduledLocal(preview.confirmationExpiresAt, displayTimezone)}</span>. After that, preview again.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button disabled={busy} onClick={onConfirm}>
          {publishNow ? "Confirm and publish now" : "Confirm and schedule"}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onBack}>Back</Button>
      </div>
    </div>
  );
}

export function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function SocialComposer({
  accounts,
  stagingFile,
  fetcher = defaultFetcher,
  onQueueChange,
}: {
  accounts: SocialAccount[] | null;
  /** An already staged file name to reuse instead of choosing a new file. */
  stagingFile?: string;
  fetcher?: SocialFetcher;
  onQueueChange?: () => void;
}) {
  const [form, setForm] = useState<ComposerForm>(emptyComposerForm);
  const [localTimezone, setLocalTimezone] = useState("UTC");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [stagedFrom, setStagedFrom] = useState<File | null>(null);
  const [staged, setStaged] = useState<StagedVideo | null>(stagingFile ? { stagingFile, filename: stagingFile } : null);
  const [errors, setErrors] = useState<ComposerErrors>({});
  const [preview, setPreview] = useState<{ value: SocialPostPreview; publishNow: boolean; videoName: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    // Resolved on the client so server rendering never shows the server's timezone.
    const timezone = browserTimezone();
    setLocalTimezone(timezone);
    setForm((current) => (current.timezone ? current : { ...current, timezone }));
  }, []);

  if (accounts === null) return <p role="status" className="font-mono text-sm text-subtle">Loading connected accounts...</p>;
  const connected = accounts.map((account) => account.platform);
  if (!connected.length) {
    return <p className="text-sm text-subtle">Connect a TikTok or Instagram account above to publish videos.</p>;
  }
  const platform = form.platform && connected.includes(form.platform) ? form.platform : connected[0];
  const current: ComposerForm = { ...form, platform };

  function update<K extends keyof ComposerForm>(key: K, value: ComposerForm[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  async function submitPreview() {
    const nextErrors = validateComposer(current, selectedFile?.name ?? staged?.stagingFile ?? "", connected);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setBusy(true);
    setMessage("");
    let video = staged;
    if (selectedFile && stagedFrom !== selectedFile) {
      setMessage("Staging video...");
      const result = await stageSocialVideo(selectedFile, fetcher);
      if (!result.ok) {
        setMessage(result.message);
        setBusy(false);
        return;
      }
      video = result.staged;
      setStaged(result.staged);
      setStagedFrom(selectedFile);
    }
    if (!video) {
      setBusy(false);
      return;
    }
    const result = await requestPostPreview(buildPreviewBody(current, video.stagingFile), fetcher);
    setBusy(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setMessage("");
    setPreview({ value: result.body, publishNow: current.mode === "now", videoName: video.filename });
    onQueueChange?.();
  }

  async function confirm() {
    if (!preview) return;
    setBusy(true);
    const result = await confirmSocialPost(preview.value.post.id, preview.value.confirmationToken, fetcher);
    setBusy(false);
    if (!result.ok) {
      // Any failure (expired token, changed post, missed time) needs a fresh preview.
      setPreview(null);
      setMessage(`${result.message} The unconfirmed draft stays in the queue until you cancel it.`);
      onQueueChange?.();
      return;
    }
    setPreview(null);
    setMessage(
      preview.publishNow
        ? "Confirmed. The post is published within a minute while the app is running."
        : `Scheduled for ${formatScheduledLocal(result.body.scheduledAtUtc, result.body.timezone)}. Keep the app running at that time.`,
    );
    onQueueChange?.();
  }

  if (preview) {
    return (
      <div className="space-y-3">
        <SocialPostPreviewCard
          preview={preview.value}
          videoName={preview.videoName}
          displayTimezone={localTimezone}
          publishNow={preview.publishNow}
          busy={busy}
          onConfirm={() => void confirm()}
          onBack={() => {
            setPreview(null);
            setMessage("The unconfirmed draft stays in the queue until you cancel it.");
          }}
        />
        <p role="status" aria-live="polite" className="text-sm text-dim">{message}</p>
      </div>
    );
  }

  const fieldError = (key: keyof ComposerErrors) =>
    errors[key] && <p id={`social-error-${key}`} className="text-sm text-danger">{errors[key]}</p>;
  const checkbox = (key: "disableComment" | "disableDuet" | "disableStitch" | "shareToFeed", label: string) => (
    <label className="flex items-center gap-2 text-sm text-dim">
      <input type="checkbox" checked={current[key]} onChange={(event) => update(key, event.target.checked)} disabled={busy} className="size-4 accent-rose" />
      {label}
    </label>
  );

  return (
    <form noValidate className="space-y-5" onSubmit={(event) => { event.preventDefault(); void submitPreview(); }}>
      <div className="space-y-1">
        <Label htmlFor="social-video" className="block">Video file</Label>
        <input
          id="social-video"
          type="file"
          accept=".mp4,.mov,.webm,.mkv"
          onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
          disabled={busy}
          aria-invalid={!!errors.video}
          aria-describedby={errors.video ? "social-error-video" : undefined}
          className="w-full min-w-0 rounded-control border border-dashed border-line bg-surface p-2 text-sm text-dim transition-colors file:mr-3 file:rounded-control file:border-0 file:bg-surface-3 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-fg hover:border-rose/40 focus-visible:outline-2 focus-visible:outline-rose/40 disabled:opacity-50 aria-invalid:border-danger"
        />
        {staged && !selectedFile && <p className="text-sm text-dim">Using staged file <span className="font-mono">{staged.filename}</span>.</p>}
        {selectedFile && <p className="text-sm text-dim">Selected: {selectedFile.name}{stagedFrom === selectedFile ? " — staged" : " — staged when you preview"}</p>}
        {fieldError("video")}
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-dim">Account</legend>
        <div className="flex flex-wrap gap-2">
          {accounts.map((account) => (
            <label key={account.platform} className={choiceChipClass}>
              <input
                type="radio"
                name="social-platform"
                value={account.platform}
                checked={platform === account.platform}
                onChange={() => update("platform", account.platform)}
                disabled={busy}
                className="sr-only"
              />
              <span aria-hidden="true" className={cn("size-2 rounded-full", platformChip(account.platform).dotClassName)} />
              {platformLabel(account.platform)} · {account.displayName}
            </label>
          ))}
        </div>
        {fieldError("platform")}
      </fieldset>

      <div className="space-y-1">
        <Label htmlFor="social-caption" className="block">Caption</Label>
        <Textarea
          id="social-caption"
          rows={4}
          maxLength={SOCIAL_CAPTION_MAX_LENGTH}
          value={current.caption}
          onChange={(event) => update("caption", event.target.value)}
          disabled={busy}
          aria-invalid={!!errors.caption}
          aria-describedby={errors.caption ? "social-error-caption" : undefined}
        />
        <p className="text-right font-mono text-xs text-muted">{current.caption.length}/{SOCIAL_CAPTION_MAX_LENGTH}</p>
        {fieldError("caption")}
      </div>

      {platform === "tiktok" ? (
        <fieldset className={optionsFieldsetClass}>
          <legend className={legendClass}>TikTok options</legend>
          <p role="note" className="rounded-panel border border-warn/30 bg-warn/10 p-3 text-sm text-warn">{TIKTOK_UNAUDITED_NOTICE}</p>
          <Label htmlFor="social-privacy" className="block">Privacy</Label>
          <Select id="social-privacy" value={current.privacyLevel} onChange={(event) => update("privacyLevel", event.target.value)} disabled={busy}>
            {TIKTOK_PRIVACY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label} ({option.value})</option>)}
          </Select>
          {checkbox("disableComment", "Disable comments")}
          {checkbox("disableDuet", "Disable duet")}
          {checkbox("disableStitch", "Disable stitch")}
        </fieldset>
      ) : (
        <fieldset className={optionsFieldsetClass}>
          <legend className={legendClass}>Instagram options</legend>
          <p className="text-sm text-subtle">Published as a Reel. Requires an Instagram professional account.</p>
          {checkbox("shareToFeed", "Share to feed")}
        </fieldset>
      )}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-dim">When</legend>
        <div className="flex flex-wrap gap-2">
          <label className={choiceChipClass}>
            <input type="radio" name="social-mode" value="now" checked={current.mode === "now"} onChange={() => update("mode", "now")} disabled={busy} className="sr-only" />
            Publish now
          </label>
          <label className={choiceChipClass}>
            <input type="radio" name="social-mode" value="at" checked={current.mode === "at"} onChange={() => update("mode", "at")} disabled={busy} className="sr-only" />
            Schedule
          </label>
        </div>
        {current.mode === "at" && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Input type="date" aria-label="Publish date" value={current.date} onChange={(event) => update("date", event.target.value)} disabled={busy} className="font-mono" />
            <Input type="time" aria-label="Publish time" value={current.time} onChange={(event) => update("time", event.target.value)} disabled={busy} className="font-mono" />
            <Input type="text" aria-label="IANA timezone" value={current.timezone} onChange={(event) => update("timezone", event.target.value)} disabled={busy} className="font-mono" />
          </div>
        )}
        {current.mode === "at" && <p className="text-xs text-muted">The app must be running at that time. Posts more than 5 minutes late are marked missed and never published late.</p>}
        {fieldError("schedule")}
      </fieldset>

      <Button type="submit" disabled={busy}>Preview</Button>
      <p role="status" aria-live="polite" className="text-sm text-dim">{message}</p>
    </form>
  );
}
