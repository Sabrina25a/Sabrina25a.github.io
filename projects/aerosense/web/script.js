// =====================================
// AEROSENSE TELEMETRY SYSTEM
// =====================================

const POLL_INTERVAL = 1000;
const PITCH_SCALE = 1.5;
const MAX_PITCH_OFFSET = 100;
const MAX_LOG_ENTRIES = 60;

let displayedRoll = 0;
let displayedPitch = 0;
let hasInitialOrientation = false;

let previousFlightArmed = null;
let previousArmEventCount = null;
let previousMarkerCount = null;
let hasInitialisedEventState = false;
let sessionEventCount = 0;

// =====================================
// WARNING STATE
// =====================================

let previousWarningState = null;

// =====================================
// FORMATTING AND DOM HELPERS
// =====================================

function formatSigned(value, decimals = 2) {
    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return "--.--";
    }

    const number = Number(value);

    if (!Number.isFinite(number)) {
        return "--.--";
    }

    return (number >= 0 ? "+" : "") + number.toFixed(decimals);
}


function setText(id, value) {
    const element = document.getElementById(id);

    if (element) {
        element.textContent = value;
    }
}


// =====================================
// MISSION EVENT LOG
// =====================================

function addEvent(message, type = "normal") {
    const log = document.getElementById("event-log");

    if (!log) {
        return;
    }

    const placeholder = log.querySelector(".event");

    if (
        placeholder &&
        placeholder.textContent.includes(
            "Waiting for telemetry data"
        )
    ) {
        log.replaceChildren();
    }

    const now = new Date();

    const entry = document.createElement("div");
    entry.className = "event";

    if (type === "alert") {
        entry.classList.add("event-alert");
    } else if (type === "success") {
        entry.classList.add("event-success");
    }

    const timestamp = document.createElement("span");
    timestamp.className = "event-time";

    timestamp.textContent = now.toLocaleTimeString([], {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });

    const description = document.createElement("span");
    description.textContent = message;

    entry.append(timestamp, description);

    log.prepend(entry);

    while (log.children.length > MAX_LOG_ENTRIES) {
        log.removeChild(log.lastElementChild);
    }

    sessionEventCount++;

    setText("session-event-count", sessionEventCount);
}


// =====================================
// CONNECTION STATUS
// =====================================

function setConnectionStatus(connected) {
    const status = document.querySelector(
        ".system-status span:last-child"
    );

    const dot = document.querySelector(".status-dot");

    const imuStatus = document.querySelector(".imu-online");

    if (status) {
        if (!connected) {
            status.textContent = "TELEMETRY LOST";
        } else if (previousWarningState !== null &&
                   previousWarningState !== "") {
            status.textContent = "WARNING ACTIVE";
        } else {
            status.textContent = "SYSTEM NOMINAL";
        }
    }

    if (dot) {
        dot.style.background = connected
            ? "var(--green)"
            : "var(--red)";

        dot.style.boxShadow = connected
            ? "0 0 7px var(--green)"
            : "0 0 7px var(--red)";
    }

    if (imuStatus) {
        imuStatus.textContent = connected
            ? "● ONLINE"
            : "● OFFLINE";

        imuStatus.style.color = connected
            ? "var(--green)"
            : "var(--red)";
    }

    setText("link-status", connected ? "ONLINE" : "OFFLINE");

    setText(
        "sensor-bus-status",
        connected ? "ONLINE" : "UNKNOWN"
    );

    setText(
        "data-link-status",
        connected ? "ACTIVE" : "LOST"
    );

    const sensorStatus = document.getElementById(
        "sensor-bus-status"
    );

    const linkStatus = document.getElementById(
        "data-link-status"
    );

    if (sensorStatus) {
        sensorStatus.classList.toggle("online", connected);
    }

    if (linkStatus) {
        linkStatus.classList.toggle("online", connected);
    }
}

// =====================================
// SYSTEM WARNING DISPLAY
// =====================================

