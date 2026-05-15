import { API_URL, myIframe } from "../Modules/Constants.js";
// ---------------------------------------------------------------------------
// Script saveScript
// ---------------------------------------------------------------------------

/**
 * Saves the current script (including any movement annotations)
 * to the database
 */
export async function saveScript() {
  const content = myIframe.contentDocument.body.innerHTML;
  // debugger;
  const response = await fetch(`${API_URL}/saveScript`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content }),
  });

  if (!response.ok) {
    throw new Error(`Failed to save script: ${response.statusText}`);
  }

  return await response.json();
}
