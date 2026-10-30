import os
import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance

# -------------------------------------------------------------------------
# CONSTANTS & ASSETS
# -------------------------------------------------------------------------
POSTER_W = 1200
POSTER_H = 1800

FONT_BOLD = 'C:/Windows/Fonts/segoeuib.ttf'
FONT_REGULAR = 'C:/Windows/Fonts/segoeui.ttf'
FONT_IMPACT = 'C:/Windows/Fonts/impact.ttf'
FONT_TREBUCHET = 'C:/Windows/Fonts/trebucbd.ttf'

def get_font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()

# -------------------------------------------------------------------------
# 1. CANVAS & BACKGROUND WITH LUXURY FIERY GLOWS
# -------------------------------------------------------------------------
canvas = Image.new('RGBA', (POSTER_W, POSTER_H), (12, 10, 8, 255))

# Create multiple radial gradient lighting layers
glow_layer = Image.new('RGBA', (POSTER_W, POSTER_H), (0, 0, 0, 0))
d_glow = ImageDraw.Draw(glow_layer)

# Top fiery glow behind headline
d_glow.ellipse((100, 100, 1100, 650), fill=(255, 90, 38, 55))
# Middle right glow behind delivery scooter
d_glow.ellipse((500, 600, 1250, 1350), fill=(255, 140, 0, 45))
# Bottom left glow behind QR and food
d_glow.ellipse((-100, 1100, 700, 1750), fill=(16, 185, 129, 30))
# Center warm golden burst
d_glow.ellipse((350, 400, 850, 900), fill=(245, 158, 11, 40))

glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(120))
canvas = Image.alpha_composite(canvas, glow_layer)

# Add subtle honeycomb / technical geometric pattern lines in header & footer
pattern_layer = Image.new('RGBA', (POSTER_W, POSTER_H), (0, 0, 0, 0))
d_pat = ImageDraw.Draw(pattern_layer)
for y in range(0, 350, 24):
    d_pat.line([(0, y), (POSTER_W, y + 100)], fill=(255, 255, 255, 8), width=1)
for y in range(POSTER_H - 250, POSTER_H, 20):
    d_pat.line([(0, y), (POSTER_W, y - 80)], fill=(255, 90, 38, 12), width=1)
canvas = Image.alpha_composite(canvas, pattern_layer)

draw = ImageDraw.Draw(canvas)

# -------------------------------------------------------------------------
# 2. BRAND HEADER: LOGO BADGE + LOCATION CHIPS
# -------------------------------------------------------------------------
# Logo
logo_path = 'public/savera-logo.png'
if os.path.exists(logo_path):
    logo = Image.open(logo_path).convert('RGBA')
    logo = logo.resize((130, 130), Image.Resampling.LANCZOS)
    canvas.paste(logo, (60, 50), logo)

# Brand Title & Location Tag
font_brand = get_font(FONT_TREBUCHET, 46)
font_sub = get_font(FONT_BOLD, 22)
font_loc = get_font(FONT_REGULAR, 20)

draw.text((210, 54), "SAVERA PARADISE", font=font_brand, fill=(255, 255, 255))
draw.text((210, 112), "AUTHENTIC MULTI-CUISINE RESTAURANT", font=font_sub, fill=(255, 154, 46))
draw.text((210, 142), "Railway Station Main Road, Ramanagara • PIN 562159", font=font_loc, fill=(203, 213, 225))

# Top-Right Badge: "OFFICIAL ONLINE LAUNCH"
badge_x, badge_y, badge_w, badge_h = 860, 65, 280, 58
draw.rounded_rectangle((badge_x, badge_y, badge_x + badge_w, badge_y + badge_h), radius=29, fill=(255, 90, 38, 40), outline=(255, 90, 38, 180), width=2)
font_badge = get_font(FONT_BOLD, 19)
draw.text((badge_x + 22, badge_y + 17), "🛵 DOORSTEP LAUNCH", font=font_badge, fill=(255, 122, 69))

# Dividing stylish gradient separator
draw.line([(60, 205), (1140, 205)], fill=(255, 90, 38, 90), width=2)

# -------------------------------------------------------------------------
# 3. HIGH-IMPACT HEADLINE: "NOW DELIVERING TO YOUR DOORSTEP!"
# -------------------------------------------------------------------------
font_tag = get_font(FONT_BOLD, 26)
draw.text((60, 225), "RAMANAGARA, WE'VE GOT SIZZLING NEWS!", font=font_tag, fill=(250, 204, 21))

