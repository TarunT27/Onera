"use client";

import { useCallback, useEffect, useRef } from "react";
import { identityT, type Translate } from "@/lib/i18n/translate";
import { msg } from "@/lib/i18n/msg";

export interface Recording {
  blob: Blob;
  filename: string;
}

/** Why recording ended on its own; a tap to stop is "manual". */
export type StopReason = "manual" | "silence" | "no-speech" | "max-length";

const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
const END_OF_SPEECH_MS = 1400;
const NO_SPEECH_MS = 8000;
const MAX_MS = 30_000;

interface Session {
  stream: MediaStream;
  recorder: MediaRecorder;
  context: AudioContext;
  chunks: Blob[];
  frame: number;
  heardSpeech: boolean;
  done: Promise<Recording>;
}

function extensionFor(type: string): string {
  if (type.includes("mp4")) return "m4a";
  if (type.includes("ogg")) return "ogg";
  return "webm";
}

/** Plain-language message for getUserMedia and MediaRecorder failures. */
export function microphoneError(err: unknown, t: Translate = identityT): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return t("Microphone access is blocked. Allow it for this site in your browser, then try again.");
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return t("No microphone was found.");
  if (name === "NotReadableError") return t("The microphone is in use by another app.");
  return err instanceof Error ? t(err.message) : t("The microphone could not be started.");
}

/**
 * Records one spoken command. A level meter drives the `--level` CSS variable on
 * `levelTarget` and ends the recording after a pause in speech, so a command
 * needs one tap. The noise floor adapts, which matters in a loud room.
 */
export function useVoiceRecorder({
  levelTarget,
  onAutoStop,
}: {
  levelTarget: React.RefObject<HTMLElement | null>;
  onAutoStop: (reason: Exclude<StopReason, "manual">) => void;
}) {
  const session = useRef<Session | null>(null);
  const onAutoStopRef = useRef(onAutoStop);
  useEffect(() => {
    onAutoStopRef.current = onAutoStop;
  }, [onAutoStop]);

  const teardown = useCallback((s: Session) => {
    cancelAnimationFrame(s.frame);
    for (const track of s.stream.getTracks()) track.stop();
    void s.context.close().catch(() => {});
    levelTarget.current?.style.setProperty("--level", "0");
  }, [levelTarget]);

  const stop = useCallback((): Promise<Recording> | null => {
    const s = session.current;
    if (!s) return null;
    session.current = null;
    if (s.recorder.state !== "inactive") s.recorder.stop();
    teardown(s);
    return s.done;
  }, [teardown]);

  const start = useCallback(async () => {
    if (session.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      throw new Error(msg("Voice needs a browser with microphone recording, on https or localhost."));
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const mimeType = MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const context = new AudioContext();
    // Safari can create the context suspended after the getUserMedia await.
    void context.resume().catch(() => {});
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    const s: Session = {
      stream, recorder, context, chunks, frame: 0, heardSpeech: false,
      done: new Promise<Recording>((resolve) => {
        recorder.onstop = () => {
          const type = recorder.mimeType || mimeType || "audio/webm";
          resolve({ blob: new Blob(chunks, { type }), filename: `speech.${extensionFor(type)}` });
        };
      }),
    };
    session.current = s;
    recorder.start(250);

    const samples = new Float32Array(analyser.fftSize);
    const startedAt = performance.now();
    let floor = 0.01;
    let lastVoice = startedAt;
    const tick = () => {
      if (session.current !== s) return;
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += v * v;
      const rms = Math.sqrt(sum / samples.length);
      // Fall quickly to quiet, rise slowly toward steady noise.
      floor = rms < floor ? floor * 0.6 + rms * 0.4 : floor * 0.995 + rms * 0.005;
      const threshold = Math.max(0.012, floor * 2.2);
      const now = performance.now();
      if (rms > threshold) {
        s.heardSpeech = true;
        lastVoice = now;
      }
      levelTarget.current?.style.setProperty("--level", Math.min(1, rms * 7).toFixed(3));

      const reason: Exclude<StopReason, "manual"> | null =
        now - startedAt > MAX_MS ? "max-length"
        : s.heardSpeech && now - lastVoice > END_OF_SPEECH_MS ? "silence"
        : !s.heardSpeech && now - startedAt > NO_SPEECH_MS ? "no-speech"
        : null;
      if (reason) onAutoStopRef.current(reason);
      else s.frame = requestAnimationFrame(tick);
    };
    s.frame = requestAnimationFrame(tick);
  }, [levelTarget]);

  /** Stops and discards the recording. */
  const cancel = useCallback(() => {
    void stop();
  }, [stop]);

  useEffect(() => () => cancel(), [cancel]);

  return { start, stop, cancel };
}
