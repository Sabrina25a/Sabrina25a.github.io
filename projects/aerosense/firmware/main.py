import network
import socket
import time
import json
import math

from machine import Pin, ADC, I2C

# =========================
# Wi-Fi
# =========================

SSID = "YOUR_WIFI_NAME"
PASSWORD = "YOUR_WIFI_PASSWORD"

# =========================
# Hardware setup
# =========================

# Buttons
green_button = Pin(21, Pin.IN, Pin.PULL_UP)
blue_button = Pin(20, Pin.IN, Pin.PULL_UP)

# LEDs
green_led = Pin(18, Pin.OUT)
red_led = Pin(17, Pin.OUT)
blue_led = Pin(16, Pin.OUT)

# Analog sensors
thermistor = ADC(26)
photoresistor = ADC(27)

# MPU6050
i2c = I2C(
    0,
    scl=Pin(5),
    sda=Pin(4),
    freq=400000
)

MPU6050_ADDR = 0x68

# =========================
# Thermistor parameters
# =========================
THERMISTOR_R0 = 10000       # 10 kΩ at 25°C
THERMISTOR_T0 = 25 + 273.15 # 25°C in Kelvin
THERMISTOR_BETA = 3950      # 10 kΩ NTC value
FIXED_RESISTOR = 10000      # 10 kΩ
TEMPERATURE_OFFSET = -9.7   # 9.7°C offset

# =========================
# Light sensor calibration
# =========================

LIGHT_DARK_VOLTAGE = 2.5
LIGHT_BRIGHT_VOLTAGE = 0.2

LIGHT_ADC_MAX = 65535
LIGHT_ADC_VOLTAGE = 3.3

LIGHT_SAMPLES = 10

# =========================
# Warning thresholds
# =========================

TEMPERATURE_WARNING = 35.0
TILT_WARNING = 30.0

# =========================
# Attitude calibration
# =========================

ROLL_OFFSET = -1.7
PITCH_OFFSET = -8.0

# =========================
# Flight system simulation
# =========================

flight_armed = False

arm_event_count = 0
marker_count = 0

last_green_press = time.ticks_ms() - 500
last_blue_press = time.ticks_ms() - 500

blue_led_off_at = None

# Start with all LEDs off
green_led.value(0)
red_led.value(0)
blue_led.value(0)

# =========================
# Physical button handlers
# =========================

def handle_green_button(pin):
    global flight_armed
    global arm_event_count
    global last_green_press

    now = time.ticks_ms()

    # Debounce the physical button
    if time.ticks_diff(now, last_green_press) < 300:
        return

    last_green_press = now

    # Toggle flight system state
    flight_armed = not flight_armed
    arm_event_count += 1

    # Green LED indicates ARMED state
    green_led.value(1 if flight_armed else 0)


def handle_blue_button(pin):
    global marker_count
    global last_blue_press
    global blue_led_off_at

    now = time.ticks_ms()

    # Debounce the physical button
    if time.ticks_diff(now, last_blue_press) < 300:
        return

    last_blue_press = now

    # Record a new event marker
    marker_count += 1

    # Flash blue LED briefly
    blue_led.value(1)
    blue_led_off_at = time.ticks_add(now, 250)


# Enable interrupt-based button detection
green_button.irq(
    trigger=Pin.IRQ_FALLING,
    handler=handle_green_button
)

blue_button.irq(
    trigger=Pin.IRQ_FALLING,
    handler=handle_blue_button
)

# =========================
# MPU6050 setup
# =========================

# Wake MPU6050 from sleep mode
i2c.writeto_mem(
    MPU6050_ADDR,
    0x6B,
    b'\x00'
)


def read_word(register):
    data = i2c.readfrom_mem(
        MPU6050_ADDR,
        register,
        2
    )

    value = (data[0] << 8) | data[1]

    if value >= 32768:
        value -= 65536

    return value

def read_temperature():
    raw = thermistor.read_u16()

    if raw <= 0:
        return None

    if raw >= 65535:
        return None

    # Voltage divider:
    resistance = FIXED_RESISTOR * (
        raw / (65535 - raw)
    )

    # Beta equation
    temperature_kelvin = 1 / (
        (1 / THERMISTOR_T0) +
        (1 / THERMISTOR_BETA) *
        math.log(resistance / THERMISTOR_R0)
    )

    temperature_celsius = temperature_kelvin - 273.15
    
    temperature_celsius += TEMPERATURE_OFFSET

    return temperature_celsius

def read_light():
    # Average multiple readings to reduce fluctuations
    total = 0

    for _ in range(LIGHT_SAMPLES):
        total += photoresistor.read_u16()
        time.sleep_ms(2)

    raw = total / LIGHT_SAMPLES

    # Convert ADC reading to approximate voltage
    voltage = (
        raw / LIGHT_ADC_MAX
    ) * LIGHT_ADC_VOLTAGE

    # Convert voltage to relative light intensity.
    # Lower voltage means brighter light for this setup.
    voltage_range = (
        LIGHT_DARK_VOLTAGE - LIGHT_BRIGHT_VOLTAGE
    )

    light_percent = (
        (LIGHT_DARK_VOLTAGE - voltage)
        / voltage_range
    ) * 100

    # Keep the percentage within 0-100%
    light_percent = max(
        0,
        min(100, light_percent)
    )

    return light_percent

