import { z } from "zod";

// Per-user app settings, stored as JSON on the account so they follow the user across devices.
// Request limits are sent along with each run (see /run); everything else is applied by the UI.
const font = z.string().max(200).regex(/^[\w\s,'"\-.()]*$/, "Invalid font family");
export const SettingsSchema = z
  .object({
    request: z
      .object({
        timeoutMs: z.number().int().min(0).max(3_600_000).default(30_000), // 0 = as long as the server allows
        maxResponseMb: z.number().min(0).max(4096).default(10), // 0 = as much as the server allows
      })
      .prefault({}),
    ui: z
      .object({
        openConsole: z.boolean().default(false),
        layout: z.enum(["stacked", "side"]).default("stacked"),
      })
      .prefault({}),
    editor: z
      .object({
        fontFamily: font.default(""),
        fontSize: z.number().int().min(8).max(32).default(13),
        indentCount: z.number().int().min(1).max(8).default(2),
        indentType: z.enum(["space", "tab"]).default("space"),
        autoCloseBrackets: z.boolean().default(true),
        autoCloseQuotes: z.boolean().default(true),
      })
      .prefault({}),
    app: z
      .object({
        theme: z.enum(["dark", "light"]).default("dark"),
        fontFamily: font.default(""),
        autosave: z.boolean().default(false),
      })
      .prefault({}),
  });
