import os
import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance

# -------------------------------------------------------------------------
# FONTS & HELPER FUNCTIONS
# -------------------------------------------------------------------------
FONT_BOLD = 'C:/Windows/Fonts/segoeuib.ttf'
FONT_REGULAR = 'C:/Windows/Fonts/segoeui.ttf'
FONT_IMPACT = 'C:/Windows/Fonts/impact.ttf'
FONT_TREBUCHET = 'C:/Windows/Fonts/trebucbd.ttf'
FONT_ARIAL_BOLD = 'C:/Windows/Fonts/arialbd.ttf'
FONT_KANNADA = 'C:/Windows/Fonts/Nirmala.ttc'

def get_font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()

def draw_hud_corners(draw, x, y, size, length=24, color=(255, 90, 38, 255), width=4):
    """Draws targeting viewfinder reticles [ ⛶ ] at 4 corners of a box."""
    # Top-Left
    draw.line([(x, y), (x + length, y)], fill=color, width=width)
    draw.line([(x, y), (x, y + length)], fill=color, width=width)
    # Top-Right
    draw.line([(x + size, y), (x + size - length, y)], fill=color, width=width)
    draw.line([(x + size, y), (x + size, y + length)], fill=color, width=width)
    # Bottom-Left
    draw.line([(x, y + size), (x + length, y + size)], fill=color, width=width)
    draw.line([(x, y + size), (x, y + size - length)], fill=color, width=width)
    # Bottom-Right
    draw.line([(x + size, y + size), (x + size - length, y + size)], fill=color, width=width)
    draw.line([(x + size, y + size), (x + size, y + size - length)], fill=color, width=width)

def create_phone_mockup(w=330, h=620, compact=False):
    """Generates a realistic smartphone mockup showing the live Savera Paradise food app."""
    phone = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    dp = ImageDraw.Draw(phone)
    
    # Outer frame & bezel
    dp.rounded_rectangle((0, 0, w, h), radius=42, fill=(28, 23, 20, 255), outline=(90, 72, 60, 255), width=3)
    dp.rounded_rectangle((7, 7, w - 7, h - 7), radius=36, fill=(14, 11, 9, 255))
    
    # Dynamic Island
    dp.rounded_rectangle((int(w/2) - 55, 14, int(w/2) + 55, 36), radius=10, fill=(0, 0, 0, 255))
    dp.text((26, 18), "12:45", font=get_font(FONT_BOLD, 12), fill=(255, 255, 255))
    dp.text((w - 70, 18), "5G  100%", font=get_font(FONT_BOLD, 12), fill=(255, 255, 255))
    
    # App Header
    head_y = 48
    dp.rounded_rectangle((14, head_y, w - 14, head_y + 48), radius=14, fill=(26, 20, 16, 255), outline=(50, 40, 32, 255), width=1)
    logo_path = 'public/savera-logo.png'
    if os.path.exists(logo_path):
        mini_logo = Image.open(logo_path).convert('RGBA').resize((34, 34), Image.Resampling.LANCZOS)
        phone.paste(mini_logo, (22, head_y + 7), mini_logo)
    
    dp.text((64, head_y + 8), "Savera Paradise", font=get_font(FONT_BOLD, 15), fill=(255, 255, 255))
    dp.text((64, head_y + 27), "📍 Ramanagara • 20 Mins Delivery", font=get_font(FONT_BOLD, 11), fill=(255, 90, 38))
    
    # Search bar
    srch_y = head_y + 56
    dp.rounded_rectangle((14, srch_y, w - 14, srch_y + 32), radius=10, fill=(22, 17, 14, 255), outline=(55, 42, 32, 255), width=1)
    dp.text((24, srch_y + 8), "🔍  Search Dum Biryani, Chicken, Kebabs...", font=get_font(FONT_REGULAR, 11), fill=(148, 163, 184))
    
    # Category pills
    cat_y = srch_y + 40
    categories = ["🔥 Best Sellers", "🍚 Biryani", "🍗 Chicken", "🍢 Kebabs"]
    cur_x = 14
    for i, c in enumerate(categories):
        bg = (255, 90, 38, 255) if i == 0 else (30, 24, 19, 255)
        dp.rounded_rectangle((cur_x, cat_y, cur_x + 68, cat_y + 24), radius=12, fill=bg)
        dp.text((cur_x + 7, cat_y + 5), c[:9], font=get_font(FONT_BOLD, 10), fill=(255, 255, 255) if i == 0 else (203, 213, 225))
        cur_x += 74
    
    # Dish 1: Dum Biryani Card
    card1_y = cat_y + 34
    card1_h = 100 if compact else 105
    dp.rounded_rectangle((14, card1_y, w - 14, card1_y + card1_h), radius=16, fill=(24, 19, 15, 255), outline=(55, 42, 32, 255), width=1)
    biryani_path = 'public/images/intro/plate-biryani.webp'
    if os.path.exists(biryani_path):
        b_img = Image.open(biryani_path).convert('RGBA').resize((82, 82), Image.Resampling.LANCZOS)
        phone.paste(b_img, (20, card1_y + 11), b_img)
    
    dp.text((110, card1_y + 12), "Special Dum Biryani", font=get_font(FONT_BOLD, 13), fill=(255, 255, 255))
    dp.text((110, card1_y + 30), "★ 4.9 (840+) • Chef Special", font=get_font(FONT_BOLD, 10), fill=(245, 158, 11))
    dp.text((110, card1_y + 48), "Tender meat & fragrant saffron rice", font=get_font(FONT_REGULAR, 10), fill=(148, 163, 184))
    dp.text((110, card1_y + 70), "₹220", font=get_font(FONT_IMPACT, 17), fill=(255, 90, 38))
    # Add button
    dp.rounded_rectangle((w - 76, card1_y + 66, w - 22, card1_y + 92), radius=7, fill=(255, 90, 38, 255))
    dp.text((w - 64, card1_y + 71), "+ ADD", font=get_font(FONT_BOLD, 11), fill=(255, 255, 255))
    
    # Dish 2: Crispy Chicken / Kebab
    card2_y = card1_y + card1_h + 10
    card2_h = 100 if compact else 105
    dp.rounded_rectangle((14, card2_y, w - 14, card2_y + card2_h), radius=16, fill=(24, 19, 15, 255), outline=(55, 42, 32, 255), width=1)
    kebab_path = 'public/images/intro/plate-kebab.webp'
    if os.path.exists(kebab_path):
        k_img = Image.open(kebab_path).convert('RGBA').resize((82, 82), Image.Resampling.LANCZOS)
        phone.paste(k_img, (20, card2_y + 11), k_img)
    
    dp.text((110, card2_y + 12), "Special Kebab Platter", font=get_font(FONT_BOLD, 13), fill=(255, 255, 255))
    dp.text((110, card2_y + 30), "★ 4.8 (620+) • Hot & Crispy", font=get_font(FONT_BOLD, 10), fill=(245, 158, 11))
    dp.text((110, card2_y + 48), "Seekh, Malai Tikka & Galouti", font=get_font(FONT_REGULAR, 10), fill=(148, 163, 184))
    dp.text((110, card2_y + 70), "₹240", font=get_font(FONT_IMPACT, 17), fill=(255, 90, 38))
    dp.rounded_rectangle((w - 76, card2_y + 66, w - 22, card2_y + 92), radius=7, fill=(255, 90, 38, 255))
    dp.text((w - 64, card2_y + 71), "+ ADD", font=get_font(FONT_BOLD, 11), fill=(255, 255, 255))
    
    # Live Rider Status Pill
    track_y = card2_y + card2_h + 10
    dp.rounded_rectangle((14, track_y, w - 14, track_y + 48), radius=12, fill=(16, 185, 129, 35), outline=(16, 185, 129, 220), width=1)
    dp.text((24, track_y + 7), "🛵 Rider Assigned & En Route", font=get_font(FONT_BOLD, 12), fill=(16, 185, 129))
    dp.text((24, track_y + 25), "Live GPS: Arriving in 15 mins to doorstep", font=get_font(FONT_REGULAR, 10), fill=(203, 213, 225))
    
    return phone

