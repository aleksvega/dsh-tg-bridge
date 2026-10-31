// What a failed turn says, and why. Kept apart from the bridge so the rules can
// be tested without starting a bot: every cause has one sentence, in the
// reader's language, and the sentence names the next action.
import { t } from '../core/i18n.mjs';

/**
 * Turn a raw CLI/provider error into `CODE` plus one actionable line.
 *
 * Raw text like `AUTH 403 insufficient_user_quota` means nothing to a person on
 * a phone; the code makes the failure greppable and the hint says what to do.
 */
export function explainFailure(text, lang = 'ru') {
  const raw = String(text);
  // The regular expressions match the CLI's and the provider's own words, so
  // they stay as they are; only the hint on the right follows the topic language.
  const cases = [
    // First, because it is the one failure whose advice is about the conversation
    // rather than about the account. A provider says it in many ways, and the
    // person used to get the raw CLI string with "something went wrong" under it
    // — the least useful answer for the one error the chat can actually fix.
    [/CONTEXT_WINDOW_EXCEEDED|context[_ ]length|maximum context|context window|prompt is too long|exceeds the context/i,
      'CONTEXT_OVERFLOW', 'bridge.fail.context'],
    // Money before keys, because "AUTH 403 ... allowance ... used up" names both
    // and only one of them tells the person what to do. A bare 401/403 with no
    // money word is a refused key and gets its own sentence below; topping up an
    // account whose key is wrong fixes nothing.
    [/insufficient_user_quota|insufficient quota|\b402\b|quota|balance|баланс|billing|allowance|wallet|credit/i,
      'INSUFFICIENT_QUOTA', 'bridge.fail.quota'],
    // A missing credential is its own case and must come before the key rule:
    // "MISSING_CREDENTIAL" contains no status code, and the fix (add the key) is
    // different from "the key you have is wrong" (replace it).
    [/MISSING_CREDENTIAL|no credentials|not authenticated/i,
      'MISSING_CREDENTIAL', 'bridge.fail.noCredential'],
    [/\b40[13]\b|AUTH\b|unauthorized|forbidden|invalid api key/i,
      'INVALID_KEY', 'bridge.fail.auth'],
    [/Conflict: terminated by other getUpdates|\b409\b/i,
      'TG_CONFLICT', 'bridge.fail.conflict'],
    [/ENOENT|not recognized|не найден.*dsh|dsh\.cmd/i,
      'NO_DSH_CLI', 'bridge.fail.noCli'],
    [/fetch failed|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|socket hang up|network/i,
      'NETWORK', 'bridge.fail.network'],
    [/EACCES|EPERM|access is denied|отказано в доступе|sandbox|permission denied/i,
      'SANDBOX_DENY', 'bridge.fail.sandbox'],
    [/UNKNOWN_MODEL|model not found|no such model/i,
      'UNKNOWN_MODEL', 'bridge.fail.unknownModel'],
    // A provider refusing the request shape is not the same as a dead balance:
    // the fallback chain already tried the other companies, so the honest advice
    // is "this request, not this route". Only the 400 class is a verdict on the
    // request; a 429 or a 5xx is load, and each has its own sentence below.
    [/INVALID_REQUEST|invalid_request_error|API error \((?:400|413|422)\)|HTTP (?:400|413|422)|Bad Request/i,
      'PROVIDER_REJECT', 'bridge.fail.reject'],
    [/RATE_LIMIT|\b429\b|rate.?limit|too many requests/i,
      'RATE_LIMITED', 'bridge.fail.rate'],
    [/empty response|EMPTY_RESPONSE|no output|пустой ответ/i,
      'EMPTY_RESPONSE', 'bridge.fail.empty'],
  ];
  // The clock, not the provider. The turn stopped itself with the session on
  // disk, so "repeat the request" would throw away everything it produced.
  const minutes = raw.match(/turn exceeded\s+(\d+)\s*min/i) || raw.match(/hard cap\s+(\d+)\s*min/i);
  if (/turn exceeded\s+\d+\s*min/i.test(raw) || /turn hard cap/i.test(raw)) {
    return `${raw}\n\nTURN_TIME_CAP: ${t(lang, 'bridge.fail.timeCap', { minutes: minutes ? minutes[1] : '?' })}`;
  }
  for (const [re, code, hint] of cases) {
    if (re.test(raw)) return `${raw}\n\n${code}: ${t(lang, hint)}`;
  }
  return `${raw}\n\nTURN_FAILED: ${t(lang, 'bridge.fail.generic')}`;
}
