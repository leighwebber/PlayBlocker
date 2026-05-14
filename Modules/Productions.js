/**
 * Productions.js — Session validation for the Productions page
 *
 * Verifies that the user has a valid session cookie before the Productions
 * page content is displayed.  The check is performed on DOMContentLoaded
 * so the page can redirect or hide protected content if the session is invalid.
 */

document.addEventListener("DOMContentLoaded", function () {
    console.log("Productions page DOM ready — validating session...");
    page_validate().then((valid) => {
        if (valid !== "true") {
            console.warn("Session invalid — redirect or hide protected content here.");
            // TODO: redirect to login page, e.g. window.location.href = "/login.html";
        }
    });
});

/**
 * Calls the API session-validation endpoint.
 *
 * Uses `credentials: "include"` so the browser sends the session cookie with
 * the request (required for cross-origin cookie-based auth).
 *
 * @returns {Promise<"true"|"false">} Resolves to "true" if the session is valid.
 */
async function page_validate() {
    try {
        const response = await fetch("https://lwebber.ca/api/validate", {
            method:      "GET",
            credentials: "include" // Send session cookie for authentication
        });

        if (!response.ok) {
            console.warn("page_validate: server returned", response.status);
            return "false";
        }

        // The API returns a JSON object; check the `valid` field
        const data = await response.json();
        console.log("Validation response:", data);
        return data.valid === "true" ? "true" : "false";

    } catch (error) {
        console.error("page_validate: fetch failed —", error);
        return "false";
    }
}