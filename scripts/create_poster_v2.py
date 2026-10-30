import os
import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance

# -------------------------------------------------------------------------
# DIMENSIONS & SYSTEM FONTS
# -------------------------------------------------------------------------
POSTER_W = 1200
POSTER_H = 1800

FONT_BOLD = 'C:/Windows/Fonts/segoeuib.ttf'
FONT_REGULAR = 'C:/Windows/Fonts/segoeui.ttf'
FONT_IMPACT = 'C:/Windows/Fonts/impact.ttf'
FONT_TREBUCHET = 'C:/Windows/Fonts/trebucbd.ttf'
FONT_ARIAL_BOLD = 'C:/Windows/Fonts/arialbd.ttf'

def get_font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()

# -------------------------------------------------------------------------
# 1. LUXURY CINEMATIC CANVAS & DYNAMIC AMBIENT LIGHTING
# -------------------------------------------------------------------------
canvas = Image.new('RGBA', (POSTER_W, POSTER_H), (8, 6, 5, 255))

# Multiple luminous radial light flares
glow_canvas = Image.new('RGBA', (POSTER_W, POSTER_H), (0, 0, 0, 0))
d_g = ImageDraw.Draw(glow_canvas)

# Top headline fiery explosion glow
d_g.ellipse((150, 120, 1050, 560), fill=(255, 90, 38, 70))
# Center amber stage glow behind food and bike
d_g.ellipse((300, 550, 1100, 1200), fill=(245, 158, 11, 45))
# Scanner zone intense neon backlight (Massive scanner highlight)
d_g.ellipse((100, 1280, 1100, 1750), fill=(255, 90, 38, 75))
d_g.ellipse((120, 1340, 480, 1680), fill=(255, 170, 0, 90))

glow_canvas = glow_canvas.filter(ImageFilter.GaussianBlur(110))
canvas = Image.alpha_composite(canvas, glow_canvas)

# Add luxury geometric ambient grid in the upper and lower areas
grid_layer = Image.new('RGBA', (POSTER_W, POSTER_H), (0, 0, 0, 0))
d_grid = ImageDraw.Draw(grid_layer)
for x in range(0, POSTER_W, 40):
    d_grid.line([(x, 0), (x, 300)], fill=(255, 255, 255, 6), width=1)
for y in range(0, 300, 40):
    d_grid.line([(0, y), (POSTER_W, y)], fill=(255, 255, 255, 6), width=1)
canvas = Image.alpha_composite(canvas, grid_layer)

draw = ImageDraw.Draw(canvas)

# -------------------------------------------------------------------------
# 2. BRAND HEADER: SAVERA PARADISE EMBLEM & LOCATION BADGE
# -------------------------------------------------------------------------
logo_path = 'public/savera-logo.png'
if os.path.exists(logo_path):
    logo = Image.open(logo_path).convert('RGBA').resize((130, 130), Image.Resampling.LANCZOS)
    # Golden ring around logo
    draw.ellipse((58, 48, 192, 182), fill=(255, 90, 38, 60), outline=(245, 158, 11, 200), width=3)
    canvas.paste(logo, (60, 50), logo)

font_brand = get_font(FONT_IMPACT, 52)
font_brand_sub = get_font(FONT_BOLD, 21)
font_loc = get_font(FONT_REGULAR, 19)

draw.text((215, 52), "SAVERA PARADISE", font=font_brand, fill=(255, 255, 255))
draw.text((215, 114), "AUTHENTIC MULTI-CUISINE DINING • RAMANAGARA", font=font_brand_sub, fill=(255, 154, 46))
draw.text((215, 144), "AGA Building, Railway Station Main Road, Ramanagara — 562159", font=font_loc, fill=(203, 213, 225))

# Header Launch Pill (Right side)
pill_x, pill_y, pill_w, pill_h = 820, 68, 320, 62
draw.rounded_rectangle((pill_x, pill_y, pill_x + pill_w, pill_y + pill_h), radius=31, fill=(255, 90, 38, 45), outline=(255, 120, 60, 220), width=2)
draw.text((pill_x + 24, pill_y + 17), "🛵 NOW DELIVERING!", font=get_font(FONT_BOLD, 22), fill=(255, 255, 255))

