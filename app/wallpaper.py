from PIL import Image, ImageDraw, ImageFont
import math
import random

def render_wallpaper(config, wp_type="desktop"):
    sizes = {
        "desktop": (1920, 1080), "lock": (1080, 1920),
        "daily": (1920, 1080), "motivational": (1920, 1080), "weekly": (1920, 1080)
    }
    w, h = sizes.get(wp_type, (1920, 1080))
    theme = config.get("theme", {})
    bg = theme.get("backgroundColor", "#0F172A")
    surface = theme.get("surfaceColor", "#1E293B")
    primary = theme.get("primaryColor", "#7C3AED")
    text_color = theme.get("textColor", "#F8FAFC")
    muted = theme.get("mutedTextColor", "#94A3B8")

    img = Image.new("RGB", (w, h), hex_to_rgb(bg))

    draw = ImageDraw.Draw(img)

    for _ in range(3):
        cx = random.randint(100, w-100)
        cy = random.randint(100, h-100)
        r = random.randint(200, 600)
        color = hex_to_rgb(primary, 0.03)
        draw.ellipse([cx-r, cy-r, cx+r, cy+r], fill=color)

    try:
        font_big = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 72)
        font_large = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 48)
        font_med = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 28)
        font_small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 20)
    except (IOError, OSError):
        font_big = font_large = font_med = font_small = ImageFont.load_default()

    identity = config.get("identity", {})
    zones = config.get("zones", [])
    copy = config.get("copy", {})

    draw.text((60, 50), identity.get("goalName", "Study Plan"), fill=hex_to_rgb(text_color), font=font_big)
    draw.text((60, 130), identity.get("tagline", ""), fill=hex_to_rgb(muted), font=font_small)

    draw.line([(60, 170), (400, 170)], fill=hex_to_rgb(primary, 0.3), width=2)

    y = 210
    card_w = w - 120
    card_h = min(90, (h - y - 80) // max(len(zones), 1))

    for i, zone in enumerate(zones):
        z_color = zone.get("color", primary)
        x = 60

        card_h_actual = card_h
        if i == len(zones) - 1:
            card_h_actual = card_h + 8

        draw.rounded_rectangle(
            [x, y + i * (card_h_actual + 6), x + card_w, y + i * (card_h_actual + 6) + card_h_actual],
            radius=10, fill=hex_to_rgb(surface)
        )
        draw.rounded_rectangle(
            [x, y + i * (card_h_actual + 6), x + 6, y + i * (card_h_actual + 6) + card_h_actual],
            radius=3, fill=hex_to_rgb(z_color)
        )

        status = "● ACTIVE" if i == 0 else ("✓ DONE" if i < 0 else "○ PENDING")
        status_color = z_color if i == 0 else (hex_to_rgb("#00b894") if i < 0 else hex_to_rgb(muted))

        draw.text((x + 24, y + i * (card_h_actual + 6) + 10), zone.get("title", ""), fill=hex_to_rgb(text_color), font=font_large)
        draw.text((x + 24, y + i * (card_h_actual + 6) + 52), zone.get("subtitle", ""), fill=hex_to_rgb(muted), font=font_small)

        focus_str = f"{zone.get('focusDuration', 0)}min × {zone.get('totalCycles', 0)} cycles"
        draw.text((x + card_w - 320, y + i * (card_h_actual + 6) + 14), focus_str, fill=hex_to_rgb(muted), font=font_small)

    bottom_y = h - 60
    msgs = copy.get("motivational", [])
    if msgs:
        msg = msgs[int(random.random() * len(msgs))]
        draw.text((60, bottom_y), f"\"{msg}\"", fill=hex_to_rgb(muted), font=font_small)

    exam = identity.get("examTrack", "ZONE")
    tw, _ = draw.textbbox((0, 0), exam, font=font_small)[2:4]
    draw.text((w - tw - 60, bottom_y), exam, fill=hex_to_rgb(primary), font=font_small)

    draw.text((60, bottom_y + 30), "zone-study-os", fill=hex_to_rgb(muted, 0.4), font=ImageFont.load_default())

    return img

def hex_to_rgb(hex_color, alpha=1.0):
    hex_color = hex_color.lstrip("#")
    r, g, b = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
    if alpha < 1.0:
        return (r, g, b, int(alpha * 255))
    return (r, g, b)
