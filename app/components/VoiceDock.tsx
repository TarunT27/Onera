"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CircleNotch, Microphone, MicrophoneSlash, Play, SpeakerHigh, SpeakerSlash, Stop, Waveform, X } from "@phosphor-icons/react";
import type { ChatRequest, ChatResponse } from "@/lib/types";
import { clearfi, errorMessage, type VoiceStatusResponse } from "./api";
import { Badge } from "./Badge";
import { ErrorBox } from "./ErrorBox";
import { useSession } from "./SessionContext";
import { routeVoiceCommand } from "./voiceIntent";
import { useVoiceRecorder, microphoneError, type StopReason } from "./useVoiceRecorder";

type Phase = "idle" | "listening" | "transcribing" | "thinking" | "speaking";

type Turn =
  | { id: number; kind: "navigate"; transcript: string; label: string }
  | {
      id: number;
      kind: "ask";
      transcript: string;
      agent: "general" | "drafter";
      response?: ChatResponse;
      error?: unknown;
    };

const AGENT_NAMES = { general: "Onera assistant", drafter: "Trade drafter" } as const;

const SUGGESTIONS = [
  "Pay Oak Street Properties $1,850 for rent",
  "Buy $250 of NVDA in my paper account",
  "What changed in my spending this month?",
  "Open transfers",
];

/** Matches the server's ChatRequestSchema limits. */
const MAX_MESSAGES = 30;
const MAX_CONTENT = 4000;
const SPEAK_KEY = "onera.voice.speak";
/** An empty WAV, played inside the first tap so Safari lets this element play the reply later. */
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

const PILL_LABEL: Record<Phase, string> = {
  idle: "Talk to Onera",
  listening: "Listening · tap to send",
  transcribing: "Transcribing…",
  thinking: "Working…",
  speaking: "Speaking · tap to talk",
};

/** Full visible voice history as a chat request: answered turns plus the new command. */
function toRequest(turns: Turn[], command: string, agent: "general" | "drafter"): ChatRequest {
  const messages: ChatRequest["messages"] = [];
  for (const t of turns) {
    if (t.kind !== "ask" || !t.response) continue;
    messages.push({ role: "user", content: t.transcript.slice(0, MAX_CONTENT) });
    messages.push({ role: "assistant", content: (t.response.reply.trim() || "(empty reply)").slice(0, MAX_CONTENT) });
  }
  messages.push({ role: "user", content: command.slice(0, MAX_CONTENT) });
  let recent = messages.slice(-MAX_MESSAGES);
  while (recent[0].role !== "user") recent = recent.slice(1);
  return { agent, source: "voice", messages: recent };
}

/**
 * Talk to Onera from any page. ElevenLabs turns speech into text and replies into
 * speech; in between, the transcript takes the same path as typed chat. Voice can
 * navigate and can ask for proposals, but approving stays a tap on the card.
 */
