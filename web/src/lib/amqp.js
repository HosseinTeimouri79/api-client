/** Deliveries that still wait for an acknowledgement, from the event log of a session (tag -> message event). */
export function pendingDeliveries(events) {
  const pending = new Map();
  for (const e of events) {
    if (e.type === "message" && e.direction === "in" && e.awaitingAck) pending.set(e.deliveryTag, e);
    else if (e.type === "acked" || e.type === "rejected") {
      for (const t of [...pending.keys()]) if (t === e.tag || (e.multiple && t <= e.tag)) pending.delete(t);
    }
  }
  return pending;
}