function updateWarnings(data) {
    const banner = document.getElementById("warning-banner");

    const temperatureWarning =
        data.temperature_warning === true;

    const tiltWarning =
        data.tilt_warning === true;

    const warnings = [];

    if (temperatureWarning) {
        warnings.push("TEMPERATURE ABOVE 35°C");
    }

    if (tiltWarning) {
        warnings.push("ROLL OR PITCH EXCEEDS ±30°");
    }

    const hasWarning = warnings.length > 0;

    // Update the warning banner
    if (banner) {
        banner.classList.toggle("warning-active", hasWarning);
    }

    setText(
        "warning-heading",
        hasWarning ? "WARNING ACTIVE" : "ALL SYSTEMS NOMINAL"
    );

    setText(
        "warning-message",
        hasWarning
            ? warnings.join(" // ")
            : "No active warnings. Environmental and attitude readings are within configured limits."
    );

    setText(
        "warning-code",
        hasWarning
            ? `ALERT ${String(warnings.length).padStart(2, "0")}`
            : "STATUS 00"
    );

    // Update the header status
    const headerStatus = document.querySelector(
        ".system-status span:last-child"
    );

    const headerDot = document.querySelector(".status-dot");

    if (headerStatus) {
        headerStatus.textContent = hasWarning
            ? "WARNING ACTIVE"
            : "SYSTEM NOMINAL";
    }

    if (headerDot) {
        headerDot.style.background = hasWarning
            ? "var(--red)"
            : "var(--green)";

        headerDot.style.boxShadow = hasWarning
            ? "0 0 7px var(--red)"
            : "0 0 7px var(--green)";
    }

    // Update the system alerts row
    setText(
        "alert-status",
        hasWarning ? `${warnings.length} ACTIVE` : "NONE"
    );

    const alertStatus = document.getElementById("alert-status");

    if (alertStatus) {
        alertStatus.classList.toggle("online", !hasWarning);
        alertStatus.style.color = hasWarning
            ? "var(--red)"
            : "var(--green)";
    }

    // Update the flight status card without overwriting
    // the underlying armed/standby state.
    if (hasWarning) {
        setText(
            "flight-status-summary",
            "WARNING ACTIVE"
        );

        setText(
            "flight-status-description",
            warnings.join(". ") + "."
        );
    } else {
        const armed = data.flight_armed === true;

        setText(
            "flight-status-summary",
            armed ? "SYSTEM ARMED" : "SYSTEM READY"
        );

        setText(
            "flight-status-description",
            armed
                ? "Flight control simulation armed."
                : "Flight control simulation in standby."
        );
    }

    // Record warning transitions in the event log
    const warningState = warnings.join("|");

    if (previousWarningState === null) {
        previousWarningState = warningState;

        if (hasWarning) {
            addEvent(
                `System warning detected: ${warnings.join(", ")}.`,
                "alert"
            );
        }
    } else if (warningState !== previousWarningState) {
        if (hasWarning) {
            addEvent(
                `System warning: ${warnings.join(", ")}.`,
                "alert"
            );
        } else {
            addEvent(
                "All system warnings cleared.",
                "success"
            );
        }

        previousWarningState = warningState;
    }
}

// =====================================
// DYNAMIC ARTIFICIAL HORIZON
// =====================================

function updateHorizon(roll, pitch) {
    const scene = document.getElementById("horizon-scene");

    if (!scene) {
        return;
    }

    if (
        !Number.isFinite(roll) ||
        !Number.isFinite(pitch)
    ) {
        return;
    }

    if (!hasInitialOrientation) {
        displayedRoll = roll;
        displayedPitch = pitch;

        hasInitialOrientation = true;
    } else {
        const smoothing = 0.35;

        displayedRoll +=
            (roll - displayedRoll) * smoothing;

        displayedPitch +=
            (pitch - displayedPitch) * smoothing;
    }

    const rotation = -displayedRoll;

    const pitchOffset = Math.max(
        -MAX_PITCH_OFFSET,
        Math.min(
            MAX_PITCH_OFFSET,
            displayedPitch * PITCH_SCALE
        )
    );

    scene.style.transform =
        `translateY(${pitchOffset}px) rotate(${rotation}deg)`;
}


// =====================================
// FLIGHT SYSTEMS
// =====================================

