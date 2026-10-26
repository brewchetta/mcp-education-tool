"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabase } from "../../lib/supabase";

interface Details {
  clientName: string;
  redirectUri: string;
  scopes: string[];
}

function Consent() {
  const params = useSearchParams();
  const authorizationId = params.get("authorization_id");
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!authorizationId) {
      setError("This page is part of the sign-in flow and needs an authorization request. Start from your MCP client.");
      return;
    }
    (async () => {
      const supabase = getSupabase();
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        const back = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
        window.location.assign(`/login?next=${encodeURIComponent(back)}`);
        return;
      }
      const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
      if (error || !data) {
        setError(error?.message ?? "Could not load the authorization request. It may have expired.");
        return;
      }
      // No authorization_id in the response means this client was already approved: carry on.
      if (!("authorization_id" in data)) {
        window.location.assign(data.redirect_url);
        return;
      }
      setDetails({
        clientName: data.client.name,
        redirectUri: data.redirect_uri,
        scopes: data.scope ? data.scope.split(" ").filter(Boolean) : [],
      });
    })().catch((err) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [authorizationId]);

  async function decide(approve: boolean) {
    if (!authorizationId) return;
    setBusy(true);
    setError(null);
    try {
      const oauth = getSupabase().auth.oauth;
      const { data, error } = approve
        ? await oauth.approveAuthorization(authorizationId)
        : await oauth.denyAuthorization(authorizationId);
      if (error || !data) throw error ?? new Error("No redirect was returned.");
      window.location.assign(data.redirect_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete the request.");
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div>
        <h1>Can&rsquo;t continue</h1>
        <p role="alert" className="error">
          {error}
        </p>
      </div>
    );
  }
  if (!details) return <p className="muted">Loading authorization request…</p>;

  return (
    <div aria-labelledby="title">
      <h1 id="title">Authorize access</h1>
      <p>
        <strong>{details.clientName}</strong> wants to connect to your Education MCP server. It will be able to read
        and change your topics, quizzes and flashcards.
      </p>
      <dl>
        <dt>Will return you to</dt>
        <dd className="mono">{details.redirectUri}</dd>
        {details.scopes.length > 0 && (
          <>
            <dt>Requested scopes</dt>
            <dd>{details.scopes.join(", ")}</dd>
          </>
        )}
      </dl>
      <p className="muted">Only approve if you started this connection yourself and recognise the app above.</p>
      <div className="row">
        <button type="button" disabled={busy} onClick={() => decide(true)}>
          Approve
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={() => decide(false)}>
          Deny
        </button>
      </div>
    </div>
  );
}

export default function ConsentPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <Consent />
    </Suspense>
  );
}