# =========================================================================
# VARIATION 1: VERTICAL PRINT & FLYER POSTER (1200 x 1800 px)
# (NO HOTEL IMAGE - FOCUSED ON DELICIOUS FOOD, SCANNER & DELIVERY)
# =========================================================================
def generate_poster_v1(output_png, output_jpg):
    W, H = 1200, 1800
    canvas = Image.new('RGBA', (W, H), (10, 8, 6, 255))
    
    # Ambient Lighting Flares
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    dg = ImageDraw.Draw(glow)
    dg.ellipse((100, 80, 1100, 450), fill=(255, 90, 38, 70))
    # Scanner glow (Left-Center)
    dg.ellipse((40, 430, 540, 1180), fill=(255, 90, 38, 85))
    dg.ellipse((100, 520, 460, 980), fill=(245, 158, 11, 75))
    # Bike & App glow (Right-Center)
    dg.ellipse((520, 430, 1150, 1180), fill=(255, 140, 20, 65))
    # Bottom Dishes glow
    dg.ellipse((80, 1200, 1120, 1650), fill=(245, 158, 11, 45))
    glow = glow.filter(ImageFilter.GaussianBlur(105))
    canvas = Image.alpha_composite(canvas, glow)
    
    # Subtle technical grid in background
    grid = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    dgrid = ImageDraw.Draw(grid)
    for x in range(0, W, 40):
        dgrid.line([(x, 0), (x, 340)], fill=(255, 255, 255, 8), width=1)
    for y in range(0, 340, 40):
        dgrid.line([(0, y), (W, y)], fill=(255, 255, 255, 8), width=1)
    canvas = Image.alpha_composite(canvas, grid)
    
    draw = ImageDraw.Draw(canvas)
    
    # 1. HEADER (Savera Emblem, English & Kannada Brand, Ramanagara)
    logo_path = 'public/savera-logo.png'
    if os.path.exists(logo_path):
        logo = Image.open(logo_path).convert('RGBA').resize((120, 120), Image.Resampling.LANCZOS)
        draw.ellipse((46, 36, 174, 164), fill=(255, 90, 38, 50), outline=(245, 158, 11, 220), width=3)
        canvas.paste(logo, (50, 40), logo)
    
    draw.text((190, 38), "SAVERA PARADISE", font=get_font(FONT_IMPACT, 48), fill=(255, 255, 255))
    draw.text((190, 96), "ಸವೇರ ಪ್ಯಾರಡೈಸ್", font=get_font(FONT_KANNADA, 28), fill=(255, 170, 50))
    draw.text((380, 100), "• MULTI-CUISINE FAMILY RESTAURANT", font=get_font(FONT_BOLD, 17), fill=(226, 232, 240))
    draw.text((190, 136), "AGA Building, Railway Station Main Road, Ramanagara — 562159", font=get_font(FONT_REGULAR, 17), fill=(148, 163, 184))
    
    # Top-right express pill
    draw.rounded_rectangle((820, 52, 1150, 116), radius=32, fill=(255, 90, 38, 45), outline=(255, 90, 38, 220), width=2)
    draw.text((846, 70), "🛵 20–30 MINS DELIVERY", font=get_font(FONT_BOLD, 21), fill=(255, 255, 255))
    
    # Golden separator beam
    draw.line([(50, 180), (1150, 180)], fill=(245, 158, 11, 100), width=2)
    
    # 2. HEADLINE: "WE ARE NOW DELIVERING TO YOUR DOORSTEP!"
    draw.rounded_rectangle((50, 196, 490, 232), radius=8, fill=(245, 158, 11, 35), outline=(245, 158, 11, 150), width=1)
    draw.text((65, 202), "★ RAMANAGARA'S PREMIER MULTI-CUISINE DESTINATION ★", font=get_font(FONT_BOLD, 15), fill=(250, 204, 21))
    
    font_h1 = get_font(FONT_IMPACT, 66)
    font_h2 = get_font(FONT_IMPACT, 86)
    
    # 3D shadow for row 1
    draw.text((54, 246), "WE ARE NOW DELIVERING", font=font_h1, fill=(0, 0, 0, 200))
    draw.text((50, 242), "WE ARE NOW DELIVERING", font=font_h1, fill=(255, 255, 255))
    
    # 3D fiery orange for row 2
    draw.text((54, 322), "TO YOUR DOORSTEP!", font=font_h2, fill=(160, 30, 0, 240))
    draw.text((50, 318), "TO YOUR DOORSTEP!", font=font_h2, fill=(255, 90, 38))
    
    # 3. HIGH-VISIBILITY 10% OFF PROMOTIONAL RIBBON
    strip_y = 415
    strip_h = 80
    draw.rounded_rectangle((50, strip_y, 1150, strip_y + strip_h), radius=20, fill=(24, 18, 14, 255), outline=(255, 90, 38, 220), width=2)
    draw.rounded_rectangle((53, strip_y + 3, 1147, strip_y + strip_h - 3), radius=17, outline=(245, 158, 11, 140), width=1)
    
    # 10% Off headline
    draw.text((75, strip_y + 14), "🔥 SPECIAL LAUNCH OFFER: GET FLAT 10% OFF!", font=get_font(FONT_IMPACT, 30), fill=(255, 200, 50))
    draw.text((75, strip_y + 48), "Valid on all online food orders across Ramanagara", font=get_font(FONT_REGULAR, 15), fill=(203, 213, 225))
    
    # Coupon code pill
    coupon_x = 680
    draw.rounded_rectangle((coupon_x, strip_y + 14, coupon_x + 230, strip_y + 64), radius=12, fill=(255, 90, 38, 255))
    draw.text((coupon_x + 18, strip_y + 24), "USE CODE: SAVERA10", font=get_font(FONT_BOLD, 17), fill=(255, 255, 255))
    
    # Free Delivery tag
    draw.text((940, strip_y + 16), "🛵 FREE DELIVERY", font=get_font(FONT_IMPACT, 24), fill=(16, 185, 129))
    draw.text((940, strip_y + 46), "On Orders Above ₹249", font=get_font(FONT_BOLD, 14), fill=(148, 163, 184))
    
    # 4. MIDDLE SECTION:
    # LEFT-CENTER = HIGHLIGHTED QR CODE SCANNER POD
    pod_x, pod_y, pod_w, pod_h = 50, 515, 470, 680
    draw.rounded_rectangle((pod_x, pod_y, pod_x + pod_w, pod_y + pod_h), radius=28, fill=(18, 14, 11, 255), outline=(255, 90, 38, 255), width=3)
    draw.rounded_rectangle((pod_x + 4, pod_y + 4, pod_x + pod_w - 4, pod_y + pod_h - 4), radius=24, outline=(245, 158, 11, 150), width=1)
    
    # Scanner Attention Badge
    badge_w = 280
    draw.rounded_rectangle((pod_x + 24, pod_y + 22, pod_x + 24 + badge_w, pod_y + 58), radius=18, fill=(255, 90, 38, 255))
    draw.text((pod_x + 40, pod_y + 29), "📷 POINT CAMERA TO ORDER", font=get_font(FONT_BOLD, 14), fill=(255, 255, 255))
    
    draw.text((pod_x + 24, pod_y + 72), "SCAN & ORDER IN 30 SECS", font=get_font(FONT_IMPACT, 34), fill=(255, 255, 255))
    draw.text((pod_x + 24, pod_y + 114), "Instant live menu opens — zero app download required!", font=get_font(FONT_REGULAR, 14), fill=(203, 213, 225))
    
    # QR Code White Frame & Pedestal (Scannable, 260x260)
    qr_box_x = pod_x + int((pod_w - 260) / 2)
    qr_box_y = pod_y + 150
    qr_box_s = 260
    draw.rounded_rectangle((qr_box_x, qr_box_y, qr_box_x + qr_box_s, qr_box_y + qr_box_s), radius=22, fill=(255, 255, 255, 255))
    
    qr_path = 'public/savera-paradise-qr.png'
    if os.path.exists(qr_path):
        qr_img = Image.open(qr_path).convert('RGBA').resize((qr_box_s - 26, qr_box_s - 26), Image.Resampling.LANCZOS)
        canvas.paste(qr_img, (qr_box_x + 13, qr_box_y + 13), qr_img)
    
    # HUD targeting reticles [ ⛶ ] at corners
    draw_hud_corners(draw, qr_box_x - 10, qr_box_y - 10, qr_box_s + 20, length=32, color=(255, 90, 38, 255), width=4)
    
    # Horizontal Glowing Laser Beam
    laser_y = qr_box_y + int(qr_box_s / 2)
    draw.line([(qr_box_x + 8, laser_y), (qr_box_x + qr_box_s - 8, laser_y)], fill=(255, 90, 38, 220), width=4)
    draw.line([(qr_box_x + 24, laser_y), (qr_box_x + qr_box_s - 24, laser_y)], fill=(255, 255, 255, 255), width=2)
    
    # Website Link Pill
    url_box_w = 410
    url_box_x = pod_x + int((pod_w - url_box_w) / 2)
    url_box_y = qr_box_y + qr_box_s + 20
    draw.rounded_rectangle((url_box_x, url_box_y, url_box_x + url_box_w, url_box_y + 46), radius=14, fill=(10, 8, 6, 255), outline=(255, 90, 38, 200), width=2)
    draw.text((url_box_x + 40, url_box_y + 10), "🌐 saveraparadise.foodbliz.in", font=get_font(FONT_BOLD, 19), fill=(255, 140, 60))
    
    # 3-Step Scan Instructions
    step_y = url_box_y + 56
    draw.text((pod_x + 26, step_y), "1️⃣ Open Camera  →  2️⃣ Tap Link  →  3️⃣ Enjoy Feast!", font=get_font(FONT_BOLD, 15), fill=(250, 204, 21))
    
    # Payment Icons Note
    draw.text((pod_x + 26, step_y + 30), "💳 Google Pay • PhonePe • Paytm • UPI • Cash on Delivery", font=get_font(FONT_REGULAR, 14), fill=(148, 163, 184))
    
    # RIGHT-CENTER = DELIVERY SMARTPHONE APP + DELIVERY BIKE
    right_x = 540
    # Delivery bike in background
    bike_path = 'public/images/delivery-bike.jpg'
    if os.path.exists(bike_path):
        bike = Image.open(bike_path).convert('RGBA').resize((480, 480), Image.Resampling.LANCZOS)
        # Soft feathered edge mask
        bmask = Image.new('L', (480, 480), 255)
        dbm = ImageDraw.Draw(bmask)
        for i in range(40):
            alpha = int((i / 40) * 255)
            dbm.rectangle((i, i, 480 - i, 480 - i), outline=alpha, width=1)
        bike.putalpha(bmask)
        canvas.paste(bike, (670, 540), bike)
    
    # Smartphone app mockup in foreground
    phone_w, phone_h = 330, 640
    phone = create_phone_mockup(phone_w, phone_h, compact=False)
    
    # Phone drop shadow
    pshadow = Image.new('RGBA', (phone_w + 60, phone_h + 60), (0, 0, 0, 0))
    dps = ImageDraw.Draw(pshadow)
    dps.rounded_rectangle((30, 30, phone_w + 30, phone_h + 30), radius=45, fill=(0, 0, 0, 190))
    pshadow = pshadow.filter(ImageFilter.GaussianBlur(25))
    canvas.paste(pshadow, (right_x - 10, 520), pshadow)
    canvas.paste(phone, (right_x + 20, 535), phone)
    
    # Foreground Hot Biryani Plate overlapping
    biryani_path = 'public/images/intro/plate-biryani.webp'
    if os.path.exists(biryani_path):
        bplate = Image.open(biryani_path).convert('RGBA').resize((270, 205), Image.Resampling.LANCZOS)
        bshadow = Image.new('RGBA', (290, 225), (0, 0, 0, 0))
        dbs = ImageDraw.Draw(bshadow)
        dbs.ellipse((15, 15, 275, 210), fill=(0, 0, 0, 170))
        bshadow = bshadow.filter(ImageFilter.GaussianBlur(18))
        canvas.paste(bshadow, (right_x + 240, 960), bshadow)
        canvas.paste(bplate, (right_x + 250, 970), bplate)
    
    # Delivery Guarantee Pill
    draw.rounded_rectangle((790, 490, 1140, 532), radius=21, fill=(16, 185, 129, 35), outline=(16, 185, 129, 200), width=1)
    draw.text((808, 502), "⚡ 20–30 Mins Guaranteed Hot & Fresh", font=get_font(FONT_BOLD, 14), fill=(52, 211, 153))
    
    # 5. BOTTOM SECTION: 3 SIGNATURE DISHES SHOWCASE (REPLACING HOTEL PHOTO)
    dish_sec_y = 1220
    dish_sec_h = 380
    draw.rounded_rectangle((50, dish_sec_y, 1150, dish_sec_y + dish_sec_h), radius=24, fill=(16, 12, 10, 255), outline=(255, 90, 38, 180), width=2)
    
    # Section Header
    draw.text((75, dish_sec_y + 18), "👑 SIGNATURE SPECIALTIES DELIVERED PIPING HOT TO YOUR DOOR", font=get_font(FONT_IMPACT, 26), fill=(255, 255, 255))
    draw.text((850, dish_sec_y + 20), "⚡ 100% Halal & Fresh Guaranteed", font=get_font(FONT_BOLD, 15), fill=(245, 158, 11))
    draw.line([(70, dish_sec_y + 54), (1130, dish_sec_y + 54)], fill=(45, 34, 26, 255), width=1)
    
    # 3 Dish Cards Grid
    card_w = 338
    card_h = 290
    card_y = dish_sec_y + 70
    
    dishes_data = [
        {
            "name": "Dum Biryani",
            "desc": "Fragrant long-grain basmati rice, succulent spiced meat, saffron & caramelized crispy onions.",
            "price": "From ₹190",
            "badge": "★ BESTSELLER",
            "badge_color": (255, 90, 38, 255),
            "img": "public/images/intro/plate-biryani.webp",
            "x": 70
        },
        {
            "name": "Crispy Chicken & Kebabs",
            "desc": "Golden crunchy crispy fried chicken & clay tandoor roasted Seekh & Malai tikka with fresh mint dip.",
            "price": "From ₹180",
            "badge": "🔥 SIZZLING HOT",
            "badge_color": (245, 158, 11, 255),
            "img": "public/images/intro/plate-kebab.webp",
            "x": 70 + card_w + 22
        },
        {
            "name": "Curries, BBQ & Seafood",
            "desc": "Rich butter chicken, artisan gravies, flaky parottas & fresh fish fry cooked to royal perfection.",
            "price": "From ₹150",
            "badge": "🍗 CHEF SPECIAL",
            "badge_color": (16, 185, 129, 255),
            "img": "public/images/intro/plate-bbq.webp",
            "x": 70 + (card_w + 22) * 2
        }
    ]
    
    for d in dishes_data:
        cx = d["x"]
        draw.rounded_rectangle((cx, card_y, cx + card_w, card_y + card_h), radius=18, fill=(24, 18, 14, 255), outline=(55, 42, 32, 255), width=1)
        
        # Dish image centered at top of card
        if os.path.exists(d["img"]):
            dimg = Image.open(d["img"]).convert('RGBA').resize((130, 100), Image.Resampling.LANCZOS)
            canvas.paste(dimg, (cx + int((card_w - 130) / 2), card_y + 12), dimg)
        
        # Badge
        draw.rounded_rectangle((cx + 14, card_y + 118, cx + card_w - 14, card_y + 144), radius=10, fill=(35, 27, 21, 255), outline=d["badge_color"], width=1)
        draw.text((cx + 24, card_y + 123), d["badge"], font=get_font(FONT_BOLD, 12), fill=d["badge_color"])
        draw.text((cx + card_w - 95, card_y + 123), d["price"], font=get_font(FONT_IMPACT, 16), fill=(255, 255, 255))
        
        # Name
        draw.text((cx + 14, card_y + 154), d["name"], font=get_font(FONT_BOLD, 18), fill=(255, 255, 255))
        
        # Description (wrapped)
        words = d["desc"].split()
        lines = []
        cur_line = []
        for w in words:
            if len(" ".join(cur_line + [w])) <= 34:
                cur_line.append(w)
            else:
                lines.append(" ".join(cur_line))
                cur_line = [w]
        if cur_line:
            lines.append(" ".join(cur_line))
        
        desc_y = card_y + 182
        for line in lines[:3]:
            draw.text((cx + 14, desc_y), line, font=get_font(FONT_REGULAR, 12), fill=(148, 163, 184))
            desc_y += 18
        
        # Bottom call to action pill
        draw.rounded_rectangle((cx + 14, card_y + 246, cx + card_w - 14, card_y + 276), radius=8, fill=(255, 90, 38, 35), outline=(255, 90, 38, 160), width=1)
        draw.text((cx + int((card_w - 140) / 2), card_y + 252), "ORDER ONLINE →", font=get_font(FONT_BOLD, 13), fill=(255, 140, 60))
    
    # 6. BOTTOM DETAILS FOOTER
    foot_y = 1630
    draw.line([(50, foot_y), (1150, foot_y)], fill=(60, 48, 38, 255), width=2)
    
    # Left column: Address & Operating Hours
    draw.text((50, foot_y + 16), "SAVERA PARADISE MULTI-CUISINE RESTAURANT", font=get_font(FONT_BOLD, 18), fill=(255, 255, 255))
    draw.text((50, foot_y + 44), "AGA Building, Railway Station Main Road, Ramanagara, Karnataka — 562159", font=get_font(FONT_REGULAR, 16), fill=(203, 213, 225))
    draw.text((50, foot_y + 72), "⏰ Open Daily: 11:30 AM – 11:30 PM  •  100% Halal Food Guaranteed", font=get_font(FONT_BOLD, 15), fill=(250, 204, 21))
    draw.text((50, foot_y + 98), "🌐 Order Online: https://saveraparadise.foodbliz.in", font=get_font(FONT_REGULAR, 15), fill=(255, 90, 38))
    
    # Right column: Order Helpline Phone (Huge, click/call ready)
    call_x = 780
    draw.rounded_rectangle((call_x, foot_y + 16, 1150, foot_y + 116), radius=18, fill=(24, 18, 14, 255), outline=(255, 90, 38, 200), width=2)
    draw.text((call_x + 22, foot_y + 26), "📞 ORDER HELPLINE:", font=get_font(FONT_BOLD, 14), fill=(148, 163, 184))
    draw.text((call_x + 22, foot_y + 48), "+91 9742924237", font=get_font(FONT_IMPACT, 32), fill=(255, 90, 38))
    draw.text((call_x + 22, foot_y + 88), "Landline: 080-27271234", font=get_font(FONT_BOLD, 14), fill=(203, 213, 225))
    
    # Save PNG & JPG
    canvas.save(output_png, 'PNG', quality=95)
    canvas.convert('RGB').save(output_jpg, 'JPEG', quality=95)
    print(f"[OK] Generated Poster V1 (Clean Food Edition): {output_png} & {output_jpg}")

