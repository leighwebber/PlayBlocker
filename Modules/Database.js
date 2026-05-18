import { API_URL, myIframe } from "../Modules/Constants.js";

// ---------------------------------------------------------------------------
// Script — saveScript
// ---------------------------------------------------------------------------

/**
 * Saves the current script (including any movement annotations) to the database.
 */
export async function saveScript() {
    const content  = myIframe.contentDocument.body.innerHTML;
    const response = await fetch(`${API_URL}/saveScript`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ content }),
    });

    if (!response.ok) {
        throw new Error(`Failed to save script: ${response.statusText}`);
    }

    return await response.json();
}

// ---------------------------------------------------------------------------
// Speakers — fetchSpeakers, saveSpeakers
// ---------------------------------------------------------------------------

/**
 * Fetches the speaker list for the current production from the server.
 *
 * Returns an array of plain objects:
 *   [{ id, name, initials, color, rpX, rpY }, …]
 *
 * rpX / rpY are null when the speaker has not yet been placed on stage.
 *
 * @returns {Promise<Array<{id:number, name:string, initials:string,
 *                          color:string, rpX:number|null, rpY:number|null}>>}
 */
export async function fetchSpeakers() {
    const response = await fetch(`${API_URL}/speakers`, {
        method:      "GET",
        credentials: "include",
        headers:     { "Accept": "application/json" },
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch speakers: ${response.statusText}`);
    }

    const rows = await response.json();

    // Normalise the server's snake_case column names to camelCase for the client
    return rows.map((row) => ({
        id:       row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        initials: row.initials,
        color:    row.color,
        rpX:      row.rp_x != null ? parseFloat(row.rp_x) : null,
        rpY:      row.rp_y != null ? parseFloat(row.rp_y) : null,
    }));
}

/**
 * Persists the current stage position (RP) of every speaker to the server.
 *
 * Sends the full speaker list so the server can upsert all rows in one request.
 * Called whenever a speaker is dropped onto the stage image.
 *
 * @param {import('./Backend.js').Speaker[]} speakers - The module-level speakers array
 * @returns {Promise<void>}
 */
export async function saveSpeakers(speakers) {
    const payload = speakers.map((s) => ({
        id:       s.dbId,           // server-assigned PK, set after fetchSpeakers()
        first_name:     s.speakerFirstName,
        last_name:     s.speakerLastName,
        initials: s.speakerInitials,
        rpX:      s.RP?.rX ?? null,
        rpY:      s.RP?.rY ?? null,
    }));

    const response = await fetch(`${API_URL}/speakers`, {
        method:      "PUT",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify(payload),
    });

    if (!response.ok) {
        throw new Error(`Failed to save speakers: ${response.statusText}`);
    }
}

// ---------------------------------------------------------------------------
// Movements — saveMovement
// ---------------------------------------------------------------------------

/**
 * Persists a completed character movement (and its waypoints) to the server.
 *
 * Called from the ondrop handler once the user has placed the speaker icon
 * on the stage image and the movement is considered complete.
 *
 * @param {import('./Backend.js').Movement} movement - The completed Movement object
 * @param {number} speakerDbId  - The speakers.id PK for the moving speaker
 * @returns {Promise<void>}
 */
export async function saveMovement(movement, speakerDbId) {
    // Extract the numeric index from the movement's span id, e.g. "m-3" → 3
    const markerId = parseInt(movement.node?.id?.split("-").pop(), 10);

    const waypoints = movement.movementMarkers.map((markerDiv, i) => ({
        sequence: i,
        rpX:      markerDiv._rp?.rX ?? null,
        rpY:      markerDiv._rp?.rY ?? null,
    }));

    const payload = {
        speakerId:    speakerDbId,
        markerId,
        shadowRpX:    movement.shadowRP?.rX ?? null,
        shadowRpY:    movement.shadowRP?.rY ?? null,
        endRpX:       movement.speaker?.RP?.rX ?? null,
        endRpY:       movement.speaker?.RP?.rY ?? null,
        waypoints,
    };

    const response = await fetch(`${API_URL}/movements`, {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify(payload),
    });

    if (!response.ok) {
        throw new Error(`Failed to save movement: ${response.statusText}`);
    }
}