font_hero = get_font(FONT_IMPACT, 82)
# Shadow for 3D effect
draw.text((64, 274), "NOW DELIVERING TO", font=font_hero, fill=(0, 0, 0, 220))
draw.text((60, 270), "NOW DELIVERING TO", font=font_hero, fill=(255, 255, 255))

draw.text((64, 364), "YOUR DOORSTEP!", font=font_hero, fill=(180, 40, 0, 240))
draw.text((60, 360), "YOUR DOORSTEP!", font=font_hero, fill=(255, 90, 38))

font_lead = get_font(FONT_REGULAR, 26)
draw.text((60, 465), "Craving Hot Dum Biryani, Crispy Chicken & Tandoori Specials?", font=font_lead, fill=(241, 245, 249))
draw.text((60, 502), "Order direct in seconds — delivered steaming hot to your home or office!", font=font_lead, fill=(203, 213, 225))

# -------------------------------------------------------------------------
# 4. CENTERPIECE: DELIVERY SCOOTER & SMARTPHONE APP MOCKUP
# -------------------------------------------------------------------------
# A. Delivery Scooter Image (right side)
scooter_path = 'public/images/delivery-bike.jpg'
if os.path.exists(scooter_path):
    scooter = Image.open(scooter_path).convert('RGBA')
    # Resize to fit nicely on the right
    scooter = scooter.resize((560, 560), Image.Resampling.LANCZOS)
    
    # Soft vignette mask around the scooter so it merges into canvas
    scooter_mask = Image.new('L', (560, 560), 255)
    d_sm = ImageDraw.Draw(scooter_mask)
    # Fade edges
    for i in range(40):
        alpha = int((i / 40) * 255)
        d_sm.rectangle((i, i, 560 - i, 560 - i), outline=alpha, width=1)
    scooter.putalpha(scooter_mask)
    
    # Paste scooter
    canvas.paste(scooter, (600, 560), scooter)

# B. Realistic Smartphone App Mockup (left-center)
phone_w, phone_h = 360, 710
phone_x, phone_y = 120, 560

# Phone Drop Shadow
shadow = Image.new('RGBA', (phone_w + 60, phone_h + 60), (0, 0, 0, 0))
d_sh = ImageDraw.Draw(shadow)
d_sh.rounded_rectangle((30, 30, phone_w + 30, phone_h + 30), radius=48, fill=(0, 0, 0, 160))
shadow = shadow.filter(ImageFilter.GaussianBlur(25))
canvas.paste(shadow, (phone_x - 30, phone_y - 20), shadow)

# Phone Chassis & Screen
phone_canvas = Image.new('RGBA', (phone_w, phone_h), (0, 0, 0, 0))
d_phone = ImageDraw.Draw(phone_canvas)

# Titanium Outer Rim
d_phone.rounded_rectangle((0, 0, phone_w, phone_h), radius=48, fill=(35, 30, 26, 255), outline=(90, 75, 65, 255), width=4)
# Inner Bezel & Screen
screen_inset = 9
d_phone.rounded_rectangle((screen_inset, screen_inset, phone_w - screen_inset, phone_h - screen_inset), radius=40, fill=(14, 12, 10, 255))