function updateFlightSystems(data) {
    const armed = data.flight_armed;
    const armCount = data.arm_event_count;
    const markerCount = data.marker_count;

    const stateValue = document.getElementById(
        "flight-state-value"
    );

    const stateIndicator = document.getElementById(
        "flight-state-indicator"
    );

    const systemSummary = document.getElementById(
        "flight-status-summary"
    );

    const systemDescription = document.getElementById(
        "flight-status-description"
    );

    const systemStatus = document.getElementById(
        "flight-system-status"
    );

    // Flight state

    if (typeof armed === "boolean") {
        setText(
            "flight-state-value",
            armed ? "ARMED" : "STANDBY"
        );

        setText(
            "flight-status-summary",
            armed ? "SYSTEM ARMED" : "SYSTEM READY"
        );

        setText(
            "flight-status-description",
            armed
                ? "Flight control simulation armed."
                : "Flight control simulation in standby."
        );

        if (stateValue) {
            stateValue.classList.toggle("armed", armed);
        }

        if (stateIndicator) {
            stateIndicator.classList.toggle("armed", armed);
        }

        if (systemStatus) {
            systemStatus.textContent = armed
                ? "ARMED"
                : "STANDBY";

            systemStatus.classList.toggle("armed", armed);

            systemStatus.classList.toggle(
                "standby",
                !armed
            );
        }
    }

    // Event marker count

    if (
        markerCount !== null &&
        markerCount !== undefined &&
        Number.isFinite(Number(markerCount))
    ) {
        setText("marker-count", markerCount);
        setText("event-counter-status", markerCount);
    }

    // Initialise event tracking on first successful response

    if (!hasInitialisedEventState) {
        previousFlightArmed = armed;
        previousArmEventCount = armCount;
        previousMarkerCount = markerCount;

        hasInitialisedEventState = true;

        addEvent("Telemetry link established.", "success");

        if (typeof armed === "boolean") {
            addEvent(
                `Flight system initialized in ${
                    armed ? "ARMED" : "STANDBY"
                } state.`
            );
        }

        return;
    }

    // Record changes to the flight system state

    if (
        typeof armed === "boolean" &&
        typeof previousFlightArmed === "boolean" &&
        armed !== previousFlightArmed
    ) {
        addEvent(
            armed
                ? "Flight system armed by physical control."
                : "Flight system returned to standby.",
            armed ? "success" : "normal"
        );
    }

    // Detect flight counter resets

    if (
        Number.isFinite(Number(armCount)) &&
        previousArmEventCount !== null &&
        armCount < previousArmEventCount
    ) {
        addEvent(
            "Flight control counter reset. New session detected."
        );
    }

    // Record newly added event markers

    if (
        markerCount !== null &&
        markerCount !== undefined &&
        previousMarkerCount !== null &&
        Number.isFinite(Number(markerCount)) &&
        Number.isFinite(Number(previousMarkerCount)) &&
        markerCount > previousMarkerCount
    ) {
        const newMarkers = markerCount - previousMarkerCount;

        for (
            let i = 0;
            i < Math.min(newMarkers, 10);
            i++
        ) {
            addEvent("Manual event marker recorded.", "success");
        }
    } else if (
        markerCount !== null &&
        markerCount !== undefined &&
        previousMarkerCount !== null &&
        Number.isFinite(Number(markerCount)) &&
        Number.isFinite(Number(previousMarkerCount)) &&
        markerCount < previousMarkerCount
    ) {
        addEvent(
            "Event marker counter reset. New session detected."
        );
    }

    previousFlightArmed = armed;
    previousArmEventCount = armCount;
    previousMarkerCount = markerCount;
}


// =====================================
// TELEMETRY UPDATE
// =====================================

async function updateTelemetry() {
    try {
        const response = await fetch("/data", {
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error(
                `Telemetry request failed: HTTP ${response.status}`
            );
        }

        const data = await response.json();

        // Environment

        const temperature =
            data.temperature === null ||
            data.temperature === undefined
                ? NaN
                : Number(data.temperature);

        const light =
            data.light === null ||
            data.light === undefined
                ? NaN
                : Number(data.light);

        setText(
            "temperature-value",
            Number.isFinite(temperature)
                ? temperature.toFixed(1)
                : "--.-"
        );

        setText(
            "light-value",
            Number.isFinite(light)
                ? light.toFixed(1)
                : "---.-"
        );

        // Acceleration

        setText(
            "accel-x-value",
            formatSigned(data.accel_x)
        );

        setText(
            "accel-y-value",
            formatSigned(data.accel_y)
        );

        setText(
            "accel-z-value",
            formatSigned(data.accel_z)
        );

        // Angular velocity

        setText(
            "gyro-x-value",
            formatSigned(data.gyro_x)
        );

        setText(
            "gyro-y-value",
            formatSigned(data.gyro_y)
        );

        setText(
            "gyro-z-value",
            formatSigned(data.gyro_z)
        );

        // Attitude

        const roll =
            data.roll === null ||
            data.roll === undefined
                ? NaN
                : Number(data.roll);

        const pitch =
            data.pitch === null ||
            data.pitch === undefined
                ? NaN
                : Number(data.pitch);

        const yawRate =
            data.yaw_rate === null ||
            data.yaw_rate === undefined
                ? NaN
                : Number(data.yaw_rate);

        setText(
            "roll-value",
            formatSigned(roll, 1)
        );

        setText(
            "pitch-value",
            formatSigned(pitch, 1)
        );

        setText(
            "yaw-rate-value",
            formatSigned(yawRate, 1)
        );

        if (
            Number.isFinite(roll) &&
            Number.isFinite(pitch)
        ) {
            updateHorizon(roll, pitch);
        }

        // Flight systems and event tracking

        updateFlightSystems(data);

        // System warnings

        updateWarnings(data);

        // Connection status

        setConnectionStatus(true);

    } catch (error) {
        console.error("Telemetry error:", error);

        setConnectionStatus(false);
    }
}


// =====================================
// CONTINUOUS TELEMETRY POLLING
// =====================================

async function telemetryLoop() {
    while (true) {
        const startTime = Date.now();

        await updateTelemetry();

        const elapsed = Date.now() - startTime;

        const delay = Math.max(
            0,
            POLL_INTERVAL - elapsed
        );

        await new Promise(
            resolve => setTimeout(resolve, delay)
        );
    }
}


// =====================================
// START SYSTEM
// =====================================

console.log("AeroSense telemetry script loaded.");

telemetryLoop();