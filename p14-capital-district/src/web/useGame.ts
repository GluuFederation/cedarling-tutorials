import { useCallback, useEffect, useRef, useState } from "react";
import type { GameCommand, MatchSnapshot, Preset } from "../shared/contracts";
import { ApiError, api, type CommandInput, type Session } from "./api";
import { loadPending, type Pending, savePending } from "./pending";
export type Notice = { kind: "success" | "error"; text: string } | null;

function selectedMatch() {
  const match = /^#match\/([a-zA-Z0-9-]+)$/.exec(window.location.hash);
  return match?.[1] ?? null;
}

export function useGame() {
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState("");
  const [matches, setMatches] = useState<MatchSnapshot[]>([]);
  const [match, setMatch] = useState<MatchSnapshot | null>(null);
  const [matchId, setMatchId] = useState(selectedMatch);
  const destination = useRef(matchId);
  const mounted = useRef(true);
  const loadGeneration = useRef(0);
  const sessionGeneration = useRef(0);
  const [connection, setConnection] = useState("Connecting");
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [uncertain, setUncertain] = useState<Pending | null>(null);

  const clearSession = useCallback(() => {
    loadGeneration.current++;
    sessionGeneration.current++;
    sessionRef.current = { user: null };
    setSession({ user: null });
    setMatch(null);
    setMatches([]);
    setUncertain(null);
    setNotice(null);
    setLoadingError("");
    setLoading(false);
  }, []);

  const refreshSession = useCallback(async () => {
    const generation = sessionGeneration.current;
    const next = await api.session();
    if (!mounted.current || generation !== sessionGeneration.current)
      return sessionRef.current;
    if (next.user?.id !== sessionRef.current?.user?.id) {
      sessionGeneration.current++;
      setMatch(null);
      setMatches([]);
      setNotice(null);
      setUncertain(next.user ? loadPending(next.user.id) : null);
    }
    sessionRef.current = next;
    setSession(next);
    return next;
  }, []);

  const fail = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) clearSession();
      else
        setNotice({
          kind: "error",
          text:
            error instanceof Error
              ? error.message
              : "The request failed. Try again.",
        });
    },
    [clearSession],
  );

  const reload = useCallback(async () => {
    if (!mounted.current || selectedMatch() !== matchId) return;
    const generation = ++loadGeneration.current;
    let actorId = sessionRef.current?.user?.id;
    const isCurrent = () =>
      mounted.current &&
      generation === loadGeneration.current &&
      selectedMatch() === matchId &&
      sessionRef.current?.user?.id === actorId;
    setLoadingError("");
    try {
      const current = await refreshSession();
      actorId = current?.user?.id;
      if (!isCurrent() || !current?.user) return;
      if (matchId) {
        const next = await api.match(matchId);
        if (isCurrent())
          setMatch((previous) =>
            previous?.id === next.id && previous.version > next.version
              ? previous
              : next,
          );
      } else {
        const next = await api.matches();
        if (isCurrent()) setMatches(next);
      }
    } catch (error) {
      if (!isCurrent()) return;
      if (error instanceof ApiError && error.status === 401) clearSession();
      else
        setLoadingError(
          error instanceof Error ? error.message : "Could not load the game.",
        );
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [matchId, refreshSession, clearSession]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      loadGeneration.current++;
      sessionGeneration.current++;
    };
  }, []);
  const userId = session?.user?.id;
  useEffect(() => {
    if (sessionRef.current?.user?.id !== userId) return;
    setLoading(true);
    void reload();
    return () => {
      loadGeneration.current++;
    };
  }, [reload, userId]);
  useEffect(() => {
    const changed = () => {
      const next = selectedMatch();
      if (next === destination.current) return;
      destination.current = next;
      loadGeneration.current++;
      setMatch(null);
      setMatchId(next);
      setLoading(Boolean(sessionRef.current?.user));
      setLoadingError("");
      setNotice(null);
    };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => {
    const check = () => {
      void refreshSession().catch(() => {});
    };
    const visible = () => {
      if (document.visibilityState === "visible") check();
    };
    const timer = window.setInterval(check, 15_000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refreshSession]);
  useEffect(() => {
    if (!matchId || !userId) return;
    const source = new EventSource(
      `/api/matches/${encodeURIComponent(matchId)}/events`,
    );
    setConnection("Connecting");
    source.onopen = () => setConnection("Connected");
    source.addEventListener("snapshot", (event) => {
      try {
        const next = JSON.parse(
          (event as MessageEvent<string>).data,
        ) as MatchSnapshot;
        if (
          next.id !== matchId ||
          sessionRef.current?.user?.id !== userId ||
          selectedMatch() !== matchId
        )
          return;
        setMatch((previous) =>
          !previous || next.version >= previous.version ? next : previous,
        );
        setConnection("Connected");
      } catch {
        setConnection("Reconnecting");
      }
    });
    source.onerror = () => {
      setConnection("Reconnecting");
      void refreshSession().catch(() => {});
    };
    return () => {
      source.close();
    };
  }, [matchId, userId, refreshSession]);
  useEffect(() => {
    if (notice?.kind !== "success") return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  const perform = useCallback(
    async (pending: Pending): Promise<boolean> => {
      const csrf = sessionRef.current?.csrfToken;
      const actorId = sessionRef.current?.user?.id;
      if (!csrf || !actorId || busyRef.current) return false;
      busyRef.current = true;
      setBusy(true);
      setNotice(null);
      savePending(actorId, pending);
      try {
        const result =
          pending.kind === "create"
            ? await api.create(pending.name, pending.preset, csrf, pending.key)
            : await api.command(
                pending.matchId,
                pending.command,
                csrf,
                pending.key,
              );
        savePending(actorId, null);
        if (!mounted.current || sessionRef.current?.user?.id !== actorId)
          return false;
        setMatch((previous) =>
          previous?.id === result.match.id &&
          previous.version > result.match.version
            ? previous
            : result.match,
        );
        setUncertain(null);
        setNotice({ kind: "success", text: "Change saved." });
        if (selectedMatch() !== result.match.id)
          window.location.hash = `match/${result.match.id}`;
        return true;
      } catch (error) {
        if (!mounted.current || sessionRef.current?.user?.id !== actorId)
          return false;
        if (
          !(error instanceof ApiError) ||
          (error.status >= 500 && error.code !== "authorization_unavailable")
        ) {
          setUncertain(pending);
          setNotice({
            kind: "error",
            text: "The response was lost. The action may have completed. Refresh the board, then retry this same request to confirm it.",
          });
        } else {
          if (error.status !== 401) savePending(actorId, null);
          setUncertain(null);
          fail(error);
        }
        await reload();
        return false;
      } finally {
        busyRef.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [fail, reload],
  );

  const command = (input: CommandInput) => {
    if (!match || uncertain) return Promise.resolve(false);
    return perform({
      kind: "command",
      key: crypto.randomUUID(),
      matchId: match.id,
      command: { ...input, expectedVersion: match.version } as GameCommand,
    });
  };
  const create = (name: string, preset: Preset) =>
    uncertain
      ? Promise.resolve(false)
      : perform({ kind: "create", name, preset, key: crypto.randomUUID() });
  const logout = async () => {
    if (busyRef.current || uncertain || !sessionRef.current?.csrfToken) return;
    try {
      await api.logout(sessionRef.current.csrfToken);
      clearSession();
      window.location.hash = "";
    } catch (error) {
      fail(error);
    }
  };
  return {
    session,
    loading,
    loadingError,
    matches,
    match,
    connection,
    notice,
    busy,
    uncertain,
    command,
    create,
    logout,
    reload,
    dismissNotice: () => setNotice(null),
    retry: () => (uncertain ? perform(uncertain) : Promise.resolve(false)),
  };
}
