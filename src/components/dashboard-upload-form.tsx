"use client";

import { useEffect, useRef, useState } from "react";

export type UploadFields = { stagingFile: string; title: string; description: string; expectedChannelId: string };
type UploadReply = { status?: string; error?: string; outcome?: string; operationId?: string; videoId?: string; channelId?: string };
export const emptyUploadFields: UploadFields = { stagingFile: "", title: "", description: "", expectedChannelId: "" };

export function validateUpload(fields: UploadFields): Partial<Record<keyof UploadFields, string>> {
  const errors: Partial<Record<keyof UploadFields, string>> = {};
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(fields.stagingFile) || !/\.(mp4|mov|webm|mkv)$/i.test(fields.stagingFile)) errors.stagingFile = "Choose and stage a supported video (mp4, mov, webm or mkv).";
  if (!fields.title.trim() || fields.title.trim().length > 100) errors.title = "Enter a title of 1–100 characters.";
  if (fields.description.length > 5000) errors.description = "Description must be at most 5000 characters.";
  if (!fields.expectedChannelId.trim()) errors.expectedChannelId = "An active channel is required.";
  return errors;
}

export function uploadPayload(fields: UploadFields, dryRun: boolean) {
  return { stagingFile: fields.stagingFile, title: fields.title.trim(), description: fields.description, expectedChannelId: fields.expectedChannelId, dryRun, confirmed: !dryRun };
}

export function uploadMessage(reply: UploadReply, dryRun: boolean): string {
  if (reply.outcome === "unknown") return `Upload outcome is uncertain${reply.operationId ? ` (operation ID: ${reply.operationId})` : ""}. Check your YouTube channel before attempting another upload. Do not retry automatically.`;
  if (reply.error) return reply.error === "WRITE_CHANNEL_MISMATCH" ? "Channel changed. Preview again with the active channel before uploading." : reply.error === "unauthorized" ? "Session expired. Sign in again before uploading." : reply.error === "validation_failed" ? "Request rejected. Check the selected video and fields, then preview again." : `Upload could not be completed (${reply.error}). Check your channel before retrying if the request may have reached YouTube.`;
  if (dryRun && reply.status === "validated") return `Preview validated for channel ${reply.channelId ?? "selected"}. No video was uploaded. Confirm below to upload privately.`;
  if (!dryRun && reply.status === "uploaded") return `Private upload complete. Video ID: ${reply.videoId ?? "unavailable"}. Operation ID: ${reply.operationId ?? "unavailable"}.`;
  return "Unexpected response. Check your YouTube channel before attempting another upload; do not retry automatically.";
}

export type ScheduleFields = { videoId: string; expectedChannelId: string; date: string; time: string; timezone: string };
export function scheduleInputType(key: keyof ScheduleFields): "text" | "date" | "time" {
  if (key === "date") return "date";
  if (key === "time") return "time";
  return "text";
}