# Golden dividing beam
draw.line([(60, 200), (1140, 200)], fill=(245, 158, 11, 120), width=2)

# -------------------------------------------------------------------------
# 3. PUNCHY, JAW-DROPPING HEADLINE
# -------------------------------------------------------------------------
# Eyebrow tag
draw.rounded_rectangle((60, 220, 480, 258), radius=8, fill=(245, 158, 11, 35), outline=(245, 158, 11, 150), width=1)
draw.text((75, 226), "★ RAMANAGARA'S FAVORITE RESTAURANT", font=get_font(FONT_BOLD, 18), fill=(250, 204, 21))

# Main 3D Text
font_main_1 = get_font(FONT_IMPACT, 76)
font_main_2 = get_font(FONT_IMPACT, 96)

# Row 1: "WE ARE NOW DELIVERING"
draw.text((64, 274), "WE ARE NOW DELIVERING", font=font_main_1, fill=(0, 0, 0, 220))
draw.text((60, 270), "WE ARE NOW DELIVERING", font=font_main_1, fill=(255, 255, 255))

# Row 2: "TO YOUR DOORSTEP!" in explosive gradient colors
draw.text((64, 360), "TO YOUR DOORSTEP!", font=font_main_2, fill=(160, 30, 0, 240))
draw.text((60, 356), "TO YOUR DOORSTEP!", font=font_main_2, fill=(255, 90, 38))

font_lead = get_font(FONT_REGULAR, 25)
draw.text((60, 472), "Hot Dum Biryani • Sizzling Crispy Chicken • Charcoal Kebabs & Curries", font=get_font(FONT_BOLD, 24), fill=(255, 175, 75))
draw.text((60, 508), "Delivered sizzling hot directly to your home or office in 20–30 minutes!", font=font_lead, fill=(226, 232, 240))

# -------------------------------------------------------------------------
# 4. VISUAL CENTERPIECE: FAST DELIVERY BIKE + PHONE APP DISPLAY + SIZZLING DISHES
# -------------------------------------------------------------------------
# A. Modern 3D Electric Delivery Scooter (Right side)
scooter_path = 'public/images/delivery-bike.jpg'
if os.path.exists(scooter_path):
    scooter = Image.open(scooter_path).convert('RGBA').resize((580, 580), Image.Resampling.LANCZOS)
    
    # Smooth radial feathered mask so scooter blends seamlessly into dark canvas
    scooter_mask = Image.new('L', (580, 580), 255)
    d_sm = ImageDraw.Draw(scooter_mask)
    for i in range(45):
        alpha = int((i / 45) * 255)
        d_sm.rectangle((i, i, 580 - i, 580 - i), outline=alpha, width=1)
    scooter.putalpha(scooter_mask)
    canvas.paste(scooter, (580, 560), scooter)

# B. Ultra-Realistic Smartphone App Mockup (Left side)
phone_w, phone_h = 360, 700
phone_x, phone_y = 100, 560

# Heavy ambient drop-shadow behind phone
shadow = Image.new('RGBA', (phone_w + 70, phone_h + 70), (0, 0, 0, 0))
d_sh = ImageDraw.Draw(shadow)
d_sh.rounded_rectangle((35, 35, phone_w + 35, phone_h + 35), radius=50, fill=(0, 0, 0, 180))
shadow = shadow.filter(ImageFilter.GaussianBlur(30))
canvas.paste(shadow, (phone_x - 35, phone_y - 25), shadow)

# Phone body
phone_img = Image.new('RGBA', (phone_w, phone_h), (0, 0, 0, 0))
d_p = ImageDraw.Draw(phone_img)

# Outer titanium bezel
d_p.rounded_rectangle((0, 0, phone_w, phone_h), radius=46, fill=(30, 25, 22, 255), outline=(100, 80, 68, 255), width=4)
# Screen boundary
d_p.rounded_rectangle((8, 8, phone_w - 8, phone_h - 8), radius=40, fill=(14, 12, 10, 255))