def read_mpu6050():

    accel_x = read_word(0x3B)
    accel_y = read_word(0x3D)
    accel_z = read_word(0x3F)

    gyro_x = read_word(0x43)
    gyro_y = read_word(0x45)
    gyro_z = read_word(0x47)

    # Convert accelerometer readings to g
    ax = accel_x / 16384
    ay = accel_y / 16384
    az = accel_z / 16384

    # Convert gyroscope readings to degrees/second
    gx = gyro_x / 131
    gy = gyro_y / 131
    gz = gyro_z / 131

    return ax, ay, az, gx, gy, gz


# =========================
# Telemetry
# =========================
def get_telemetry():
    
    # Turn off the blue LED when its flash expires
    global blue_led_off_at

    if (
        blue_led_off_at is not None
        and time.ticks_diff(
            time.ticks_ms(),
            blue_led_off_at
        ) >= 0
    ):
        blue_led.value(0)
        blue_led_off_at = None
    
    ax, ay, az, gx, gy, gz = read_mpu6050()

    roll = math.degrees(
        math.atan2(ay, az)
    ) - ROLL_OFFSET

    pitch = math.degrees(
        math.atan2(
            -ax,
            math.sqrt(ay * ay + az * az)
        )
    ) - PITCH_OFFSET

    temperature = read_temperature()

    light_percent = read_light()

    # Check for warning conditions
    temperature_warning = (
        temperature is not None
        and temperature > TEMPERATURE_WARNING
    )

    tilt_warning = (
        abs(roll) > TILT_WARNING
        or abs(pitch) > TILT_WARNING
    )

    # Activate red LED if either warning is present
    red_led.value(
        1 if temperature_warning or tilt_warning else 0
    )

    return {
        "accel_x": round(ax, 2),
        "accel_y": round(ay, 2),
        "accel_z": round(az, 2),
        "gyro_x": round(gx, 2),
        "gyro_y": round(gy, 2),
        "gyro_z": round(gz, 2),
        "roll": round(roll, 1),
        "pitch": round(pitch, 1),
        "yaw_rate": round(gz, 1),
        "temperature": (
            round(temperature, 1)
            if temperature is not None
            else None
        ),
        "light": round(light_percent, 1),
        "green_button": not green_button.value(),
        "blue_button": not blue_button.value(),
        "flight_armed": flight_armed,
        "arm_event_count": arm_event_count,
        "marker_count": marker_count,
        "temperature_warning": temperature_warning,
        "tilt_warning": tilt_warning,
    }

# =========================
# Wi-Fi connection
# =========================

wlan = network.WLAN(network.STA_IF)
wlan.active(True)

if not wlan.isconnected():

    wlan.connect(
        SSID,
        PASSWORD
    )

    for _ in range(20):

        if wlan.isconnected():
            break

        time.sleep(0.5)


print("Connected:", wlan.isconnected())
print("IP:", wlan.ifconfig()[0])


# =========================
# Web server
# =========================

addr = socket.getaddrinfo(
    "0.0.0.0",
    8080
)[0][-1]

server = socket.socket()

server.setsockopt(
    socket.SOL_SOCKET,
    socket.SO_REUSEADDR,
    1
)

server.bind(addr)
server.listen(1)

# Prevent a client from hanging forever
server.settimeout(2.0)

print("Web server running.")
print(
    "Open: http://" +
    wlan.ifconfig()[0] +
    ":8080"
)


# =========================
# Request handling
# =========================

while True:

    try:

        # Wait for a browser connection
        try:
            client, address = server.accept()

        except OSError:
            # No connection within timeout
            continue


        print("Client connected:", address)

        try:

            # Give the client a short timeout
            client.settimeout(2.0)

            request = client.recv(1024).decode()

            request_line = request.split("\r\n")[0]

            print(request_line)


            # =========================
            # Telemetry endpoint
            # =========================

            if "GET /data" in request:

                data = get_telemetry()

                body = json.dumps(data)

                content_type = "application/json"


            # =========================
            # CSS
            # =========================

            elif "GET /style.css" in request:

                with open("style.css", "r") as file:
                    body = file.read()

                content_type = "text/css"


            # =========================
            # JavaScript
            # =========================

            elif "GET /script.js" in request:

                with open("script.js", "r") as file:
                    body = file.read()

                content_type = "application/javascript"


            # =========================
            # Main page
            # =========================

            else:

                with open("index.html", "r") as file:
                    body = file.read()

                content_type = "text/html"


            # =========================
            # HTTP response
            # =========================

            body_bytes = body.encode("utf-8")

            header = (
                "HTTP/1.1 200 OK\r\n"
                "Content-Type: " + content_type + "\r\n"
                "Cache-Control: no-store\r\n"
                "Connection: close\r\n"
                "Content-Length: " +
                str(len(body_bytes)) +
                "\r\n"
                "\r\n"
            )

            client.sendall(
                header.encode("utf-8")
            )

            client.sendall(
                body_bytes
            )

            print("Response sent")


        except Exception as e:

            print("Client error:", e)


        finally:

            client.close()


    except Exception as e:

        print("Server error:", e)

        time.sleep(0.1)