# Top Speaker & Dynamic Island
island_w, island_h = 110, 24
d_phone.rounded_rectangle(((phone_w - island_w)//2, screen_inset + 10, (phone_w + island_w)//2, screen_inset + 10 + island_h), radius=12, fill=(0, 0, 0, 255))

# App Status Bar
font_status = get_font(FONT_BOLD, 13)
d_phone.text((screen_inset + 24, screen_inset + 14), "12:45", font=font_status, fill=(255, 255, 255))
d_phone.text((phone_w - screen_inset - 68, screen_inset + 14), "5G  100%", font=font_status, fill=(255, 255, 255))

# App Navbar (Savera Paradise brand header)
nav_y = screen_inset + 46
d_phone.rounded_rectangle((screen_inset + 12, nav_y, phone_w - screen_inset - 12, nav_y + 54), radius=14, fill=(25, 22, 18, 255), outline=(45, 38, 30, 255), width=1)
if os.path.exists(logo_path):
    mini_logo = Image.open(logo_path).convert('RGBA').resize((36, 36), Image.Resampling.LANCZOS)
    phone_canvas.paste(mini_logo, (screen_inset + 22, nav_y + 9), mini_logo)

font_app_title = get_font(FONT_BOLD, 16)
font_app_sub = get_font(FONT_REGULAR, 12)
d_phone.text((screen_inset + 68, nav_y + 10), "Savera Paradise", font=font_app_title, fill=(255, 255, 255))
d_phone.text((screen_inset + 68, nav_y + 29), "📍 Ramanagara • 20 Mins", font=font_app_sub, fill=(255, 90, 38))

# Search Bar
search_y = nav_y + 64
d_phone.rounded_rectangle((screen_inset + 12, search_y, phone_w - screen_inset - 12, search_y + 36), radius=10, fill=(20, 18, 15, 255), outline=(55, 45, 35, 255), width=1)
font_search = get_font(FONT_REGULAR, 12)
d_phone.text((screen_inset + 24, search_y + 9), "🔍  Search Biryani, Crispy Chicken...", font=font_search, fill=(148, 163, 184))

# Category Chips
chip_y = search_y + 46
chips = ["🔥 All", "🍚 Biryani", "🍗 Chicken", "🍢 Tandoori"]
cx = screen_inset + 12
for idx, chip in enumerate(chips):
    c_w = 72
    bg_col = (255, 90, 38, 255) if idx == 0 else (28, 24, 20, 255)
    border_col = (255, 90, 38, 255) if idx == 0 else (55, 45, 35, 255)
    d_phone.rounded_rectangle((cx, chip_y, cx + c_w, chip_y + 28), radius=14, fill=bg_col, outline=border_col, width=1)
    f_chip = get_font(FONT_BOLD if idx == 0 else FONT_REGULAR, 11)
    d_phone.text((cx + 10, chip_y + 6), chip, font=f_chip, fill=(255, 255, 255) if idx == 0 else (203, 213, 225))
    cx += c_w + 6

# Featured Dish Cards inside phone app screen
card_y = chip_y + 40
# Card 1: Dum Biryani
d_phone.rounded_rectangle((screen_inset + 12, card_y, phone_w - screen_inset - 12, card_y + 115), radius=16, fill=(25, 21, 17, 255), outline=(50, 42, 32, 255), width=1)
# Small Biryani image thumb
biryani_thumb_path = 'public/images/intro/plate-biryani.webp'
if os.path.exists(biryani_thumb_path):
    thumb = Image.open(biryani_thumb_path).convert('RGBA').resize((95, 95), Image.Resampling.LANCZOS)
    phone_canvas.paste(thumb, (screen_inset + 20, card_y + 10), thumb)

font_dish_name = get_font(FONT_BOLD, 14)
font_dish_price = get_font(FONT_BOLD, 16)
font_dish_desc = get_font(FONT_REGULAR, 11)

d_phone.text((screen_inset + 125, card_y + 14), "Special Dum Biryani", font=font_dish_name, fill=(255, 255, 255))
d_phone.text((screen_inset + 125, card_y + 34), "★ 4.9 (840+) • Chef Special", font=font_dish_desc, fill=(245, 158, 11))
d_phone.text((screen_inset + 125, card_y + 54), "Tender meat, fragrant saffron rice", font=font_dish_desc, fill=(148, 163, 184))
d_phone.text((screen_inset + 125, card_y + 80), "₹220", font=font_dish_price, fill=(255, 90, 38))

# "+ ADD" button
d_phone.rounded_rectangle((phone_w - screen_inset - 90, card_y + 74, phone_w - screen_inset - 22, card_y + 104), radius=8, fill=(255, 90, 38, 255))
d_phone.text((phone_w - screen_inset - 76, card_y + 79), "+ ADD", font=get_font(FONT_BOLD, 12), fill=(255, 255, 255))

# Card 2: Crispy Chicken / Kebab
card2_y = card_y + 126
d_phone.rounded_rectangle((screen_inset + 12, card2_y, phone_w - screen_inset - 12, card2_y + 115), radius=16, fill=(25, 21, 17, 255), outline=(50, 42, 32, 255), width=1)
kebab_thumb_path = 'public/images/intro/plate-kebab.webp'
if os.path.exists(kebab_thumb_path):
    thumb2 = Image.open(kebab_thumb_path).convert('RGBA').resize((95, 95), Image.Resampling.LANCZOS)
    phone_canvas.paste(thumb2, (screen_inset + 20, card2_y + 10), thumb2)

d_phone.text((screen_inset + 125, card2_y + 14), "Crispy Chicken & Kebab", font=font_dish_name, fill=(255, 255, 255))
d_phone.text((screen_inset + 125, card2_y + 34), "★ 4.8 (620+) • Hot & Sizzling", font=font_dish_desc, fill=(245, 158, 11))
d_phone.text((screen_inset + 125, card2_y + 54), "Double dredged, spiced marinade", font=font_dish_desc, fill=(148, 163, 184))
d_phone.text((screen_inset + 125, card2_y + 80), "₹240", font=font_dish_price, fill=(255, 90, 38))
d_phone.rounded_rectangle((phone_w - screen_inset - 90, card2_y + 74, phone_w - screen_inset - 22, card2_y + 104), radius=8, fill=(255, 90, 38, 255))
d_phone.text((phone_w - screen_inset - 76, card2_y + 79), "+ ADD", font=get_font(FONT_BOLD, 12), fill=(255, 255, 255))

# Floating Realtime Order Tracker Pill at bottom of screen
track_y = card2_y + 126
d_phone.rounded_rectangle((screen_inset + 12, track_y, phone_w - screen_inset - 12, track_y + 56), radius=16, fill=(16, 185, 129, 30), outline=(16, 185, 129, 200), width=2)
d_phone.text((screen_inset + 24, track_y + 10), "🛵 Rider Assigned & En Route", font=get_font(FONT_BOLD, 13), fill=(16, 185, 129))
d_phone.text((screen_inset + 24, track_y + 30), "Live GPS: Arriving in 18 mins to doorstep", font=get_font(FONT_REGULAR, 11), fill=(203, 213, 225))

# Paste finished phone onto canvas
canvas.paste(phone_canvas, (phone_x, phone_y), phone_canvas)

# Large Floating Food Platter overlaying bottom-right for mouth-watering appeal
if os.path.exists(kebab_thumb_path):
    hero_plate = Image.open(kebab_thumb_path).convert('RGBA').resize((270, 270), Image.Resampling.LANCZOS)
    # Add shadow
    plate_shadow = Image.new('RGBA', (300, 300), (0, 0, 0, 0))
    d_psh = ImageDraw.Draw(plate_shadow)
    d_psh.ellipse((20, 20, 280, 280), fill=(0, 0, 0, 160))
    plate_shadow = plate_shadow.filter(ImageFilter.GaussianBlur(18))
    canvas.paste(plate_shadow, (420, 990), plate_shadow)
    canvas.paste(hero_plate, (435, 1000), hero_plate)

# -------------------------------------------------------------------------
# 5. SPECIAL OFFERS & SPEED BADGES STRIP
# -------------------------------------------------------------------------
strip_y = 1290
draw.rounded_rectangle((60, strip_y, 1140, strip_y + 105), radius=22, fill=(20, 17, 14, 255), outline=(255, 90, 38, 120), width=2)

# Col 1: FLAT ₹50 OFF
draw.text((90, strip_y + 18), "🎉 FLAT ₹50 OFF", font=get_font(FONT_IMPACT, 32), fill=(255, 90, 38))
draw.text((90, strip_y + 60), "Use Code: FIRSTORDER on 1st Order", font=get_font(FONT_BOLD, 17), fill=(241, 245, 249))

draw.line([(450, strip_y + 20), (450, strip_y + 85)], fill=(55, 45, 35, 255), width=2)

# Col 2: SPEED GUARANTEE
draw.text((480, strip_y + 18), "⚡ 20–30 MINS EXPRESS", font=get_font(FONT_IMPACT, 32), fill=(245, 158, 11))
draw.text((480, strip_y + 60), "100% Hot & Fresh Insulated Bag Delivery", font=get_font(FONT_BOLD, 17), fill=(241, 245, 249))

draw.line([(830, strip_y + 20), (830, strip_y + 85)], fill=(55, 45, 35, 255), width=2)

# Col 3: FREE DELIVERY
draw.text((860, strip_y + 18), "🛵 FREE DELIVERY", font=get_font(FONT_IMPACT, 32), fill=(16, 185, 129))
draw.text((860, strip_y + 60), "On All Orders Above ₹249", font=get_font(FONT_BOLD, 17), fill=(241, 245, 249))

# -------------------------------------------------------------------------
# 6. PERMANENT WORKING QR CODE & SCAN INSTRUCTIONS
# -------------------------------------------------------------------------
qr_box_y = 1420
qr_box_h = 240

# Outer glowing card for QR section
draw.rounded_rectangle((60, qr_box_y, 1140, qr_box_y + qr_box_h), radius=26, fill=(18, 15, 12, 255), outline=(255, 90, 38, 160), width=2)

# Insert Working QR Code
qr_path = 'public/savera-paradise-qr.png'
if os.path.exists(qr_path):
    qr_img = Image.open(qr_path).convert('RGBA')
    qr_size = 190
    qr_img = qr_img.resize((qr_size, qr_size), Image.Resampling.LANCZOS)
    
    # White card behind QR with padding
    draw.rounded_rectangle((90, qr_box_y + 25, 90 + qr_size + 20, qr_box_y + 25 + qr_size + 20), radius=16, fill=(255, 255, 255, 255))
    canvas.paste(qr_img, (100, qr_box_y + 35), qr_img)

# QR Action Text
font_qr_title = get_font(FONT_TREBUCHET, 38)
font_qr_sub = get_font(FONT_BOLD, 22)
font_qr_url = get_font(FONT_IMPACT, 34)
font_qr_note = get_font(FONT_REGULAR, 18)

draw.text((340, qr_box_y + 25), "SCAN WITH YOUR PHONE CAMERA", font=font_qr_title, fill=(255, 255, 255))
draw.text((340, qr_box_y + 75), "Open in 1 Second • No App Store Download Needed!", font=font_qr_sub, fill=(255, 154, 46))

# Website Domain Pill
draw.rounded_rectangle((340, qr_box_y + 115, 870, qr_box_y + 168), radius=12, fill=(10, 8, 7, 255), outline=(255, 90, 38, 120), width=2)
draw.text((360, qr_box_y + 122), "🌐 saveraparadise.foodbliz.in", font=font_qr_url, fill=(255, 90, 38))

draw.text((340, qr_box_y + 185), "💳 Pay with Google Pay, PhonePe, Paytm QR or Cash on Delivery (COD)", font=font_qr_note, fill=(203, 213, 225))

# Scan Camera Icon Graphic / Pill
draw.rounded_rectangle((900, qr_box_y + 40, 1110, qr_box_y + 195), radius=18, fill=(255, 90, 38, 25), outline=(255, 90, 38, 90), width=1)
draw.text((930, qr_box_y + 60), "📱 INSTANT", font=get_font(FONT_BOLD, 20), fill=(255, 255, 255))
draw.text((925, qr_box_y + 92), "WEB APP", font=get_font(FONT_IMPACT, 34), fill=(255, 90, 38))
draw.text((925, qr_box_y + 140), "Scan & Order\nin 30 Seconds", font=get_font(FONT_REGULAR, 16), fill=(203, 213, 225))

# -------------------------------------------------------------------------
# 7. FOOTER CONTACT & VERIFIED RAMANAGARA ADDRESS
# -------------------------------------------------------------------------
foot_y = 1680
draw.line([(60, foot_y), (1140, foot_y)], fill=(55, 45, 35, 255), width=1)

font_foot_bold = get_font(FONT_BOLD, 20)
font_foot_addr = get_font(FONT_REGULAR, 18)

draw.text((60, foot_y + 18), "📍 Savera Paradise", font=font_foot_bold, fill=(255, 255, 255))
draw.text((250, foot_y + 19), "AGA Building, Railway Station Main Road, Ramanagara, Karnataka — 562159", font=font_foot_addr, fill=(203, 213, 225))

draw.text((60, foot_y + 54), "📞 Order Helpline / Call: +91 9742924237  •  080-27271234", font=font_foot_bold, fill=(255, 122, 69))
draw.text((820, foot_y + 54), "⏰ Open Daily: 11:30 AM – 11:30 PM", font=font_foot_addr, fill=(250, 204, 21))

# -------------------------------------------------------------------------
# SAVE COMPLETED POSTER
# -------------------------------------------------------------------------
output_png = 'public/images/doorstep_delivery_poster.png'
output_jpg = 'public/images/doorstep_delivery_poster.jpg'
canvas.save(output_png, format='PNG', optimize=True)

# Also save high-quality RGB JPEG for fast WhatsApp & social sharing
canvas_rgb = canvas.convert('RGB')
canvas_rgb.save(output_jpg, format='JPEG', quality=95)

# Also copy to artifact directory for instant user viewing
artifact_dir = 'C:/Users/DELL/.gemini/antigravity/brain/5f2d5f57-08fe-483b-882e-82c561f61269'
if os.path.exists(artifact_dir):
    canvas.save(os.path.join(artifact_dir, 'doorstep_delivery_poster.png'), format='PNG')
    canvas_rgb.save(os.path.join(artifact_dir, 'doorstep_delivery_poster.jpg'), format='JPEG', quality=95)

print(f"[OK] Successfully generated high-resolution poster:")
print(f"  - {output_png} (1200x1800)")
print(f"  - {output_jpg} (1200x1800)")