print("[OK] Defined clean generate_poster_v1")
# =========================================================================
# VARIATION 2: SOCIAL MEDIA & WHATSAPP SQUARE (1200 x 1200 px)
# (NO HOTEL IMAGE - CLEAN HIGH-IMPACT COMMERCIAL)
# =========================================================================
def generate_poster_square(output_png, output_jpg):
    W, H = 1200, 1200
    canvas = Image.new('RGBA', (W, H), (10, 8, 6, 255))
    
    # Ambient Lighting Flares
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    dg = ImageDraw.Draw(glow)
    dg.ellipse((80, 40, 1120, 360), fill=(255, 90, 38, 70))
    dg.ellipse((30, 260, 500, 850), fill=(255, 90, 38, 80))
    dg.ellipse((500, 260, 1150, 850), fill=(245, 158, 11, 60))
    dg.ellipse((60, 860, 1140, 1160), fill=(245, 158, 11, 40))
    glow = glow.filter(ImageFilter.GaussianBlur(90))
    canvas = Image.alpha_composite(canvas, glow)
    
    draw = ImageDraw.Draw(canvas)
    
    # 1. HEADER
    logo_path = 'public/savera-logo.png'
    if os.path.exists(logo_path):
        logo = Image.open(logo_path).convert('RGBA').resize((100, 100), Image.Resampling.LANCZOS)
        draw.ellipse((40, 24, 148, 132), fill=(255, 90, 38, 50), outline=(245, 158, 11, 220), width=2)
        canvas.paste(logo, (44, 28), logo)
    
    draw.text((162, 26), "SAVERA PARADISE", font=get_font(FONT_IMPACT, 40), fill=(255, 255, 255))
    draw.text((162, 74), "ಸವೇರ ಪ್ಯಾರಡೈಸ್", font=get_font(FONT_KANNADA, 24), fill=(255, 170, 50))
    draw.text((324, 77), "• MULTI-CUISINE • RAMANAGARA", font=get_font(FONT_BOLD, 15), fill=(203, 213, 225))
    draw.text((162, 106), "AGA Building, Railway Station Main Road — 562159", font=get_font(FONT_REGULAR, 14), fill=(148, 163, 184))
    
    # Right pill
    draw.rounded_rectangle((860, 36, 1160, 90), radius=27, fill=(255, 90, 38, 45), outline=(255, 90, 38, 200), width=2)
    draw.text((884, 52), "🛵 20–30 MINS DELIVERY", font=get_font(FONT_BOLD, 18), fill=(255, 255, 255))
    
    # Headline
    font_h1 = get_font(FONT_IMPACT, 50)
    draw.text((40, 144), "NOW DELIVERING TO YOUR DOORSTEP!", font=font_h1, fill=(255, 255, 255))
    
    # 10% OFF Launch Offer Strip
    strip_y = 208
    strip_h = 60
    draw.rounded_rectangle((40, strip_y, 1160, strip_y + strip_h), radius=15, fill=(24, 18, 14, 255), outline=(255, 90, 38, 220), width=2)
    draw.text((60, strip_y + 14), "🔥 FLAT 10% OFF ON ALL ORDERS!", font=get_font(FONT_IMPACT, 25), fill=(255, 200, 50))
    # Code badge
    draw.rounded_rectangle((490, strip_y + 10, 720, strip_y + 50), radius=10, fill=(255, 90, 38, 255))
    draw.text((506, strip_y + 17), "USE CODE: SAVERA10", font=get_font(FONT_BOLD, 15), fill=(255, 255, 255))
    # Free delivery
    draw.text((750, strip_y + 16), "🛵 FREE DELIVERY ABOVE ₹249", font=get_font(FONT_IMPACT, 20), fill=(16, 185, 129))
    draw.text((1015, strip_y + 18), "⚡ 100% Hot & Fresh", font=get_font(FONT_BOLD, 13), fill=(203, 213, 225))
    
    # 2. MIDDLE SECTION (LEFT: QR SCANNER, RIGHT: BIKE + APP)
    pod_x, pod_y, pod_w, pod_h = 40, 284, 450, 530
    draw.rounded_rectangle((pod_x, pod_y, pod_x + pod_w, pod_y + pod_h), radius=22, fill=(18, 14, 11, 255), outline=(255, 90, 38, 255), width=2)
    
    # Scanner badge
    draw.rounded_rectangle((pod_x + 20, pod_y + 16, pod_x + 250, pod_y + 48), radius=16, fill=(255, 90, 38, 255))
    draw.text((pod_x + 34, pod_y + 23), "📷 POINT CAMERA TO ORDER", font=get_font(FONT_BOLD, 12), fill=(255, 255, 255))
    
    draw.text((pod_x + 20, pod_y + 58), "SCAN & ORDER IN 30 SECS", font=get_font(FONT_IMPACT, 28), fill=(255, 255, 255))
    
    # QR Code Box (230x230)
    qr_s = 230
    qr_x = pod_x + int((pod_w - qr_s) / 2)
    qr_y = pod_y + 104
    draw.rounded_rectangle((qr_x, qr_y, qr_x + qr_s, qr_y + qr_s), radius=18, fill=(255, 255, 255, 255))
    
    qr_path = 'public/savera-paradise-qr.png'
    if os.path.exists(qr_path):
        qr_img = Image.open(qr_path).convert('RGBA').resize((qr_s - 22, qr_s - 22), Image.Resampling.LANCZOS)
        canvas.paste(qr_img, (qr_x + 11, qr_y + 11), qr_img)
    
    # HUD targeting reticles
    draw_hud_corners(draw, qr_x - 8, qr_y - 8, qr_s + 16, length=24, color=(255, 90, 38, 255), width=3)
    # Laser line
    laser_y = qr_y + int(qr_s / 2)
    draw.line([(qr_x + 4, laser_y), (qr_x + qr_s - 4, laser_y)], fill=(255, 90, 38, 220), width=3)
    draw.line([(qr_x + 16, laser_y), (qr_x + qr_s - 16, laser_y)], fill=(255, 255, 255, 255), width=1)
    
    # Website pill
    url_w = 390
    url_x = pod_x + int((pod_w - url_w) / 2)
    url_y = qr_y + qr_s + 16
    draw.rounded_rectangle((url_x, url_y, url_x + url_w, url_y + 40), radius=11, fill=(10, 8, 6, 255), outline=(255, 90, 38, 200), width=1)
    draw.text((url_x + 36, url_y + 8), "🌐 saveraparadise.foodbliz.in", font=get_font(FONT_BOLD, 17), fill=(255, 140, 60))
    
    draw.text((pod_x + 22, url_y + 50), "1️⃣ Open Camera  →  2️⃣ Tap  →  3️⃣ Enjoy Feast!", font=get_font(FONT_BOLD, 13), fill=(250, 204, 21))
    draw.text((pod_x + 22, url_y + 76), "💳 GPay • PhonePe • Paytm • UPI • COD", font=get_font(FONT_REGULAR, 12), fill=(148, 163, 184))
    
    # RIGHT: DELIVERY BIKE + APP
    right_x = 520
    bike_path = 'public/images/delivery-bike.jpg'
    if os.path.exists(bike_path):
        bike = Image.open(bike_path).convert('RGBA').resize((410, 410), Image.Resampling.LANCZOS)
        bmask = Image.new('L', (410, 410), 255)
        dbm = ImageDraw.Draw(bmask)
        for i in range(35):
            alpha = int((i / 35) * 255)
            dbm.rectangle((i, i, 410 - i, 410 - i), outline=alpha, width=1)
        bike.putalpha(bmask)
        canvas.paste(bike, (760, 320), bike)
    
    phone = create_phone_mockup(290, 490, compact=True)
    pshadow = Image.new('RGBA', (330, 530), (0, 0, 0, 0))
    dps = ImageDraw.Draw(pshadow)
    dps.rounded_rectangle((20, 20, 310, 510), radius=40, fill=(0, 0, 0, 180))
    pshadow = pshadow.filter(ImageFilter.GaussianBlur(20))
    canvas.paste(pshadow, (right_x - 10, 290), pshadow)
    canvas.paste(phone, (right_x + 10, 305), phone)
    
    # Overlapping Biryani Cutout
    biryani_path = 'public/images/intro/plate-biryani.webp'
    if os.path.exists(biryani_path):
        bplate = Image.open(biryani_path).convert('RGBA').resize((230, 175), Image.Resampling.LANCZOS)
        bshadow = Image.new('RGBA', (250, 195), (0, 0, 0, 0))
        dbs = ImageDraw.Draw(bshadow)
        dbs.ellipse((10, 10, 240, 185), fill=(0, 0, 0, 170))
        bshadow = bshadow.filter(ImageFilter.GaussianBlur(15))
        canvas.paste(bshadow, (right_x + 220, 600), bshadow)
        canvas.paste(bplate, (right_x + 230, 610), bplate)
    
    # 3. FOOD HIGHLIGHTS STRIP (NO HOTEL IMAGE)
    dish_strip_y = 830
    dish_strip_h = 240
    draw.rounded_rectangle((40, dish_strip_y, 1160, dish_strip_y + dish_strip_h), radius=20, fill=(18, 14, 11, 255), outline=(255, 90, 38, 180), width=2)
    
    # 3 Food Item Pillars
    col_w = 345
    col_data = [
        {"title": "🍚 DUM BIRYANI", "sub": "Long-grain saffron basmati with tender meat & raita", "price": "From ₹190", "x": 60, "img": "public/images/intro/plate-biryani.webp"},
        {"title": "🍗 CRISPY CHICKEN", "sub": "Golden crunchy crunch, juicy & freshly fried", "price": "From ₹180", "x": 60 + col_w + 30, "img": "public/images/intro/plate-kebab.webp"},
        {"title": "🍢 CHARCOAL KEBABS", "sub": "Clay tandoor smoked Seekh & Malai tikka platters", "price": "From ₹220", "x": 60 + (col_w + 30) * 2, "img": "public/images/intro/plate-bbq.webp"}
    ]
    
    for c in col_data:
        cx = c["x"]
        draw.rounded_rectangle((cx, dish_strip_y + 16, cx + col_w, dish_strip_y + dish_strip_h - 16), radius=14, fill=(26, 20, 16, 255), outline=(55, 42, 32, 255), width=1)
        if os.path.exists(c["img"]):
            th = Image.open(c["img"]).convert('RGBA').resize((100, 75), Image.Resampling.LANCZOS)
            canvas.paste(th, (cx + int((col_w - 100) / 2), dish_strip_y + 24), th)
        
        draw.text((cx + 18, dish_strip_y + 110), c["title"], font=get_font(FONT_IMPACT, 20), fill=(255, 255, 255))
        draw.text((cx + col_w - 90, dish_strip_y + 110), c["price"], font=get_font(FONT_BOLD, 14), fill=(255, 90, 38))
        draw.text((cx + 18, dish_strip_y + 140), c["sub"][:42], font=get_font(FONT_REGULAR, 12), fill=(148, 163, 184))
        draw.text((cx + 18, dish_strip_y + 160), c["sub"][42:85], font=get_font(FONT_REGULAR, 12), fill=(148, 163, 184))
        
        # Order pill
        draw.rounded_rectangle((cx + 18, dish_strip_y + 186, cx + col_w - 18, dish_strip_y + 214), radius=6, fill=(255, 90, 38, 40), outline=(255, 90, 38, 150), width=1)
        draw.text((cx + int((col_w - 110) / 2), dish_strip_y + 192), "ORDER ONLINE →", font=get_font(FONT_BOLD, 12), fill=(255, 140, 60))
    
    # 4. BOTTOM FOOTER
    foot_y = 1100
    draw.text((40, foot_y + 10), "📍 AGA Building, Railway Station Main Road, Ramanagara — 562159", font=get_font(FONT_REGULAR, 15), fill=(203, 213, 225))
    draw.text((40, foot_y + 36), "⏰ 11:30 AM – 11:30 PM Daily • 100% Halal Food Guaranteed", font=get_font(FONT_BOLD, 13), fill=(250, 204, 21))
    
    # Call Helpline
    draw.rounded_rectangle((780, foot_y, 1160, foot_y + 60), radius=14, fill=(24, 18, 14, 255), outline=(255, 90, 38, 200), width=2)
    draw.text((798, foot_y + 10), "📞 CALL / HELPLINE:", font=get_font(FONT_BOLD, 12), fill=(148, 163, 184))
    draw.text((798, foot_y + 28), "+91 9742924237", font=get_font(FONT_IMPACT, 24), fill=(255, 90, 38))
    
    # Save PNG & JPG
    canvas.save(output_png, 'PNG', quality=95)
    canvas.convert('RGB').save(output_jpg, 'JPEG', quality=95)
    print(f"[OK] Generated Poster Square (Clean Food Edition): {output_png} & {output_jpg}")