# Top Dynamic Island
d_p.rounded_rectangle((125, 18, 235, 42), radius=12, fill=(0, 0, 0, 255))
d_p.text((32, 22), "12:45", font=get_font(FONT_BOLD, 13), fill=(255, 255, 255))
d_p.text((phone_w - 75, 22), "5G  100%", font=get_font(FONT_BOLD, 13), fill=(255, 255, 255))

# App Header
app_y = 52
d_p.rounded_rectangle((18, app_y, phone_w - 18, app_y + 54), radius=14, fill=(28, 23, 19, 255), outline=(55, 45, 36, 255), width=1)
if os.path.exists(logo_path):
    app_mini_logo = Image.open(logo_path).convert('RGBA').resize((38, 38), Image.Resampling.LANCZOS)
    phone_img.paste(app_mini_logo, (26, app_y + 8), app_mini_logo)

d_p.text((72, app_y + 9), "Savera Paradise", font=get_font(FONT_BOLD, 16), fill=(255, 255, 255))
d_p.text((72, app_y + 30), "📍 Ramanagara • 15–20 Mins", font=get_font(FONT_BOLD, 12), fill=(255, 90, 38))

# Search bar
srch_y = app_y + 64
d_p.rounded_rectangle((18, srch_y, phone_w - 18, srch_y + 36), radius=10, fill=(22, 18, 15, 255), outline=(60, 48, 38, 255), width=1)
d_p.text((30, srch_y + 9), "🔍  Search Dum Biryani, Chicken, Kebabs...", font=get_font(FONT_REGULAR, 12), fill=(148, 163, 184))

# Categories
cat_y = srch_y + 44
categories = ["🔥 Best Sellers", "🍚 Biryani", "🍗 Chicken", "🍢 Tandoori"]
cur_x = 18
for i, c in enumerate(categories):
    bg_c = (255, 90, 38, 255) if i == 0 else (32, 26, 21, 255)
    d_p.rounded_rectangle((cur_x, cat_y, cur_x + 72, cat_y + 26), radius=13, fill=bg_c)
    d_p.text((cur_x + 9, cat_y + 5), c[:9], font=get_font(FONT_BOLD, 11), fill=(255, 255, 255) if i == 0 else (203, 213, 225))
    cur_x += 78

# Dish Card 1: Dum Biryani
card1_y = cat_y + 38
d_p.rounded_rectangle((18, card1_y, phone_w - 18, card1_y + 112), radius=16, fill=(26, 21, 17, 255), outline=(58, 46, 36, 255), width=1)
biryani_cutout = 'public/images/intro/plate-biryani.webp'
if os.path.exists(biryani_cutout):
    b_thumb = Image.open(biryani_cutout).convert('RGBA').resize((92, 92), Image.Resampling.LANCZOS)
    phone_img.paste(b_thumb, (26, card1_y + 10), b_thumb)

d_p.text((125, card1_y + 14), "Special Dum Biryani", font=get_font(FONT_BOLD, 14), fill=(255, 255, 255))
d_p.text((125, card1_y + 34), "★ 4.9 (840+) • Chef Special", font=get_font(FONT_BOLD, 11), fill=(245, 158, 11))
d_p.text((125, card1_y + 54), "Tender meat, fragrant saffron rice", font=get_font(FONT_REGULAR, 11), fill=(148, 163, 184))
d_p.text((125, card1_y + 78), "₹220", font=get_font(FONT_IMPACT, 18), fill=(255, 90, 38))
# Add Button
d_p.rounded_rectangle((phone_w - 85, card1_y + 72, phone_w - 26, card1_y + 102), radius=8, fill=(255, 90, 38, 255))
d_p.text((phone_w - 72, card1_y + 78), "+ ADD", font=get_font(FONT_BOLD, 12), fill=(255, 255, 255))

