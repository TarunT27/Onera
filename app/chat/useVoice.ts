"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Minimal shape of the browser SpeechRecognition API (not in lib.dom). */
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Strip characters that read badly aloud. */
function speakable(text: string): string {
  return text.replace(/[*_`#>|]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Browser voice I/O for the assistant. Listening uses the Web Speech API
 * (Chrome/Edge/Safari); the answer itself still comes from the server model.
 */
export function useVoice() {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);

  useEffect(() => {
    setSupported(recognitionCtor() !== null);
    return () => {
      rec.current?.abort();
      window.speechSynthesis?.cancel();
    };
  }, []);

  const stopListening = useCallback(() => rec.current?.stop(), []);

  /** onText gets the live transcript; onFinal fires once with the finished sentence. */
  const startListening = useCallback((onText: (t: string) => void, onFinal: (t: string) => void) => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    window.speechSynthesis?.cancel();
    setVoiceError(null);
    const r = new Ctor();
    r.lang = navigator.language || "en-US";
    r.interimResults = true;
    r.continuous = false;
    let transcript = "";
    let final = false;
    r.onresult = (e) => {
      transcript = Array.from(e.results).map((res) => res[0].transcript).join("");
      final = Array.from(e.results).every((res) => res.isFinal);
      onText(transcript);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setVoiceError("Microphone access was blocked. Allow it in the browser to use voice.");
      } else if (e.error !== "no-speech" && e.error !== "aborted") {
        setVoiceError(`Voice input failed (${e.error}).`);
      }
    };
    r.onend = () => {
      setListening(false);
      rec.current = null;
      if (final && transcript.trim()) onFinal(transcript.trim());
    };
    rec.current = r;
    setListening(true);
    r.start();
  }, []);

  const cancelSpeech = useCallback(() => {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback((text: string) => {
    const synth = window.speechSynthesis;
    const clean = speakable(text);
    if (!synth || !clean) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    synth.speak(u);
  }, []);

  return { supported, listening, speaking, voiceError, startListening, stopListening, speak, cancelSpeech };
}
