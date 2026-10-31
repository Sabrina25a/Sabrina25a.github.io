# AeroSense | Telemetry System

AeroSense is a Raspberry Pi Pico W-based educational instrumentation prototype that combines motion sensing and environmental measurements with a browser-based telemetry dashboard.

## Features

- MPU6050 motion sensing and roll/pitch orientation estimates
- Thermistor temperature measurement
- Photoresistor-based relative light measurement
- Browser dashboard with live telemetry updates
- Dynamic artificial horizon and warning indicators
- Simulated flight-arming control and event markers
- HTTP/JSON telemetry served over the Pico W's local Wi-Fi network

## Hardware

- Raspberry Pi Pico W
- MPU6050 inertial measurement unit
- Thermistor
- Photoresistor
- Push buttons and LEDs

See `hardware/wiring_diagram.png` for the wiring diagram.

## Software

- MicroPython firmware in `firmware/main.py`
- Dashboard HTML, CSS, and JavaScript in `web/`

## Running on the Pico W

1. Open `firmware/main.py` and replace `YOUR_WIFI_NAME` and `YOUR_WIFI_PASSWORD` with your local Wi-Fi credentials. Do not commit real credentials to a public repository.
2. Copy `main.py` and the three files in `web/` (`index.html`, `style.css`, and `script.js`) to the Pico W's root filesystem. The firmware serves these assets from that same filesystem.
3. Confirm the GPIO assignments and sensor wiring match `hardware/wiring_diagram.png`.
4. Run `main.py` using a MicroPython-compatible workflow. Read the IP address printed to the serial console and open the Pico W's web server address in a browser on the same local network. The server uses port 8080.

The dashboard depends on the running Pico W and is intended for use on the same local network. The GitHub Pages portfolio displays a static screenshot rather than a live telemetry session.

## Technical Report

The full report is included in this project folder at `docs/AeroSense.pdf` and is also linked from the portfolio project page.

## Repository Structure

- `firmware/` - MicroPython firmware
- `web/` - Browser dashboard assets
- `hardware/` - Wiring diagram
- `docs/images/` - Dashboard, prototype, and architecture images

## Scope

AeroSense is an educational instrumentation prototype. Flight-related arming and event-marking features are simulated and are not intended for operational aircraft use.