# Dish Card 2: Crispy Chicken & Kebab
card2_y = card1_y + 122
d_p.rounded_rectangle((18, card2_y, phone_w - 18, card2_y + 112), radius=16, fill=(26, 21, 17, 255), outline=(58, 46, 36, 255), width=1)
kebab_cutout = 'public/images/intro/plate-kebab.webp'
if os.path.exists(kebab_cutout):
    k_thumb = Image.open(kebab_cutout).convert('RGBA').resize((92, 92), Image.Resampling.LANCZOS)
    phone_img.paste(k_thumb, (26, card2_y + 10), k_thumb)

d_p.text((125, card2_y + 14), "Special Kebab Platter", font=get_font(FONT_BOLD, 14), fill=(255, 255, 255))
d_p.text((125, card2_y + 34), "★ 4.8 (620+) • Hot & Crispy", font=get_font(FONT_BOLD, 11), fill=(245, 158, 11))
d_p.text((125, card2_y + 54), "Seekh, Malai Tikka & Galouti", font=get_font(FONT_REGULAR, 11), fill=(148, 163, 184))
d_p.text((125, card2_y + 78), "₹240", font=get_font(FONT_IMPACT, 18), fill=(255, 90, 38))
d_p.rounded_rectangle((phone_w - 85, card2_y + 72, phone_w - 26, card2_y + 102), radius=8, fill=(255, 90, 38, 255))
d_p.text((phone_w - 72, card2_y + 78), "+ ADD", font=get_font(FONT_BOLD, 12), fill=(255, 255, 255))

# Live Rider Tracking Pill
track_y = card2_y + 122
d_p.rounded_rectangle((18, track_y, phone_w - 18, track_y + 54), radius=14, fill=(16, 185, 129, 35), outline=(16, 185, 129, 220), width=2)
d_p.text((30, track_y + 8), "🛵 Rider Assigned & En Route", font=get_font(FONT_BOLD, 13), fill=(16, 185, 129))
d_p.text((30, track_y + 28), "Live GPS: 15 Mins Away to Doorstep", font=get_font(FONT_REGULAR, 11), fill=(203, 213, 225))

canvas.paste(phone_img, (phone_x, phone_y), phone_img)

# Large Foreground Food Platter Overlapping with realistic shadow
if os.path.exists(biryani_cutout):
    hero_dish = Image.open(biryani_cutout).convert('RGBA').resize((310, 235), Image.Resampling.LANCZOS)
    dish_sh = Image.new('RGBA', (340, 260), (0, 0, 0, 0))
    d_dsh = ImageDraw.Draw(dish_sh)
    d_dsh.ellipse((20, 20, 320, 240), fill=(0, 0, 0, 180))
    dish_sh = dish_sh.filter(ImageFilter.GaussianBlur(22))
    canvas.paste(dish_sh, (390, 1020), dish_sh)
    canvas.paste(hero_dish, (405, 1030), hero_dish)

# -------------------------------------------------------------------------
# 5. SPECIAL OFFERS STRIP (GLOWING METALLIC ACCENT)
# -------------------------------------------------------------------------
strip_y = 1280
draw.rounded_rectangle((60, strip_y, 1140, strip_y + 88), radius=20, fill=(24, 18, 14, 255), outline=(255, 90, 38, 160), width=2)

draw.text((85, strip_y + 14), "🎁 FLAT ₹50 OFF", font=get_font(FONT_IMPACT, 30), fill=(255, 90, 38))
draw.text((85, strip_y + 50), "Use Coupon: FIRSTORDER", font=get_font(FONT_BOLD, 16), fill=(241, 245, 249))

draw.line([(440, strip_y + 15), (440, strip_y + 73)], fill=(60, 48, 38, 255), width=2)

draw.text((465, strip_y + 14), "⚡ 20–30 MINS EXPRESS", font=get_font(FONT_IMPACT, 30), fill=(245, 158, 11))
draw.text((465, strip_y + 50), "100% Sizzling Hot & Fresh", font=get_font(FONT_BOLD, 16), fill=(241, 245, 249))

draw.line([(820, strip_y + 15), (820, strip_y + 73)], fill=(60, 48, 38, 255), width=2)

