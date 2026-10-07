import { hue, initials } from "../../lib/utils.js";
export function Avatar({ name, size = 28 }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4, background: `hsl(${hue(name)} 45% 38%)` }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
