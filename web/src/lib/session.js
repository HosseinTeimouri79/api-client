// Client side of live sessions: follows a session's Server-Sent Events with fetch (cookies and the CSRF header work,
// unlike EventSource), and reconnects with ?since= when the stream drops while the session is still alive.
export async function followSession(wid, id, { onEvent, onEnd, signal }) {
  let since = 0;
  for (let attempt = 0; !signal.aborted; ) {
    try {
      const res = await fetch(`/api/workspaces/${wid}/sessions/${id}/events?since=${since}`, { headers: { "X-Requested-With": "api-client" }, signal });
      if (!res.ok) return onEnd?.({ status: res.status });
      attempt = 0;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (block.startsWith("event: end")) return onEnd?.({ status: 200 });
          const line = block.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const ev = JSON.parse(line.slice(6));
          since = ev.seq;
          onEvent(ev);
        }
      }
    } catch (e) {
      if (signal.aborted) return;
    }
    if (++attempt > 5) return onEnd?.({ status: 0 });
    await new Promise((r) => setTimeout(r, Math.min(4000, 300 * 2 ** attempt)));
  }
}