export const scheduleTimezoneOptions = [
  { value: "UTC", label: "UTC" },
  { value: "America/Los_Angeles", label: "Pacific Time (US)" },
  { value: "America/Denver", label: "Mountain Time (US)" },
  { value: "America/Chicago", label: "Central Time (US)" },
  { value: "America/New_York", label: "Eastern Time (US)" },
  { value: "America/Mexico_City", label: "Mexico City" },
  { value: "America/Sao_Paulo", label: "São Paulo" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Madrid", label: "Madrid" },
  { value: "Europe/Paris", label: "Paris" },
  { value: "Europe/Berlin", label: "Berlin" },
  { value: "Africa/Johannesburg", label: "Johannesburg" },
  { value: "Asia/Dubai", label: "Dubai" },
  { value: "Asia/Kolkata", label: "Kolkata" },
  { value: "Asia/Shanghai", label: "Shanghai" },
  { value: "Asia/Tokyo", label: "Tokyo" },
  { value: "Australia/Sydney", label: "Sydney" },
] as const;
type ScheduleReply = { status?: string; error?: string; outcome?: string; operationId?: string; publishAtUtc?: string; confirmationToken?: string; channelId?: string; videoId?: string };
type ScheduleVideoOption = { videoId: string; title: string; publishedAt: string };
type SchedulePreview = { fields: ScheduleFields; publishAtUtc: string; confirmationToken: string; operationId: string };

export function validateSchedule(fields: ScheduleFields): Partial<Record<keyof ScheduleFields, string>> {
  const errors: Partial<Record<keyof ScheduleFields, string>> = {};
  if (!fields.videoId.trim()) errors.videoId = "Enter an existing private video ID.";
  if (!fields.expectedChannelId.trim()) errors.expectedChannelId = "An active channel is required.";
  const parsed = Date.parse(`${fields.date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.date) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== fields.date) errors.date = "Enter a valid date.";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(fields.time)) errors.time = "Enter a valid time.";
  try { new Intl.DateTimeFormat("en-US", { timeZone: fields.timezone }); } catch { errors.timezone = "Enter a valid IANA timezone, such as America/New_York."; }
  return errors;
}

export function schedulePayload(fields: ScheduleFields, dryRun: boolean, confirmationToken?: string) {
  return { videoId: fields.videoId.trim(), expectedChannelId: fields.expectedChannelId, timezone: fields.timezone, publishAt: `${fields.date}T${fields.time}:00`, dryRun, confirmed: !dryRun, ...(!dryRun ? { confirmationToken } : {}) };
}

export function scheduleMessage(reply: ScheduleReply, dryRun: boolean): string {
  const operation = reply.operationId ? ` Operation ID: ${reply.operationId}.` : "";
  if (reply.outcome === "unknown") return `Scheduling outcome is uncertain.${operation} Check the video in YouTube before trying again. Do not retry automatically.`;
  if (reply.error) {
    if (reply.error === "unauthorized" || reply.error.startsWith("AUTH_")) return `Session or YouTube authorization expired. Sign in again before scheduling.${operation}`;
    if (reply.error === "validation_failed" || reply.error.startsWith("WRITE_CHANNEL_")) return `Scheduling request rejected. Check the private video, channel and local time, then preview again.${operation}`;
    return `Scheduling provider could not complete the request.${operation} Check YouTube before attempting another request.`;
  }
  if (dryRun && reply.status === "validated") return `Schedule validated. No change was made.${operation} Review the UTC time and confirm below.`;
  if (!dryRun && reply.status === "scheduled") return `Video scheduled for ${reply.publishAtUtc ?? "the confirmed UTC time"}.${operation}`;
  return `Unexpected scheduling response.${operation} Check YouTube before attempting another request; do not retry automatically.`;
}

export function stagingFailureMessage(status: number): string {
  if (status === 401) return "Session expired. Sign in again before staging.";
  if (status === 400) return "Video could not be staged. Check its extension and size, then try again.";
  return "Video staging is unavailable. Try again later.";
}

export function DashboardUploadForm() {
  const [fields, setFields] = useState<UploadFields>(emptyUploadFields);
  const [channel, setChannel] = useState<{ id: string; title: string } | null>(null);
  const [channelStatus, setChannelStatus] = useState("Loading active channel…");
  const [errors, setErrors] = useState<Partial<Record<keyof UploadFields, string>>>({});
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [finished, setFinished] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [stagedFile, setStagedFile] = useState<File | null>(null);
  const inFlight = useRef(false);
  const fieldRefs = useRef<Partial<Record<keyof UploadFields, HTMLInputElement | HTMLTextAreaElement | null>>>({});

  useEffect(() => {
    let live = true;
    void fetch("/api/youtube/channel-info").then(async (res) => {
      if (!res.ok) throw new Error("channel unavailable");
      return res.json() as Promise<{ channel: { id: string; title: string } | null }>;
    }).then((data) => {
      if (!live) return;
      if (!data.channel?.id) { setChannelStatus("No active channel found. Switch channel to continue."); return; }
      setChannel(data.channel);
      setFields((current) => ({ ...current, expectedChannelId: data.channel!.id }));
      setSchedule((current) => ({ ...current, expectedChannelId: data.channel!.id }));
      setChannelStatus("");
    }).catch(() => { if (live) setChannelStatus("Unable to load active channel. Refresh or switch channel to continue."); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!channel) return;
    let live = true;
    setScheduleVideosLoading(true);
    setScheduleVideosError("");
    setSchedule((current) => ({ ...current, expectedChannelId: channel.id, videoId: "" }));
    void fetch("/api/youtube/videos?privateOnly=1").then(async (response) => {
      const data = await response.json() as ScheduleVideoOption[] | { error?: string };
      if (!response.ok || !Array.isArray(data)) throw new Error((data as { error?: string }).error ?? "Unable to load private videos.");
      if (live) setScheduleVideos(data);
    }).catch((error: unknown) => {
      if (live) setScheduleVideosError(error instanceof Error ? error.message : "Unable to load private videos.");
    }).finally(() => { if (live) setScheduleVideosLoading(false); });
    return () => { live = false; };
  }, [channel]);

  function update(key: keyof UploadFields, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
    setPreview(null);
    setMessage("");
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  function selectFile(file: File | null) {
    if (inFlight.current) return;
    setSelectedFile(file);
    setStagedFile(null);
    setFields((current) => ({ ...current, stagingFile: "" }));
    setPreview(null);
    setMessage(file ? `Selected ${file.name}. Stage and preview to continue.` : "Choose a video to continue.");
    setErrors((current) => ({ ...current, stagingFile: undefined }));
  }

  async function submit(dryRun: boolean) {
    if (inFlight.current || finished || (!dryRun && !preview)) return;
    const nextErrors = validateUpload(fields);
    if (dryRun && selectedFile && !stagedFile) delete nextErrors.stagingFile;
    if (!selectedFile) nextErrors.stagingFile = "Choose a video file first.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setMessage("Correct the highlighted fields before continuing.");
      const firstInvalid = (["stagingFile", "title", "description", "expectedChannelId"] as const).find((key) => nextErrors[key]);
      if (firstInvalid) fieldRefs.current[firstInvalid]?.focus();
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setMessage(dryRun ? "Validating preview…" : "Uploading privately…");
    try {
      let submitted = fields;
      if (dryRun && selectedFile && stagedFile !== selectedFile) {
        setMessage(`Staging ${selectedFile.name}…`);
        const form = new FormData();
        form.set("file", selectedFile);
        const stageResponse = await fetch("/api/youtube/upload/stage", { method: "POST", body: form });
        if (!stageResponse.ok) {
          setMessage(stagingFailureMessage(stageResponse.status));
          return;
        }
        const staged = await stageResponse.json() as { stagingFile?: string };
        if (!staged.stagingFile || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}\.(mp4|mov|webm|mkv)$/i.test(staged.stagingFile)) {
          setMessage("Invalid staging response. Select the video again.");
          return;
        }
        submitted = { ...fields, stagingFile: staged.stagingFile };
        setFields(submitted);
        setStagedFile(selectedFile);
        setMessage("Video staged. Validating preview…");
      }
      const response = await fetch("/api/youtube/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(uploadPayload(submitted, dryRun)) });
      const reply = await response.json() as UploadReply;
      setMessage(uploadMessage(reply, dryRun));
      if (response.ok && dryRun && reply.status === "validated" && reply.channelId === submitted.expectedChannelId) setPreview(JSON.stringify(submitted));
      else setPreview(null);
      if (response.ok && !dryRun && reply.status === "uploaded") setFinished(true);
    } catch {
      setPreview(null);
      setMessage("Request outcome is uncertain. Check your YouTube channel before trying again; do not retry automatically. If you received an operation ID, keep it for support.");
    } finally { inFlight.current = false; setBusy(false); }
  }

  const [schedule, setSchedule] = useState<ScheduleFields>({ videoId: "", expectedChannelId: "", date: "", time: "", timezone: "" });
  const [scheduleErrors, setScheduleErrors] = useState<Partial<Record<keyof ScheduleFields, string>>>({});
  const [schedulePreview, setSchedulePreview] = useState<SchedulePreview | null>(null);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduleMessageText, setScheduleMessageText] = useState("");
  const [scheduleVideos, setScheduleVideos] = useState<ScheduleVideoOption[]>([]);
  const [scheduleVideosLoading, setScheduleVideosLoading] = useState(false);
  const [scheduleVideosError, setScheduleVideosError] = useState("");
  const scheduleInFlight = useRef(false);
  const scheduleRefs = useRef<Partial<Record<keyof ScheduleFields, HTMLInputElement | HTMLSelectElement | null>>>({});

  function changeSchedule(key: keyof ScheduleFields, value: string) {
    setSchedule((current) => ({ ...current, [key]: value }));
    setSchedulePreview(null);
    setScheduleMessageText("");
    setScheduleErrors((current) => ({ ...current, [key]: undefined }));
  }

  async function submitSchedule(dryRun: boolean) {
    if (scheduleInFlight.current || !channel) return;
    const submitted = { ...schedule, expectedChannelId: channel.id };
    const currentPreview = schedulePreview;
    if (!dryRun && (!currentPreview || JSON.stringify(currentPreview.fields) !== JSON.stringify(submitted))) return;
    const nextErrors = validateSchedule(submitted);
    setScheduleErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setScheduleMessageText("Correct the highlighted scheduling fields before continuing.");
      const first = (["videoId", "date", "time", "timezone"] as const).find((key) => nextErrors[key]);
      if (first) scheduleRefs.current[first]?.focus();
      return;
    }
    scheduleInFlight.current = true;
    setScheduleBusy(true);
    setScheduleMessageText(dryRun ? "Validating schedule…" : "Scheduling video…");
    if (dryRun) setSchedulePreview(null);
    try {
      const response = await fetch("/api/youtube/schedule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(schedulePayload(submitted, dryRun, currentPreview?.confirmationToken)) });
      const reply = await response.json() as ScheduleReply;
      setScheduleMessageText(scheduleMessage(reply, dryRun));
      if (response.ok && dryRun && reply.status === "validated" && reply.channelId === channel.id && reply.videoId === submitted.videoId.trim() && reply.confirmationToken && reply.publishAtUtc && reply.operationId) {
        setSchedulePreview({ fields: submitted, publishAtUtc: reply.publishAtUtc, confirmationToken: reply.confirmationToken, operationId: reply.operationId });
      } else setSchedulePreview(null);
    } catch {
      setSchedulePreview(null);
      setScheduleMessageText(`Scheduling request outcome is uncertain.${!dryRun && currentPreview ? ` Preview operation ID: ${currentPreview.operationId}.` : ""} Check YouTube before trying again; do not retry automatically.`);
    } finally { scheduleInFlight.current = false; setScheduleBusy(false); }
  }

  const inputClass = "w-full min-w-0 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
  return (
    <section className="space-y-5">
      <div><h1 className="text-2xl font-bold">Upload a private Short</h1><p className="mt-2 text-sm text-zinc-400">Only private uploads are supported. This does not schedule or publish videos publicly. Choose a video from your device. It is staged securely before preview; no video is uploaded to YouTube until you confirm.</p></div>
      <p className="text-sm">Active channel: <strong role="status" aria-live="polite">{channel ? `${channel.title} (${channel.id})` : channelStatus}</strong></p>
      <form onSubmit={(event) => { event.preventDefault(); void submit(true); }} className="space-y-4" noValidate>
        {(["stagingFile", "title", "description", "expectedChannelId"] as const).map((key) => (
          <div key={key} className="space-y-1">
            <label htmlFor={`upload-${key}`} className="block text-sm font-medium">{{ stagingFile: "Video file", title: "Title", description: "Description", expectedChannelId: "Expected channel ID" }[key]}</label>
            {key === "stagingFile" ? <input id={`upload-${key}`} type="file" accept=".mp4,.mov,.webm,.mkv" ref={(node) => { fieldRefs.current[key] = node; }} onChange={(event) => selectFile(event.target.files?.[0] ?? null)} disabled={busy || finished} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `error-${key}` : undefined} className={inputClass} /> : key === "description" ? <textarea id={`upload-${key}`} ref={(node) => { fieldRefs.current[key] = node; }} value={fields[key]} onChange={(event) => update(key, event.target.value)} maxLength={5001} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `error-${key}` : undefined} className={inputClass} rows={4} /> : <input id={`upload-${key}`} ref={(node) => { fieldRefs.current[key] = node; }} value={fields[key]} onChange={(event) => update(key, event.target.value)} readOnly={key === "expectedChannelId"} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `error-${key}` : undefined} className={inputClass} />}
            {key === "stagingFile" && selectedFile && <p className="text-sm text-zinc-300">Selected: {selectedFile.name}{stagedFile === selectedFile ? " — staged" : " — awaiting staging"}</p>}
            {errors[key] && <p id={`error-${key}`} className="text-sm text-red-300">{errors[key]}</p>}
          </div>
        ))}
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={busy || !channel || finished} className="rounded-lg border border-zinc-600 px-4 py-2 font-medium hover:bg-zinc-800 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Preview (dry run)</button>
          <button type="button" disabled={busy || !preview || preview !== JSON.stringify(fields) || finished} onClick={() => void submit(false)} className="rounded-lg bg-white px-4 py-2 font-medium text-zinc-950 hover:bg-zinc-200 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Confirm private upload</button>
        </div>
      </form>
      <p role="status" aria-live="polite" className="text-sm text-zinc-300">{message}</p>
      <section aria-labelledby="schedule-heading" className="space-y-4 border-t border-zinc-700 pt-6">
        <div><h2 id="schedule-heading" className="text-xl font-bold">Schedule an existing private video</h2><p className="text-sm text-zinc-400">Enter the video ID of an existing private video on the active channel. Preview does not change the video.</p></div>
        <form noValidate className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submitSchedule(true); }}>
          {(["videoId", "date", "time", "timezone"] as const).map((key) => (
            <div key={key} className="space-y-1">
              <label htmlFor={`schedule-${key}`} className="block text-sm font-medium">{{ videoId: "Existing private video ID", date: "Publish date", time: "Publish time (local)", timezone: "IANA timezone" }[key]}</label>
              {key === "videoId" ? <select id="schedule-videoId" name="schedule-videoId" autoComplete="off" ref={(node) => { scheduleRefs.current[key] = node; }} value={schedule.videoId} onChange={(event) => changeSchedule(key, event.target.value)} disabled={scheduleBusy || scheduleVideosLoading || !scheduleVideos.length} aria-busy={scheduleVideosLoading} aria-invalid={!!scheduleErrors[key]} aria-describedby={scheduleErrors[key] ? "schedule-error-videoId" : undefined} className={inputClass}>
                <option value="" disabled>{scheduleVideosLoading ? "Loading private videos…" : scheduleVideos.length ? "Select a private video" : "No private videos found"}</option>
                {scheduleVideos.map((video) => <option key={video.videoId} value={video.videoId}>{video.title || "Untitled video"} — {video.videoId}</option>)}
              </select> : key === "timezone" ? <select id={`schedule-${key}`} name="schedule-timezone" autoComplete="off" ref={(node) => { scheduleRefs.current[key] = node; }} value={schedule[key]} onChange={(event) => changeSchedule(key, event.target.value)} disabled={scheduleBusy} aria-invalid={!!scheduleErrors[key]} aria-describedby={scheduleErrors[key] ? `schedule-error-${key}` : undefined} className={inputClass}>
                <option value="" disabled>Select a timezone</option>
                {scheduleTimezoneOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select> : <input id={`schedule-${key}`} name={`schedule-${key}`} autoComplete="off" type={scheduleInputType(key)} ref={(node) => { scheduleRefs.current[key] = node; }} value={schedule[key]} onChange={(event) => changeSchedule(key, event.target.value)} disabled={scheduleBusy} aria-invalid={!!scheduleErrors[key]} aria-describedby={scheduleErrors[key] ? `schedule-error-${key}` : undefined} className={inputClass} />}
              {key === "videoId" && scheduleVideosError && <p role="alert" className="text-sm text-red-300">{scheduleVideosError}</p>}
              {scheduleErrors[key] && <p id={`schedule-error-${key}`} className="text-sm text-red-300">{scheduleErrors[key]}</p>}
            </div>
          ))}
          <button type="submit" disabled={scheduleBusy || !channel} className="rounded-lg border border-zinc-600 px-4 py-2 font-medium disabled:opacity-50">Preview schedule (dry run)</button>
          {schedulePreview && <div className="space-y-2 rounded-lg border border-zinc-600 p-4" aria-label="Schedule preview">
            <p>Target channel: {channel?.title} ({schedulePreview.fields.expectedChannelId})</p>
            <p>Existing video ID: {schedulePreview.fields.videoId}</p>
            <p>Local publish time: {schedulePreview.fields.date}T{schedulePreview.fields.time}:00 ({schedulePreview.fields.timezone})</p>
            <p>UTC publish time: <time dateTime={schedulePreview.publishAtUtc}>{schedulePreview.publishAtUtc}</time></p>
            <p>Preview operation ID: {schedulePreview.operationId}</p>
            <button type="button" disabled={scheduleBusy || !channel || channel.id !== schedulePreview.fields.expectedChannelId || JSON.stringify(schedulePreview.fields) !== JSON.stringify(schedule)} onClick={() => void submitSchedule(false)} className="rounded-lg bg-white px-4 py-2 font-medium text-zinc-950 disabled:opacity-50">Confirm schedule</button>
          </div>}
        </form>
        <p role="status" aria-live="polite" className="text-sm text-zinc-300">{scheduleMessageText}</p>
      </section>
    </section>
  );
}