draw.text((845, strip_y + 14), "🛵 FREE DELIVERY", font=get_font(FONT_IMPACT, 30), fill=(16, 185, 129))
draw.text((845, strip_y + 50), "On All Orders Above ₹249", font=get_font(FONT_BOLD, 16), fill=(241, 245, 249))

# -------------------------------------------------------------------------
# 6. HEAVILY HIGHLIGHTED HERO SCANNER POD (THE MAIN REQUEST)
# -------------------------------------------------------------------------
pod_y = 1390
pod_h = 275

# A. Glowing Scanner Pod Frame with Fiery Golden Double Outline
draw.rounded_rectangle((60, pod_y, 1140, pod_y + pod_h), radius=28, fill=(18, 14, 11, 255), outline=(255, 90, 38, 255), width=3)
draw.rounded_rectangle((64, pod_y + 4, 1136, pod_y + pod_h - 4), radius=24, outline=(245, 158, 11, 180), width=1)

# B. Prominent Glowing QR Scanner Stage
qr_x, qr_y, qr_s = 95, pod_y + 25, 225

# Brilliant pure white pedestal behind QR
draw.rounded_rectangle((qr_x, qr_y, qr_x + qr_s, qr_y + qr_s), radius=22, fill=(255, 255, 255, 255))

# Viewfinder Camera Reticle Corners around the QR code (Neon Orange Targeting HUD)
ret_len = 32
ret_thick = 5
ret_pad = 8
rx1, ry1 = qr_x - ret_pad, qr_y - ret_pad
rx2, ry2 = qr_x + qr_s + ret_pad, qr_y + qr_s + ret_pad
ret_color = (255, 90, 38, 255)

# Top-Left Corner
draw.line([(rx1, ry1), (rx1 + ret_len, ry1)], fill=ret_color, width=ret_thick)
draw.line([(rx1, ry1), (rx1, ry1 + ret_len)], fill=ret_color, width=ret_thick)
# Top-Right Corner
draw.line([(rx2, ry1), (rx2 - ret_len, ry1)], fill=ret_color, width=ret_thick)
draw.line([(rx2, ry1), (rx2, ry1 + ret_len)], fill=ret_color, width=ret_thick)
# Bottom-Left Corner
draw.line([(rx1, ry2), (rx1 + ret_len, ry2)], fill=ret_color, width=ret_thick)
draw.line([(rx1, ry2), (rx1, ry2 - ret_len)], fill=ret_color, width=ret_thick)
# Bottom-Right Corner
draw.line([(rx2, ry2), (rx2 - ret_len, ry2)], fill=ret_color, width=ret_thick)
draw.line([(rx2, ry2), (rx2, ry2 - ret_len)], fill=ret_color, width=ret_thick)

# Paste the permanent scannable QR Code
qr_path = 'public/savera-paradise-qr.png'
if os.path.exists(qr_path):
    qr_img = Image.open(qr_path).convert('RGBA').resize((qr_s - 26, qr_s - 26), Image.Resampling.LANCZOS)
    canvas.paste(qr_img, (qr_x + 13, qr_y + 13), qr_img)

# Luminous Horizontal Scan Laser Line cutting across QR
laser_y = qr_y + qr_s // 2
draw.line([(qr_x + 8, laser_y), (qr_x + qr_s - 8, laser_y)], fill=(255, 90, 38, 200), width=3)
draw.line([(qr_x + 8, laser_y), (qr_x + qr_s - 8, laser_y)], fill=(255, 255, 255, 230), width=1)

# C. Hero Scanner Callout Column (Right of QR)
# Prominent Attention Badge
draw.rounded_rectangle((355, pod_y + 25, 680, pod_y + 65), radius=20, fill=(255, 90, 38, 255))
draw.text((375, pod_y + 32), "📷 POINT CAMERA TO ORDER", font=get_font(FONT_IMPACT, 22), fill=(255, 255, 255))

draw.text((355, pod_y + 75), "SCAN & ORDER IN 30 SECONDS", font=get_font(FONT_IMPACT, 42), fill=(255, 255, 255))
draw.text((355, pod_y + 125), "Open your phone camera or Google Lens to view full menu live.", font=get_font(FONT_BOLD, 21), fill=(245, 158, 11))
draw.text((355, pod_y + 154), "✓ No App Store Download Needed  •  Opens Instantly in Browser!", font=get_font(FONT_REGULAR, 19), fill=(203, 213, 225))