print("[OK] Defined clean generate_poster_square")

# =========================================================================
# VARIATION 3: MOBILE STORY & FULLSCREEN STATUS (1080 x 1920 px)
# (NO HOTEL IMAGE - CLEAN HIGH-IMPACT MOBILE)
# =========================================================================
def generate_poster_story(output_png, output_jpg):
    W, H = 1080, 1920
    canvas = Image.new('RGBA', (W, H), (10, 8, 6, 255))
    
    # Ambient Lighting Flares
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    dg = ImageDraw.Draw(glow)
    dg.ellipse((60, 60, 1020, 500), fill=(255, 90, 38, 70))
    dg.ellipse((30, 480, 520, 1200), fill=(255, 90, 38, 85))
    dg.ellipse((480, 480, 1050, 1200), fill=(245, 158, 11, 65))
    dg.ellipse((80, 1200, 1000, 1750), fill=(245, 158, 11, 45))
    glow = glow.filter(ImageFilter.GaussianBlur(105))
    canvas = Image.alpha_composite(canvas, glow)
    
    draw = ImageDraw.Draw(canvas)
    
    # 1. HEADER
    logo_path = 'public/savera-logo.png'
    if os.path.exists(logo_path):
        logo = Image.open(logo_path).convert('RGBA').resize((115, 115), Image.Resampling.LANCZOS)
        draw.ellipse((40, 38, 163, 161), fill=(255, 90, 38, 50), outline=(245, 158, 11, 220), width=3)
        canvas.paste(logo, (44, 42), logo)
    
    draw.text((180, 40), "SAVERA PARADISE", font=get_font(FONT_IMPACT, 46), fill=(255, 255, 255))
    draw.text((180, 96), "ಸವೇರ ಪ್ಯಾರಡೈಸ್", font=get_font(FONT_KANNADA, 28), fill=(255, 170, 50))
    draw.text((360, 99), "• RAMANAGARA", font=get_font(FONT_BOLD, 17), fill=(203, 213, 225))
    draw.text((180, 134), "AGA Building, Railway Station Main Road — 562159", font=get_font(FONT_REGULAR, 15), fill=(148, 163, 184))
    
    # 2. HEADLINE
    font_h1 = get_font(FONT_IMPACT, 60)
    font_h2 = get_font(FONT_IMPACT, 80)
    draw.text((44, 186), "WE ARE NOW DELIVERING", font=font_h1, fill=(0, 0, 0, 200))
    draw.text((40, 182), "WE ARE NOW DELIVERING", font=font_h1, fill=(255, 255, 255))
    
    draw.text((44, 256), "TO YOUR DOORSTEP!", font=font_h2, fill=(160, 30, 0, 240))
    draw.text((40, 252), "TO YOUR DOORSTEP!", font=font_h2, fill=(255, 90, 38))
    
    # 3. 10% OFF PROMOTIONAL RIBBON
    strip_y = 356
    strip_h = 78
    draw.rounded_rectangle((40, strip_y, 1040, strip_y + strip_h), radius=18, fill=(24, 18, 14, 255), outline=(255, 90, 38, 220), width=2)
    
    draw.text((60, strip_y + 12), "🔥 SPECIAL LAUNCH OFFER: GET FLAT 10% OFF!", font=get_font(FONT_IMPACT, 27), fill=(255, 200, 50))
    draw.text((60, strip_y + 46), "Valid on all online food orders in Ramanagara", font=get_font(FONT_REGULAR, 14), fill=(203, 213, 225))
    
    coupon_x = 600
    draw.rounded_rectangle((coupon_x, strip_y + 12, coupon_x + 210, strip_y + 60), radius=12, fill=(255, 90, 38, 255))
    draw.text((coupon_x + 14, strip_y + 20), "CODE: SAVERA10", font=get_font(FONT_BOLD, 17), fill=(255, 255, 255))
    
    draw.text((830, strip_y + 14), "🛵 FREE DELIVERY", font=get_font(FONT_IMPACT, 22), fill=(16, 185, 129))
    draw.text((830, strip_y + 44), "Above ₹249", font=get_font(FONT_BOLD, 13), fill=(148, 163, 184))
    
    # 4. MIDDLE SECTION (LEFT: QR SCANNER POD, RIGHT: BIKE + APP)
    pod_x, pod_y, pod_w, pod_h = 40, 458, 440, 680
    draw.rounded_rectangle((pod_x, pod_y, pod_x + pod_w, pod_y + pod_h), radius=26, fill=(18, 14, 11, 255), outline=(255, 90, 38, 255), width=3)
    
    # Badge
    draw.rounded_rectangle((pod_x + 18, pod_y + 20, pod_x + 260, pod_y + 54), radius=17, fill=(255, 90, 38, 255))
    draw.text((pod_x + 30, pod_y + 26), "📷 POINT CAMERA TO ORDER", font=get_font(FONT_BOLD, 13), fill=(255, 255, 255))
    
    draw.text((pod_x + 18, pod_y + 68), "SCAN & ORDER IN 30 SECS", font=get_font(FONT_IMPACT, 32), fill=(255, 255, 255))
    draw.text((pod_x + 18, pod_y + 110), "Live menu opens in browser instantly!", font=get_font(FONT_REGULAR, 13), fill=(203, 213, 225))
    
    # QR Code Box (240x240)
    qr_s = 240
    qr_x = pod_x + int((pod_w - qr_s) / 2)
    qr_y = pod_y + 146
    draw.rounded_rectangle((qr_x, qr_y, qr_x + qr_s, qr_y + qr_s), radius=20, fill=(255, 255, 255, 255))
    
    qr_path = 'public/savera-paradise-qr.png'
    if os.path.exists(qr_path):
        qr_img = Image.open(qr_path).convert('RGBA').resize((qr_s - 22, qr_s - 22), Image.Resampling.LANCZOS)
        canvas.paste(qr_img, (qr_x + 11, qr_y + 11), qr_img)
    
    # HUD targeting reticles
    draw_hud_corners(draw, qr_x - 8, qr_y - 8, qr_s + 16, length=28, color=(255, 90, 38, 255), width=4)
    # Laser line
    laser_y = qr_y + int(qr_s / 2)
    draw.line([(qr_x + 6, laser_y), (qr_x + qr_s - 6, laser_y)], fill=(255, 90, 38, 220), width=4)
    draw.line([(qr_x + 18, laser_y), (qr_x + qr_s - 18, laser_y)], fill=(255, 255, 255, 255), width=2)
    
    # Website link pill
    url_w = 390
    url_x = pod_x + int((pod_w - url_w) / 2)
    url_y = qr_y + qr_s + 18
    draw.rounded_rectangle((url_x, url_y, url_x + url_w, url_y + 44), radius=12, fill=(10, 8, 6, 255), outline=(255, 90, 38, 200), width=2)
    draw.text((url_x + 32, url_y + 10), "🌐 saveraparadise.foodbliz.in", font=get_font(FONT_BOLD, 17), fill=(255, 140, 60))
    
    draw.text((pod_x + 20, url_y + 56), "1️⃣ Open Camera  →  2️⃣ Tap  →  3️⃣ Enjoy!", font=get_font(FONT_BOLD, 14), fill=(250, 204, 21))
    draw.text((pod_x + 20, url_y + 82), "💳 GPay • PhonePe • Paytm • UPI • COD", font=get_font(FONT_REGULAR, 12), fill=(148, 163, 184))
    
    # RIGHT: DELIVERY BIKE + APP
    right_x = 500
    bike_path = 'public/images/delivery-bike.jpg'
    if os.path.exists(bike_path):
        bike = Image.open(bike_path).convert('RGBA').resize((460, 460), Image.Resampling.LANCZOS)
        bmask = Image.new('L', (460, 460), 255)
        dbm = ImageDraw.Draw(bmask)
        for i in range(40):
            alpha = int((i / 40) * 255)
            dbm.rectangle((i, i, 460 - i, 460 - i), outline=alpha, width=1)
        bike.putalpha(bmask)
        canvas.paste(bike, (600, 480), bike)
    
    phone = create_phone_mockup(310, 630, compact=False)
    pshadow = Image.new('RGBA', (360, 680), (0, 0, 0, 0))
    dps = ImageDraw.Draw(pshadow)
    dps.rounded_rectangle((25, 25, 335, 655), radius=45, fill=(0, 0, 0, 180))
    pshadow = pshadow.filter(ImageFilter.GaussianBlur(25))
    canvas.paste(pshadow, (right_x - 10, 460), pshadow)
    canvas.paste(phone, (right_x + 15, 475), phone)
    
    # Overlapping Biryani
    biryani_path = 'public/images/intro/plate-biryani.webp'
    if os.path.exists(biryani_path):
        bplate = Image.open(biryani_path).convert('RGBA').resize((250, 190), Image.Resampling.LANCZOS)
        bshadow = Image.new('RGBA', (270, 210), (0, 0, 0, 0))
        dbs = ImageDraw.Draw(bshadow)
        dbs.ellipse((10, 10, 260, 200), fill=(0, 0, 0, 170))
        bshadow = bshadow.filter(ImageFilter.GaussianBlur(16))
        canvas.paste(bshadow, (right_x + 220, 890), bshadow)
        canvas.paste(bplate, (right_x + 230, 900), bplate)
    
    # 5. BOTTOM FOOD SHOWCASE SECTION (NO HOTEL IMAGE)
    dish_sec_y = 1170
    dish_sec_h = 500
    draw.rounded_rectangle((40, dish_sec_y, 1040, dish_sec_y + dish_sec_h), radius=24, fill=(16, 12, 10, 255), outline=(255, 90, 38, 180), width=2)
    
    draw.text((65, dish_sec_y + 18), "👑 POPULAR DISHES DELIVERED PIPING HOT", font=get_font(FONT_IMPACT, 26), fill=(255, 255, 255))
    draw.text((740, dish_sec_y + 20), "⚡ 100% Halal Food Guaranteed", font=get_font(FONT_BOLD, 15), fill=(245, 158, 11))
    draw.line([(55, dish_sec_y + 54), (1025, dish_sec_y + 54)], fill=(45, 34, 26, 255), width=1)
    
    # 3 Horizontal Dish Rows inside the card
    row_h = 130
    story_dishes = [
        {"name": "Royal Dum Biryani", "desc": "Fragrant basmati rice layered with spiced tender meat, saffron, raita & salan.", "price": "₹190", "badge": "★ BESTSELLER", "badge_col": (255, 90, 38, 255), "img": "public/images/intro/plate-biryani.webp", "y": dish_sec_y + 68},
        {"name": "Crispy Chicken & Kebab Platter", "desc": "Crunchy golden fried chicken & tandoor roasted Seekh, Malai Tikka with mint dip.", "price": "₹220", "badge": "🔥 CHEF SPECIAL", "badge_col": (245, 158, 11, 255), "img": "public/images/intro/plate-kebab.webp", "y": dish_sec_y + 68 + row_h + 12},
        {"name": "BBQ Tandoori, Curries & Parotta", "desc": "Smoky charcoal tandoori chicken, rich aromatic gravies & fresh flaky parottas.", "price": "₹160", "badge": "🍗 TOP RATED", "badge_col": (16, 185, 129, 255), "img": "public/images/intro/plate-bbq.webp", "y": dish_sec_y + 68 + (row_h + 12) * 2}
    ]
    
    for sd in story_dishes:
        sy = sd["y"]
        draw.rounded_rectangle((55, sy, 1025, sy + row_h), radius=16, fill=(24, 18, 14, 255), outline=(50, 38, 30, 255), width=1)
        if os.path.exists(sd["img"]):
            sim = Image.open(sd["img"]).convert('RGBA').resize((120, 92), Image.Resampling.LANCZOS)
            canvas.paste(sim, (70, sy + 18), sim)
        
        draw.rounded_rectangle((210, sy + 14, 340, sy + 38), radius=8, fill=(35, 27, 21, 255), outline=sd["badge_col"], width=1)
        draw.text((220, sy + 18), sd["badge"], font=get_font(FONT_BOLD, 11), fill=sd["badge_col"])
        
        draw.text((210, sy + 44), sd["name"], font=get_font(FONT_BOLD, 20), fill=(255, 255, 255))
        draw.text((210, sy + 74), sd["desc"], font=get_font(FONT_REGULAR, 13), fill=(148, 163, 184))
        draw.text((210, sy + 96), f"Starting at {sd['price']} • Fast 20–30 Mins Delivery", font=get_font(FONT_BOLD, 13), fill=(255, 170, 50))
        
        # Add button on right
        draw.rounded_rectangle((880, sy + 45, 1005, sy + 85), radius=10, fill=(255, 90, 38, 255))
        draw.text((905, sy + 54), "+ ORDER", font=get_font(FONT_BOLD, 14), fill=(255, 255, 255))
    
    # 6. BOTTOM DETAILS FOOTER
    foot_y = 1700
    draw.line([(40, foot_y), (1040, foot_y)], fill=(60, 48, 38, 255), width=2)
    
    draw.text((40, foot_y + 16), "SAVERA PARADISE MULTI-CUISINE RESTAURANT", font=get_font(FONT_BOLD, 18), fill=(255, 255, 255))
    draw.text((40, foot_y + 44), "AGA Building, Railway Station Main Road, Ramanagara — 562159", font=get_font(FONT_REGULAR, 15), fill=(203, 213, 225))
    draw.text((40, foot_y + 70), "⏰ Open Daily: 11:30 AM – 11:30 PM • 100% Halal Food", font=get_font(FONT_BOLD, 14), fill=(250, 204, 21))
    draw.text((40, foot_y + 96), "🌐 Order Online: https://saveraparadise.foodbliz.in", font=get_font(FONT_REGULAR, 15), fill=(255, 90, 38))
    
    # Call Box
    call_x = 690
    draw.rounded_rectangle((call_x, foot_y + 16, 1040, foot_y + 116), radius=16, fill=(24, 18, 14, 255), outline=(255, 90, 38, 200), width=2)
    draw.text((call_x + 20, foot_y + 26), "📞 ORDER HELPLINE:", font=get_font(FONT_BOLD, 13), fill=(148, 163, 184))
    draw.text((call_x + 20, foot_y + 48), "+91 9742924237", font=get_font(FONT_IMPACT, 30), fill=(255, 90, 38))
    draw.text((call_x + 20, foot_y + 88), "Landline: 080-27271234", font=get_font(FONT_BOLD, 13), fill=(203, 213, 225))
    
    # Save PNG & JPG
    canvas.save(output_png, 'PNG', quality=95)
    canvas.convert('RGB').save(output_jpg, 'JPEG', quality=95)
    print(f"[OK] Generated Poster Story (Clean Food Edition): {output_png} & {output_jpg}")

print("[OK] Defined clean generate_poster_story")

# =========================================================================
# MAIN EXECUTION ENTRY
# =========================================================================
if __name__ == '__main__':
    print("=== Generating Clean Savera Paradise Posters (No Hotel Image) ===")
    
    # Variation 1: Vertical Flyer / Print Poster (1200 x 1800 px)
    generate_poster_v1(
        'public/images/savera_doorstep_poster_v3.png',
        'public/images/savera_doorstep_poster_v3.jpg'
    )
    generate_poster_v1(
        'public/images/doorstep_delivery_poster.png',
        'public/images/doorstep_delivery_poster.jpg'
    )
    
    # Variation 2: Social Square (1200 x 1200 px)
    generate_poster_square(
        'public/images/savera_doorstep_poster_square.png',
        'public/images/savera_doorstep_poster_square.jpg'
    )
    
    # Variation 3: Mobile Story / Status (1080 x 1920 px)
    generate_poster_story(
        'public/images/savera_doorstep_poster_story.png',
        'public/images/savera_doorstep_poster_story.jpg'
    )
    
    print("=== ALL 3 CLEAN POSTER VARIATIONS GENERATED SUCCESSFULLY ===")