export function VoiceDock() {
  const router = useRouter();
  const [status, setStatus] = useState<VoiceStatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [speakReplies, setSpeakReplies] = useState(true);
  const [tapToPlay, setTapToPlay] = useState(false);

  const turnsRef = useRef<Turn[]>([]);
  const nextId = useRef(1);
  /** Bumped by every cancel; async steps from an older token drop their results quietly. */
  const token = useRef(0);
  const phaseRef = useRef<Phase>("idle");
  const speakRef = useRef(true);
  const audio = useRef<HTMLAudioElement | null>(null);
  const audioUrl = useRef<string | null>(null);
  const orbRef = useRef<HTMLSpanElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const finishRef = useRef<(reason: StopReason) => void>(() => {});
  /** The demo user this conversation belongs to. Another tab can switch the session cookie. */
  const owner = useRef<string | null>(null);
  const sessionUserId = useSession().data?.user.id;

  const recorder = useVoiceRecorder({ levelTarget: orbRef, onAutoStop: (reason) => finishRef.current(reason) });

  const enter = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const updateTurns = useCallback((fn: (prev: Turn[]) => Turn[]) => {
    turnsRef.current = fn(turnsRef.current);
    setTurns(turnsRef.current);
  }, []);

  useEffect(() => {
    clearfi
      .voiceStatus()
      .then(setStatus)
      .catch((err) => setStatusError(errorMessage(err)));
    try {
      const stored = window.localStorage.getItem(SPEAK_KEY);
      if (stored !== null) {
        speakRef.current = stored === "1";
        setSpeakReplies(speakRef.current);
      }
    } catch {
      /* storage unavailable: replies are spoken by default */
    }
  }, []);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, phase, notice]);

  const stopAudio = useCallback(() => {
    audio.current?.pause();
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    audioUrl.current = null;
  }, []);

  /** Stops listening, playback and any pending result. Requests already sent still finish. */
  const cancel = useCallback(() => {
    token.current++;
    recorder.cancel();
    stopAudio();
    setTapToPlay(false);
    enter("idle");
  }, [recorder, stopAudio, enter]);

  useEffect(() => () => stopAudio(), [stopAudio]);

  // A user switch in another tab must not leave the previous user's replies on screen.
  useEffect(() => {
    if (!sessionUserId) return;
    if (owner.current !== null && owner.current !== sessionUserId) {
      cancel();
      updateTurns(() => []);
      setNotice(null);
    }
    owner.current = sessionUserId;
  }, [sessionUserId, cancel, updateTurns]);

  const playCurrent = useCallback(async (mine: number) => {
    const el = audio.current;
    if (!el || mine !== token.current) return;
    enter("speaking");
    setTapToPlay(false);
    el.onended = () => {
      if (mine === token.current) enter("idle");
    };
    try {
      await el.play();
    } catch (err) {
      if (mine !== token.current) return;
      if (err instanceof DOMException && err.name === "NotAllowedError") setTapToPlay(true);
      else setNotice(`Couldn't play the spoken reply: ${errorMessage(err)}`);
      enter("idle");
    }
  }, [enter]);

  const say = useCallback(async (text: string, mine: number) => {
    if (!speakRef.current || !text.trim()) {
      enter("idle");
      return;
    }
    enter("speaking");
    try {
      const blob = await clearfi.speak(text);
      if (mine !== token.current) return;
      stopAudio();
      audio.current ??= new Audio();
      audioUrl.current = URL.createObjectURL(blob);
      audio.current.src = audioUrl.current;
      await playCurrent(mine);
    } catch (err) {
      if (mine !== token.current) return;
      setNotice(`Couldn't voice the reply: ${errorMessage(err)}`);
      enter("idle");
    }
  }, [enter, playCurrent, stopAudio]);

  const runCommand = useCallback(async (command: string, mine: number) => {
    const route = routeVoiceCommand(command);
    const id = nextId.current++;

    if (route.kind === "navigate") {
      updateTurns((prev) => [...prev, { id, kind: "navigate", transcript: command, label: route.label }]);
      router.push(route.href);
      await say(`Opening ${route.label}.`, mine);
      return;
    }

    updateTurns((prev) => [...prev, { id, kind: "ask", transcript: command, agent: route.agent }]);
    enter("thinking");
    try {
      // The server answers for whoever the cookie names now, which may have changed in another
      // tab before this one refreshed. Never send a previous user's conversation along.
      const { user } = await clearfi.getSession();
      if (owner.current !== null && owner.current !== user.id) updateTurns((prev) => prev.filter((t) => t.id === id));
      owner.current = user.id;
      const history = turnsRef.current.filter((t) => t.id !== id);
      const response = await clearfi.chat(toRequest(history, command, route.agent));
      updateTurns((prev) => prev.map((t) => (t.id === id && t.kind === "ask" ? { ...t, response } : t)));
      if (mine !== token.current) return;
      // Bring the newest proposal on screen. Approval is still a tap on its card.
      const order = response.proposedOrderIds?.at(-1);
      const action = response.proposedActionIds.at(-1);
      if (order) router.push(`/trade?order=${encodeURIComponent(order)}`);
      else if (action) router.push(`/transfers?id=${encodeURIComponent(action)}`);
      // Keep the fallback label audible, not just visible.
      await say(response.mode === "fallback" ? `Fallback summary. ${response.reply}` : response.reply, mine);
    } catch (err) {
      updateTurns((prev) => prev.map((t) => (t.id === id && t.kind === "ask" ? { ...t, error: err } : t)));
      if (mine === token.current) enter("idle");
    }
  }, [enter, router, say, updateTurns]);

  const finish = useCallback(async (reason: StopReason) => {
    const pending = recorder.stop();
    if (!pending) return;
    const mine = token.current;
    enter("transcribing");
    try {
      const recording = await pending;
      if (mine !== token.current) return;
      const { text } = await clearfi.transcribe(recording.blob, recording.filename);
      if (mine !== token.current) return;
      if (!text.trim()) {
        setNotice(reason === "no-speech" ? "I didn't hear anything. Tap the mic and try again." : "I didn't catch that. Try again.");
        enter("idle");
        return;
      }
      await runCommand(text.trim(), mine);
    } catch (err) {
      if (mine !== token.current) return;
      setNotice(errorMessage(err));
      enter("idle");
    }
  }, [enter, recorder, runCommand]);

  useEffect(() => {
    finishRef.current = (reason) => void finish(reason);
  }, [finish]);

  const listen = useCallback(async () => {
    const mine = ++token.current;
    setNotice(null);
    setTapToPlay(false);
    enter("listening");
    try {
      await recorder.start();
      if (mine !== token.current) recorder.cancel();
    } catch (err) {
      if (mine !== token.current) return;
      setNotice(microphoneError(err));
      enter("idle");
    }
  }, [enter, recorder]);

  /** Plays a silent clip inside the tap, so the reply can autoplay later (Safari). */
  function unlockAudio() {
    if (audio.current) return;
    audio.current = new Audio(SILENT_WAV);
    void audio.current.play().catch(() => {});
  }

  function onOrb() {
    if (!status?.configured) {
      setOpen((o) => !o);
      return;
    }
    unlockAudio();
    setOpen(true);
    switch (phaseRef.current) {
      case "idle":
        void listen();
        break;
      case "listening":
        void finish("manual");
        break;
      case "speaking":
        // Barge in: stop talking and listen.
        stopAudio();
        void listen();
        break;
      default:
        // Transcribing or thinking: wait for the result.
        break;
    }
  }

  function runSuggestion(text: string) {
    if (phaseRef.current !== "idle") return;
    unlockAudio();
    setNotice(null);
    void runCommand(text, ++token.current);
  }

  function toggleSpeak() {
    const next = !speakRef.current;
    speakRef.current = next;
    setSpeakReplies(next);
    if (!next && phaseRef.current === "speaking") cancel();
    try {
      window.localStorage.setItem(SPEAK_KEY, next ? "1" : "0");
    } catch {
      /* not remembered; still applies now */
    }
  }

  function close() {
    cancel();
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const configured = status?.configured === true;
  const busy = phase === "transcribing" || phase === "thinking";
  const pillLabel = !status && !statusError ? "Voice" : configured ? PILL_LABEL[phase] : "Voice off";
  const OrbIcon =
    !configured ? MicrophoneSlash
    : phase === "listening" ? Stop
    : phase === "speaking" ? SpeakerHigh
    : busy ? CircleNotch
    : Microphone;

  return (
    <>
      {open && (
        <section className="voice-panel glass" role="dialog" aria-label="Voice assistant">
          <header className="voice-head">
            <span className="squircle assistant-mark">
              <Waveform size={16} weight="bold" aria-hidden />
            </span>
            <div className="voice-title">
              <h2>Talk to Onera</h2>
              <p>{configured ? `ElevenLabs ${status.sttModel} · ${status.ttsModel}` : "Voice by ElevenLabs"}</p>
            </div>
            <button
              type="button"
              className="voice-icon-btn"
              onClick={toggleSpeak}
              aria-pressed={speakReplies}
              title={speakReplies ? "Replies are read aloud" : "Replies are muted"}
              aria-label="Read replies aloud"
            >
              {speakReplies ? <SpeakerHigh size={16} aria-hidden /> : <SpeakerSlash size={16} aria-hidden />}
            </button>
            <button type="button" className="voice-icon-btn" onClick={close} aria-label="Close voice assistant">
              <X size={16} aria-hidden />
            </button>
          </header>

          <div className="voice-thread" ref={threadRef}>
            {!configured ? (
              <div className="voice-setup">
                <p>
                  <strong>Voice is off.</strong>{" "}
                  {statusError ?? "Add your ElevenLabs key to .env.local and restart the dev server:"}
                </p>
                {!statusError && <code>ELEVENLABS_API_KEY=your-key</code>}
              </div>
            ) : turns.length === 0 && phase === "idle" ? (
              <div className="assistant-empty voice-empty">
                <p>Tap the mic and say what you need. Or try one:</p>
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="suggestion" onClick={() => runSuggestion(s)}>
                    “{s}”
                  </button>
                ))}
              </div>
            ) : (
              turns.map((t) => <TurnView key={t.id} turn={t} onNavigate={() => setOpen(window.innerWidth > 760)} />)
            )}
            {notice && <p className="voice-notice">{notice}</p>}
            {tapToPlay && (
              <button type="button" className="pill small secondary voice-play" onClick={() => void playCurrent(token.current)}>
                <span className="knob">
                  <Play size={14} weight="fill" aria-hidden />
                </span>
                Play the reply
              </button>
            )}
          </div>

          <p className="voice-status" role="status" aria-live="polite">
            {phase === "listening" && "Listening… pause when you're done, or tap to send."}
            {phase === "transcribing" && "Transcribing with ElevenLabs…"}
            {phase === "thinking" && "Onera is reading your data and calling tools…"}
            {phase === "speaking" && "Speaking… tap the mic to interrupt."}
          </p>
          <p className="voice-foot">
            Voice can draft transfers and paper orders. Only you can approve them, with a tap on the card.
          </p>
        </section>
      )}

      <button
        type="button"
        className="voice-pill"
        data-phase={configured ? phase : "off"}
        onClick={onOrb}
        aria-expanded={open}
        aria-label={configured ? PILL_LABEL[phase] : "Voice assistant (not configured)"}
        disabled={busy}
      >
        <span className="voice-orb" ref={orbRef}>
          <OrbIcon size={20} weight={phase === "listening" ? "fill" : "bold"} aria-hidden />
        </span>
        <span className="voice-pill-label">{pillLabel}</span>
      </button>
    </>
  );
}

