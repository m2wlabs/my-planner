import type { AiSuggestedAction } from "./api";

/**
 * Trims degenerate repetition loops some smaller models emit under long decodes.
 * Provider-agnostic: the fallback copy never names a specific vendor or model.
 */
export function sanitizeRepetitionLoops(text: string): string {
  if (text.length < 48) return text;
  const longMatch = /([^\s\-=*]{3,14}?)\1{7,}/.exec(text);
  const shortMatch = /([^\s\-=*]{1,2}?)\1{13,}/.exec(text);
  const hit =
    longMatch && shortMatch
      ? longMatch.index <= shortMatch.index
        ? longMatch
        : shortMatch
      : longMatch || shortMatch;
  if (!hit) return text;
  const prefix = text.slice(0, hit.index).replace(/[^A-Za-z0-9.?!]+$/, "").trim();
  if (!prefix) {
    return "The model hit a repetition loop. Try another model for cleaner replies.";
  }
  return `${prefix}\n\n*(Response trimmed because this model repeated tokens — try a different model for best reliability.)*`;
}

function unescapeJsonFragment(raw: string): string {
  return raw.replace(/\\(n|r|t|"|\\|\/)/g, (_, ch: string) => {
    switch (ch) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case '"':
        return '"';
      case "\\":
        return "\\";
      case "/":
        return "/";
      default:
        return ch;
    }
  });
}

export function parseStructuredOutput(rawText: string): {
  reply: string;
  actions: AiSuggestedAction[];
} {
  const trimmed = rawText.trim();

  // 1. Primary format: natural Markdown + optional trailing ```planner-actions [...] ``` block
  const fenceStart = trimmed.indexOf("```planner-actions");
  if (fenceStart !== -1) {
    const before = trimmed.slice(0, fenceStart).trim();
    const afterTag = trimmed.slice(fenceStart + "```planner-actions".length);
    const fenceEnd = afterTag.indexOf("```");
    const jsonBlock = fenceEnd !== -1 ? afterTag.slice(0, fenceEnd) : afterTag;
    const after = fenceEnd !== -1 ? afterTag.slice(fenceEnd + 3).trim() : "";
    let actions: AiSuggestedAction[] = [];
    try {
      const parsed = JSON.parse(jsonBlock.trim()) as unknown;
      if (Array.isArray(parsed)) {
        actions = parsed as AiSuggestedAction[];
      } else if (
        parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as Record<string, unknown>).suggested_actions)
      ) {
        actions = (parsed as Record<string, unknown>).suggested_actions as AiSuggestedAction[];
      }
    } catch {
      /* ignore malformed action block */
    }
    const prose = sanitizeRepetitionLoops([before, after].filter(Boolean).join("\n\n"));
    return {
      reply: prose || (actions.length ? "Here are the planner updates I prepared for you:" : ""),
      actions,
    };
  }

  // 2. Fallback: valid JSON wrapper {"reply": "...", "suggested_actions": [...]}
  const candidate = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()
    : trimmed;
  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    if (typeof parsed.reply === "string") {
      return {
        reply: sanitizeRepetitionLoops(parsed.reply),
        actions: Array.isArray(parsed.suggested_actions)
          ? (parsed.suggested_actions as AiSuggestedAction[])
          : [],
      };
    }
  } catch {
    /* continue */
  }

  // 3. Truncated/broken JSON recovery (e.g. `{"reply":"I've got your...` cut off mid-string)
  if (candidate.startsWith("{")) {
    const m = /"reply"\s*:\s*"([\s\S]*)/.exec(candidate);
    if (m) {
      const rest = m[1];
      let end = rest.length;
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "\\") {
          i++;
          continue;
        }
        if (rest[i] === '"') {
          end = i;
          break;
        }
      }
      return {
        reply: sanitizeRepetitionLoops(unescapeJsonFragment(rest.slice(0, end))),
        actions: [],
      };
    }
  }

  return { reply: sanitizeRepetitionLoops(trimmed), actions: [] };
}
