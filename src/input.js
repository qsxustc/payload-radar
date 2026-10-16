import { parseInput } from './core.js';

// Parser diagnostics differ across runtimes and may quote input. Keep browser
// feedback useful without allowing a malformed payload to flood the UI.
function conciseDiagnostic(message) {
  const compact = String(message).replace(/\s+/g, ' ').trim();
  return compact.length > 180 ? `${compact.slice(0, 179)}…` : compact;
}

/**
 * Detect each input independently while keeping complete JSON documents intact.
 * An explicit preference always uses that format, including its validation.
 */
export function parsePayload(text, preference = 'auto') {
  if (preference !== 'auto') {
    return { samples: parseInput(text, preference), format: preference };
  }

  let jsonError;
  try {
    return { samples: parseInput(text, 'json'), format: 'json' };
  } catch (error) {
    // A valid document that exceeds engine limits must never be reinterpreted.
    if (!(error instanceof SyntaxError) || !text.trim()) throw error;
    jsonError = error;
  }

  try {
    return { samples: parseInput(text, 'jsonl'), format: 'jsonl' };
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new SyntaxError(`Input is neither valid JSON nor JSON Lines. ${conciseDiagnostic(jsonError.message)} ${conciseDiagnostic(error.message)}`);
  }
}