function TurnView({ turn, onNavigate }: { turn: Turn; onNavigate: () => void }) {
  return (
    <>
      <p className="bubble user voice-said">
        <Microphone size={12} weight="bold" aria-label="Spoken" />
        {turn.transcript}
      </p>
      {turn.kind === "navigate" ? (
        <div className="bubble assistant">
          <span className="bubble-agent">Navigation · no assistant call</span>
          <p>Opening {turn.label}.</p>
        </div>
      ) : turn.error !== undefined ? (
        <div className="voice-error">
          <ErrorBox error={turn.error} title="The assistant request failed" />
          <p>
            A tool call may have completed before the response was lost. Check{" "}
            <Link href="/transfers" onClick={onNavigate}>Transfers</Link> before repeating an action request.
          </p>
        </div>
      ) : !turn.response ? (
        <div className="bubble assistant typing" role="status">
          <span className="sr-only">The {AGENT_NAMES[turn.agent].toLowerCase()} is working…</span>
          <i />
          <i />
          <i />
        </div>
      ) : (
        <div className="bubble assistant">
          <span className="bubble-agent">
            {AGENT_NAMES[turn.agent]}
            {turn.response.mode === "fallback" && <Badge tone="amber">Fallback · no model</Badge>}
          </span>
          <p>{turn.response.reply || "(no reply text)"}</p>
          {turn.response.notice && <p className="bubble-notice">{turn.response.notice}</p>}
          {turn.response.trace.length > 0 && (
            <p className="bubble-tools">Used {[...new Set(turn.response.trace.map((t) => t.tool))].join(" · ")}</p>
          )}
          {turn.response.proposedActionIds.map((id) => (
            <Link key={id} href={`/transfers?id=${encodeURIComponent(id)}`} className="pill small bubble-review" onClick={onNavigate}>
              Review transfer
            </Link>
          ))}
          {(turn.response.proposedOrderIds ?? []).map((id) => (
            <Link key={id} href={`/trade?order=${encodeURIComponent(id)}`} className="pill small bubble-review" onClick={onNavigate}>
              Review order
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
