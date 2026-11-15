"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { parseSignupMessage, type SignupMessage } from "@garden/integrations/signup-message";
import { completeSignupAction, type SignupResult } from "./actions";

type Fb = {
  init: (options: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }) => void;
  login: (callback: (response: { authResponse?: { code?: string } | null }) => void, options: Record<string, unknown>) => void;
};
declare global {
  interface Window {
    FB?: Fb;
    fbAsyncInit?: () => void;
  }
}

type Phase = "idle" | "working" | "done" | "error";

export function EmbeddedSignup({
  token,
  appId,
  configId,
  graphVersion,
  featureType,
  mock,
  initial,
}: {
  token: string;
  appId: string | null;
  configId: string | null;
  graphVersion: string;
  /** Only needed for older Embedded Signup configurations; empty for the current one. */
  featureType: string | null;
  /** No Meta app on this server: offer a clearly labelled test-mode simulation instead of Meta's popup. */
  mock: boolean;
  initial: { displayPhone: string; verifiedName: string; mode: "coexistence" | "cloud_api" } | null;
}) {
  const [phase, setPhase] = useState<Phase>(initial ? "done" : "idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<SignupResult["connection"] | null>(initial);
  const codeRef = useRef<string | null>(null);
  const finishRef = useRef<Extract<SignupMessage, { kind: "finish" }> | null>(null);
  const sdkReady = useRef(false);

  const submit = useCallback(
    async (payload: { code: string; wabaId: string | null; phoneNumberId: string | null; businessId: string | null; coexistence: boolean }) => {
      setPhase("working");
      const res = await completeSignupAction({ token, ...payload });
      if (res.ok && res.connection) {
        setResult(res.connection);
        setPhase("done");
      } else {
        setError(res.error ?? "Couldn't connect WhatsApp.");
        setPhase("error");
      }
    },
    [token],
  );

  // Meta sends the account ids in a message and the exchangeable code in the login callback. Either can arrive first, so wait for
  // both. The code lives only about 30 seconds, so it is sent to the server the moment we have everything.
  const tryFinish = useCallback(() => {
    const code = codeRef.current;
    const fin = finishRef.current;
    if (!code || !fin) return;
    codeRef.current = null;
    finishRef.current = null;
    void submit({ code, wabaId: fin.wabaId, phoneNumberId: fin.phoneNumberId, businessId: fin.businessId, coexistence: fin.coexistence });
  }, [submit]);

  useEffect(() => {
    if (mock || !appId) return;
    const onMessage = (event: MessageEvent) => {
      const msg = parseSignupMessage(event.origin, event.data);
      if (!msg) return;
      if (msg.kind === "finish") {
        finishRef.current = msg;
        tryFinish();
      } else if (msg.kind === "cancel") {
        setPhase("idle");
        setError("The connection was cancelled before it finished. You can try again.");
      } else if (msg.kind === "error") {
        setPhase("error");
        setError(msg.message);
      }
    };
    window.addEventListener("message", onMessage);
    window.fbAsyncInit = () => {
      window.FB?.init({ appId, autoLogAppEvents: true, xfbml: true, version: graphVersion });
      sdkReady.current = true;
    };
    if (!document.getElementById("facebook-jssdk")) {
      const script = document.createElement("script");
      script.id = "facebook-jssdk";
      script.async = true;
      script.defer = true;
      script.crossOrigin = "anonymous";
      script.src = "https://connect.facebook.net/en_US/sdk.js";
      document.body.appendChild(script);
    } else if (window.FB) {
      window.fbAsyncInit();
    }
    return () => window.removeEventListener("message", onMessage);
  }, [appId, graphVersion, mock, tryFinish]);

  function launch() {
    setError("");
    if (!window.FB || !sdkReady.current) {
      setError("WhatsApp's sign-up hasn't finished loading. Wait a moment and try again, or check that no browser extension is blocking it.");
      return;
    }
    codeRef.current = null;
    finishRef.current = null;
    setPhase("working");
    window.FB.login(
      (response) => {
        const code = response.authResponse?.code;
        if (!code) {
          setPhase("idle");
          return; // closed or cancelled: the message listener reports a cancel with its step
        }
        codeRef.current = code;
        tryFinish();
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, sessionInfoVersion: "3", ...(featureType ? { featureType } : {}) },
      },
    );
  }

  const simulate = (coexistence: boolean) => {
    const id = Math.random().toString(36).slice(2, 10);
    void submit({
      code: "mock-code",
      wabaId: `mock_waba_${id}`,
      phoneNumberId: coexistence ? `mock_coex_${id}` : `mock_pn_${id}`,
      businessId: null,
      coexistence,
    });
  };

  if (phase === "done" && result) {
    return (
      <div className="rounded-2xl border border-lime-400 bg-lime-100 p-5" role="status">
        <p className="flex items-center gap-2 text-base font-semibold text-brand-900">
          <CheckCircle2 className="size-5" /> WhatsApp is connected
        </p>
        <p className="mt-2 text-sm text-brand-900">
          {result.displayPhone || "Your number"}
          {result.verifiedName ? ` · ${result.verifiedName}` : ""}
        </p>
        <p className="mt-2 text-sm text-brand-900/80">
          {result.mode === "coexistence"
            ? "You can keep using the WhatsApp Business app on this number as before. Replies you send from your phone appear in your inbox, and the assistant stays quiet in any chat you reply to yourself."
            : "Your assistant can now chat with customers on this number."}
        </p>
        <button className="btn btn-secondary mt-4 h-10 px-4" onClick={() => setPhase("idle")}>
          Connect a different number
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {mock ? (
        <div className="rounded-2xl border border-warning-600/30 bg-warning-100 p-4">
          <p className="text-sm font-semibold text-warning-600">Test mode: no Meta app is connected to this server</p>
          <p className="mt-1 text-sm text-warning-600">These buttons pretend a customer connected a number, so the rest of the system can be tried out. No real WhatsApp account is involved.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn btn-secondary h-10 px-4" onClick={() => simulate(false)} disabled={phase === "working"}>
              Simulate a new number
            </button>
            <button className="btn btn-secondary h-10 px-4" onClick={() => simulate(true)} disabled={phase === "working"}>
              Simulate an existing WhatsApp Business app number
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-primary h-12 px-6 text-base" onClick={launch} disabled={phase === "working" || !appId || !configId}>
          {phase === "working" ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Connecting…
            </>
          ) : (
            "Connect WhatsApp"
          )}
        </button>
      )}
      {phase === "working" && mock ? <p className="text-sm text-ink-muted">Connecting…</p> : null}
      {error ? (
        <p role="alert" className="rounded-xl border border-danger-600/30 bg-danger-100 px-3 py-2 text-sm text-danger-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