# Website Domain Box (Luminous Pill)
draw.rounded_rectangle((355, pod_y + 188, 860, pod_y + 246), radius=14, fill=(10, 8, 6, 255), outline=(255, 90, 38, 200), width=2)
draw.text((375, pod_y + 196), "🌐 saveraparadise.foodbliz.in", font=get_font(FONT_IMPACT, 34), fill=(255, 90, 38))

# Scan Steps Badge Box (Far Right)
draw.rounded_rectangle((880, pod_y + 25, 1115, pod_y + 246), radius=20, fill=(26, 20, 16, 255), outline=(245, 158, 11, 140), width=2)
draw.text((905, pod_y + 40), "HOW TO ORDER:", font=get_font(FONT_IMPACT, 22), fill=(250, 204, 21))

steps = [
    ("1️⃣ Open Camera", "Point at QR code"),
    ("2️⃣ Tap Link", "Opens live menu"),
    ("3️⃣ Enjoy Feast!", "Delivered to door")
]
sy = pod_y + 75
for s_title, s_sub in steps:
    draw.text((900, sy), s_title, font=get_font(FONT_BOLD, 17), fill=(255, 255, 255))
    draw.text((900, sy + 21), s_sub, font=get_font(FONT_REGULAR, 14), fill=(148, 163, 184))
    sy += 48

# -------------------------------------------------------------------------
# 7. FOOTER: VERIFIED RESTAURANT ADDRESS & PHONE HELPLINES
# -------------------------------------------------------------------------
foot_y = 1690
draw.line([(60, foot_y), (1140, foot_y)], fill=(60, 48, 38, 255), width=1)

draw.text((60, foot_y + 18), "📍 Savera Paradise Multi-Cuisine Restaurant", font=get_font(FONT_BOLD, 22), fill=(255, 255, 255))
draw.text((60, foot_y + 48), "AGA Building, Railway Station Main Road, Ramanagara, Karnataka — 562159", font=get_font(FONT_REGULAR, 19), fill=(203, 213, 225))

draw.text((740, foot_y + 18), "📞 Helpline: +91 9742924237 • 080-27271234", font=get_font(FONT_BOLD, 20), fill=(255, 120, 60))
draw.text((740, foot_y + 48), "⏰ Open Daily: 11:30 AM – 11:30 PM  •  UPI / Cards / COD", font=get_font(FONT_REGULAR, 18), fill=(250, 204, 21))

# -------------------------------------------------------------------------
# SAVE COMPLETED POSTER
# -------------------------------------------------------------------------
output_png = 'public/images/doorstep_delivery_poster.png'
output_jpg = 'public/images/doorstep_delivery_poster.jpg'
output_v2_png = 'public/images/doorstep_delivery_poster_v2.png'
output_v2_jpg = 'public/images/doorstep_delivery_poster_v2.jpg'

# Save both as primary and as v2
canvas.save(output_png, format='PNG', optimize=True)
canvas.save(output_v2_png, format='PNG', optimize=True)

canvas_rgb = canvas.convert('RGB')
canvas_rgb.save(output_jpg, format='JPEG', quality=95)
canvas_rgb.save(output_v2_jpg, format='JPEG', quality=95)

# Also copy to conversation artifact directory for instant viewing
artifact_dir = 'C:/Users/DELL/.gemini/antigravity/brain/5f2d5f57-08fe-483b-882e-82c561f61269'
if os.path.exists(artifact_dir):
    canvas.save(os.path.join(artifact_dir, 'doorstep_delivery_poster.png'), format='PNG')
    canvas.save(os.path.join(artifact_dir, 'doorstep_delivery_poster_v2.png'), format='PNG')

print("[OK] Successfully generated highlighted scanner poster v2:")
print(f"  - {output_png}")
print(f"  - {output_jpg}")
print(f"  - {output_v2_png}")
