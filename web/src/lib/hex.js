/** A classic hex dump (offset, 16 bytes in hex, printable characters) of base64 data; long data is cut after `max` bytes. */
export function hexDump(base64, max = 4096) {
  let bin = "";
  try { bin = atob(base64); } catch { return ""; }
  const n = Math.min(bin.length, max);
  const lines = [];
  for (let i = 0; i < n; i += 16) {
    const row = [...bin.slice(i, Math.min(i + 16, n))].map((c) => c.charCodeAt(0));
    const hex = row.map((b) => b.toString(16).padStart(2, "0")).join(" ").padEnd(47, " ");
    const text = row.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join("");
    lines.push(`${i.toString(16).padStart(8, "0")}  ${hex}  ${text}`);
  }
  if (bin.length > max) lines.push(`… ${bin.length - max} more bytes`);
  return lines.join("\n");
}
