import { useEffect, useState } from "react";
import { hue, initials } from "../../lib/utils.js";
/** Profile photo when `src` is given (and loads), otherwise coloured initials. */
export function Avatar({ name, size = 28, src }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [src]);
  if (src && !bad)
    return <img className="avatar" src={src} alt="" width={size} height={size} style={{ width: size, height: size, objectFit: "cover" }} onError={() => setBad(true)} />;
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4, background: `hsl(${hue(name)} 45% 38%)` }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
