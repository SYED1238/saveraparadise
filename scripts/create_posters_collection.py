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

print("[OK] Loaded helper definitions")
# =========================================================================
# VARIATION 1: VERTICAL PRINT & FLYER POSTER (1200 x 1800 px)
# =========================================================================
def generate_poster_v1(output_png, output_jpg):
    W, H = 1200, 1800
    canvas = Image.new('RGBA', (W, H), (10, 8, 6, 255))
    
    # Ambient Lighting Flares
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    dg = ImageDraw.Draw(glow)
    dg.ellipse((100, 100, 1100, 480), fill=(255, 90, 38, 70))
    # Scanner glow (Left-Center)
    dg.ellipse((40, 430, 520, 1130), fill=(255, 90, 38, 85))
    dg.ellipse((100, 530, 440, 950), fill=(245, 158, 11, 70))
    # Bike & App glow (Right-Center)
    dg.ellipse((520, 430, 1150, 1130), fill=(255, 140, 20, 60))
    # Storefront photo rim glow (Bottom)
    dg.ellipse((150, 1110, 1050, 1620), fill=(245, 158, 11, 50))
    glow = glow.filter(ImageFilter.GaussianBlur(100))
    canvas = Image.alpha_composite(canvas, glow)
    
    # Subtle technical grid in background
    grid = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    dgrid = ImageDraw.Draw(grid)
    for x in range(0, W, 40):
        dgrid.line([(x, 0), (x, 320)], fill=(255, 255, 255, 8), width=1)
    for y in range(0, 320, 40):
        dgrid.line([(0, y), (W, y)], fill=(255, 255, 255, 8), width=1)
    canvas = Image.alpha_composite(canvas, grid)
    
    draw = ImageDraw.Draw(canvas)
    
    # 1. HEADER (Savera Emblem, English & Kannada Brand, Ramanagara)
    logo_path = 'public/savera-logo.png'
    if os.path.exists(logo_path):
        logo = Image.open(logo_path).convert('RGBA').resize((116, 116), Image.Resampling.LANCZOS)
        draw.ellipse((48, 38, 172, 162), fill=(255, 90, 38, 50), outline=(245, 158, 11, 220), width=3)
        canvas.paste(logo, (52, 42), logo)
    
    draw.text((190, 40), "SAVERA PARADISE", font=get_font(FONT_IMPACT, 46), fill=(255, 255, 255))
    draw.text((190, 96), "ಸವೇರ ಪ್ಯಾರಡೈಸ್", font=get_font(FONT_KANNADA, 26), fill=(255, 170, 50))
    draw.text((370, 99), "• MULTI-CUISINE FAMILY RESTAURANT", font=get_font(FONT_BOLD, 17), fill=(226, 232, 240))
    draw.text((190, 134), "📍 AGA Building, Railway Station Main Road, Ramanagara — 562159", font=get_font(FONT_REGULAR, 16), fill=(148, 163, 184))
    
    # Top-right express pill
    draw.rounded_rectangle((830, 54, 1150, 114), radius=30, fill=(255, 90, 38, 45), outline=(255, 90, 38, 220), width=2)
    draw.text((854, 70), "🛵 20–30 MINS DELIVERY", font=get_font(FONT_BOLD, 20), fill=(255, 255, 255))
    
    # Golden separator beam
    draw.line([(50, 175), (1150, 175)], fill=(245, 158, 11, 100), width=2)
    
    # 2. HEADLINE: "WE ARE NOW DELIVERING TO YOUR DOORSTEP!"
    draw.rounded_rectangle((50, 190, 480, 226), radius=8, fill=(245, 158, 11, 35), outline=(245, 158, 11, 150), width=1)
    draw.text((65, 196), "★ RAMANAGARA'S FAVORITE FEAST ★", font=get_font(FONT_BOLD, 16), fill=(250, 204, 21))
    
    font_h1 = get_font(FONT_IMPACT, 64)
    font_h2 = get_font(FONT_IMPACT, 82)
    
    # 3D shadow for row 1
    draw.text((54, 240), "WE ARE NOW DELIVERING", font=font_h1, fill=(0, 0, 0, 200))
    draw.text((50, 236), "WE ARE NOW DELIVERING", font=font_h1, fill=(255, 255, 255))
    
    # 3D fiery orange for row 2
    draw.text((54, 314), "TO YOUR DOORSTEP!", font=font_h2, fill=(160, 30, 0, 240))
    draw.text((50, 310), "TO YOUR DOORSTEP!", font=font_h2, fill=(255, 90, 38))
    
    # 3. HIGH-VISIBILITY 10% OFF PROMOTIONAL RIBBON
    strip_y = 405
    strip_h = 76
    draw.rounded_rectangle((50, strip_y, 1150, strip_y + strip_h), radius=18, fill=(24, 18, 14, 255), outline=(255, 90, 38, 220), width=2)
    draw.rounded_rectangle((53, strip_y + 3, 1147, strip_y + strip_h - 3), radius=15, outline=(245, 158, 11, 140), width=1)
    
    # 10% Off headline
    draw.text((75, strip_y + 14), "🔥 SPECIAL LAUNCH OFFER: GET FLAT 10% OFF!", font=get_font(FONT_IMPACT, 28), fill=(255, 200, 50))
    draw.text((75, strip_y + 46), "Valid on all online food orders across Ramanagara", font=get_font(FONT_REGULAR, 15), fill=(203, 213, 225))
    
    # Coupon code pill
    coupon_x = 680
    draw.rounded_rectangle((coupon_x, strip_y + 14, coupon_x + 230, strip_y + 60), radius=12, fill=(255, 90, 38, 255))
    draw.text((coupon_x + 18, strip_y + 22), "USE CODE: SAVERA10", font=get_font(FONT_BOLD, 17), fill=(255, 255, 255))
    
    # Free Delivery tag
    draw.text((940, strip_y + 15), "🛵 FREE DELIVERY", font=get_font(FONT_IMPACT, 24), fill=(16, 185, 129))
    draw.text((940, strip_y + 45), "On Orders Above ₹249", font=get_font(FONT_BOLD, 14), fill=(148, 163, 184))
    
    # 4. MIDDLE SECTION:
    # LEFT-CENTER = HIGHLIGHTED QR CODE SCANNER POD
    pod_x, pod_y, pod_w, pod_h = 50, 498, 470, 610
    draw.rounded_rectangle((pod_x, pod_y, pod_x + pod_w, pod_y + pod_h), radius=26, fill=(18, 14, 11, 255), outline=(255, 90, 38, 255), width=3)
    draw.rounded_rectangle((pod_x + 4, pod_y + 4, pod_x + pod_w - 4, pod_y + pod_h - 4), radius=22, outline=(245, 158, 11, 150), width=1)
    
    # Scanner Attention Badge
    badge_w = 270
    draw.rounded_rectangle((pod_x + 22, pod_y + 20, pod_x + 22 + badge_w, pod_y + 54), radius=17, fill=(255, 90, 38, 255))
    draw.text((pod_x + 36, pod_y + 26), "📷 POINT CAMERA TO ORDER", font=get_font(FONT_BOLD, 14), fill=(255, 255, 255))
    
    draw.text((pod_x + 22, pod_y + 66), "SCAN & ORDER IN 30 SECS", font=get_font(FONT_IMPACT, 32), fill=(255, 255, 255))
    draw.text((pod_x + 22, pod_y + 106), "Instant live menu opens — zero app download required!", font=get_font(FONT_REGULAR, 14), fill=(203, 213, 225))
    
    # QR Code White Frame & Pedestal (Scannable, 240x240)
    qr_box_x = pod_x + int((pod_w - 240) / 2)
    qr_box_y = pod_y + 140
    qr_box_s = 240
    draw.rounded_rectangle((qr_box_x, qr_box_y, qr_box_x + qr_box_s, qr_box_y + qr_box_s), radius=20, fill=(255, 255, 255, 255))
    
    qr_path = 'public/savera-paradise-qr.png'
    if os.path.exists(qr_path):
        qr_img = Image.open(qr_path).convert('RGBA').resize((qr_box_s - 24, qr_box_s - 24), Image.Resampling.LANCZOS)
        canvas.paste(qr_img, (qr_box_x + 12, qr_box_y + 12), qr_img)
    
    # HUD targeting reticles [ ⛶ ] at corners
    draw_hud_corners(draw, qr_box_x - 8, qr_box_y - 8, qr_box_s + 16, length=28, color=(255, 90, 38, 255), width=4)
    
    # Horizontal Glowing Laser Beam
    laser_y = qr_box_y + int(qr_box_s / 2)
    draw.line([(qr_box_x + 6, laser_y), (qr_box_x + qr_box_s - 6, laser_y)], fill=(255, 90, 38, 220), width=4)
    draw.line([(qr_box_x + 20, laser_y), (qr_box_x + qr_box_s - 20, laser_y)], fill=(255, 255, 255, 255), width=2)
    
    # Website Link Pill
    url_box_w = 400
    url_box_x = pod_x + int((pod_w - url_box_w) / 2)
    url_box_y = qr_box_y + qr_box_s + 18
    draw.rounded_rectangle((url_box_x, url_box_y, url_box_x + url_box_w, url_box_y + 44), radius=12, fill=(10, 8, 6, 255), outline=(255, 90, 38, 200), width=2)
    draw.text((url_box_x + 36, url_box_y + 10), "🌐 saveraparadise.foodbliz.in", font=get_font(FONT_BOLD, 18), fill=(255, 140, 60))
    
    # 3-Step Scan Instructions
    step_y = url_box_y + 54
    draw.text((pod_x + 28, step_y), "1️⃣ Open Camera  →  2️⃣ Tap Link  →  3️⃣ Enjoy Feast!", font=get_font(FONT_BOLD, 14), fill=(250, 204, 21))
    
    # Payment Icons Note
    draw.text((pod_x + 28, step_y + 28), "💳 Google Pay • PhonePe • Paytm • UPI • Cash on Delivery", font=get_font(FONT_REGULAR, 13), fill=(148, 163, 184))
    
    # RIGHT-CENTER = DELIVERY SMARTPHONE APP + DELIVERY BIKE
    right_x = 540
    # Delivery bike in background
    bike_path = 'public/images/delivery-bike.jpg'
    if os.path.exists(bike_path):
        bike = Image.open(bike_path).convert('RGBA').resize((460, 460), Image.Resampling.LANCZOS)
        # Soft feathered edge mask
        bmask = Image.new('L', (460, 460), 255)
        dbm = ImageDraw.Draw(bmask)
        for i in range(40):
            alpha = int((i / 40) * 255)
            dbm.rectangle((i, i, 460 - i, 460 - i), outline=alpha, width=1)
        bike.putalpha(bmask)
        canvas.paste(bike, (690, 520), bike)
    
    # Smartphone app mockup in foreground
    phone_w, phone_h = 320, 590
    phone = create_phone_mockup(phone_w, phone_h, compact=True)
    
    # Phone drop shadow
    pshadow = Image.new('RGBA', (phone_w + 60, phone_h + 60), (0, 0, 0, 0))
    dps = ImageDraw.Draw(pshadow)
    dps.rounded_rectangle((30, 30, phone_w + 30, phone_h + 30), radius=45, fill=(0, 0, 0, 190))
    pshadow = pshadow.filter(ImageFilter.GaussianBlur(25))
    canvas.paste(pshadow, (right_x - 10, 485), pshadow)
    canvas.paste(phone, (right_x + 20, 510), phone)
    
    # Foreground Hot Biryani Plate overlapping
    biryani_path = 'public/images/intro/plate-biryani.webp'
    if os.path.exists(biryani_path):
        bplate = Image.open(biryani_path).convert('RGBA').resize((260, 195), Image.Resampling.LANCZOS)
        bshadow = Image.new('RGBA', (280, 215), (0, 0, 0, 0))
        dbs = ImageDraw.Draw(bshadow)
        dbs.ellipse((15, 15, 265, 200), fill=(0, 0, 0, 170))
        bshadow = bshadow.filter(ImageFilter.GaussianBlur(18))
        canvas.paste(bshadow, (right_x + 240, 890), bshadow)
        canvas.paste(bplate, (right_x + 250, 900), bplate)
    
    # Delivery Guarantee Pill
    draw.rounded_rectangle((790, 470, 1140, 510), radius=20, fill=(16, 185, 129, 35), outline=(16, 185, 129, 200), width=1)
    draw.text((808, 480), "⚡ 20–30 Mins Guaranteed Hot & Fresh", font=get_font(FONT_BOLD, 14), fill=(52, 211, 153))
    
    # 5. "AND BELOW THIS IMAGE": REAL STOREFRONT SHOWCASE
    sf_x, sf_y, sf_w, sf_h = 50, 1125, 1100, 490
    draw.rounded_rectangle((sf_x, sf_y, sf_x + sf_w, sf_y + sf_h), radius=24, fill=(16, 12, 10, 255), outline=(255, 90, 38, 200), width=3)
    
    # Load and crop real storefront photo
    sf_path = 'public/images/savera-storefront.jpg'
    if os.path.exists(sf_path):
        sf_raw = Image.open(sf_path).convert('RGBA')
        # Target inner dimension
        in_w = sf_w - 12
        in_h = sf_h - 12
        # Crop to keep top signboard & green "I ❤️ RAMANAGARA" wall
        raw_w, raw_h = sf_raw.size
        # Crop slight bottom pavement to center on entrance and sign
        crop_box = (0, 0, raw_w, int(raw_h * 0.95))
        sf_cropped = sf_raw.crop(crop_box).resize((in_w, in_h), Image.Resampling.LANCZOS)
        
        # Rounded corner mask for the storefront photo
        sf_mask = Image.new('L', (in_w, in_h), 0)
        dsm = ImageDraw.Draw(sf_mask)
        dsm.rounded_rectangle((0, 0, in_w, in_h), radius=20, fill=255)
        
        canvas.paste(sf_cropped, (sf_x + 6, sf_y + 6), sf_mask)
        
        # Subtle dark gradient overlay at top and bottom of photo for text readability
        overlay = Image.new('RGBA', (in_w, in_h), (0, 0, 0, 0))
        dov = ImageDraw.Draw(overlay)
        # Top banner shade
        for i in range(70):
            a = int((1 - i/70) * 190)
            dov.line([(0, i), (in_w, i)], fill=(0, 0, 0, a))
        # Bottom banner shade
        for i in range(80):
            a = int((i/80) * 210)
            dov.line([(0, in_h - 80 + i), (in_w, in_h - 80 + i)], fill=(0, 0, 0, a))
        canvas.paste(overlay, (sf_x + 6, sf_y + 6), overlay)
        
        # Floating badge on top-left of storefront photo
        draw.rounded_rectangle((sf_x + 20, sf_y + 18, sf_x + 460, sf_y + 56), radius=19, fill=(14, 11, 9, 230), outline=(255, 90, 38, 220), width=2)
        draw.text((sf_x + 36, sf_y + 26), "📍 OUR AUTHENTIC RESTAURANT IN RAMANAGARA", font=get_font(FONT_BOLD, 14), fill=(255, 255, 255))
        
        # Bottom bar overlay on storefront photo
        draw.text((sf_x + 26, sf_y + sf_h - 48), "SAVERA PARADISE • LUXURY FAMILY DINING & EXPRESS HOME DELIVERY", font=get_font(FONT_BOLD, 17), fill=(255, 255, 255))
        draw.text((sf_x + 26, sf_y + sf_h - 26), "Dine-In • Takeaway • Doorstep Delivery | Known for 'I ❤️ RAMANAGARA'", font=get_font(FONT_REGULAR, 14), fill=(255, 170, 50))
    
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
    print(f"[OK] Generated Poster V1: {output_png} & {output_jpg}")

print("[OK] Defined generate_poster_v1")
# =========================================================================
# VARIATION 2: SOCIAL MEDIA & WHATSAPP SQUARE (1200 x 1200 px)
# =========================================================================
def generate_poster_square(output_png, output_jpg):
    W, H = 1200, 1200
    canvas = Image.new('RGBA', (W, H), (10, 8, 6, 255))
    
    # Ambient Lighting Flares
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    dg = ImageDraw.Draw(glow)
    dg.ellipse((80, 50, 1120, 360), fill=(255, 90, 38, 70))
    dg.ellipse((30, 260, 500, 820), fill=(255, 90, 38, 80))
    dg.ellipse((500, 260, 1150, 820), fill=(245, 158, 11, 60))
    glow = glow.filter(ImageFilter.GaussianBlur(90))
    canvas = Image.alpha_composite(canvas, glow)
    
    draw = ImageDraw.Draw(canvas)
    
    # 1. HEADER
    logo_path = 'public/savera-logo.png'
    if os.path.exists(logo_path):
        logo = Image.open(logo_path).convert('RGBA').resize((96, 96), Image.Resampling.LANCZOS)
        draw.ellipse((40, 26, 144, 130), fill=(255, 90, 38, 50), outline=(245, 158, 11, 220), width=2)
        canvas.paste(logo, (44, 30), logo)
    
    draw.text((158, 28), "SAVERA PARADISE", font=get_font(FONT_IMPACT, 38), fill=(255, 255, 255))
    draw.text((158, 74), "ಸವೇರ ಪ್ಯಾರಡೈಸ್", font=get_font(FONT_KANNADA, 22), fill=(255, 170, 50))
    draw.text((310, 77), "• MULTI-CUISINE • RAMANAGARA", font=get_font(FONT_BOLD, 14), fill=(203, 213, 225))
    draw.text((158, 106), "AGA Building, Railway Station Main Road — 562159", font=get_font(FONT_REGULAR, 14), fill=(148, 163, 184))
    
    # Right pill
    draw.rounded_rectangle((870, 38, 1160, 88), radius=25, fill=(255, 90, 38, 45), outline=(255, 90, 38, 200), width=2)
    draw.text((890, 52), "🛵 20–30 MINS DELIVERY", font=get_font(FONT_BOLD, 17), fill=(255, 255, 255))
    
    # Headline
    font_h1 = get_font(FONT_IMPACT, 48)
    font_h2 = get_font(FONT_IMPACT, 58)
    draw.text((40, 146), "NOW DELIVERING TO YOUR DOORSTEP!", font=font_h1, fill=(255, 255, 255))
    
    # 10% OFF Launch Offer Strip
    strip_y = 210
    strip_h = 58
    draw.rounded_rectangle((40, strip_y, 1160, strip_y + strip_h), radius=14, fill=(24, 18, 14, 255), outline=(255, 90, 38, 220), width=2)
    draw.text((60, strip_y + 14), "🔥 FLAT 10% OFF ON ALL ORDERS!", font=get_font(FONT_IMPACT, 24), fill=(255, 200, 50))
    # Code badge
    draw.rounded_rectangle((490, strip_y + 10, 710, strip_y + 48), radius=10, fill=(255, 90, 38, 255))
    draw.text((505, strip_y + 16), "USE CODE: SAVERA10", font=get_font(FONT_BOLD, 15), fill=(255, 255, 255))
    # Free delivery
    draw.text((740, strip_y + 16), "🛵 FREE DELIVERY ABOVE ₹249", font=get_font(FONT_IMPACT, 20), fill=(16, 185, 129))
    draw.text((1010, strip_y + 18), "⚡ 100% Hot & Fresh", font=get_font(FONT_BOLD, 13), fill=(203, 213, 225))
    
    # 2. MIDDLE SECTION (LEFT: QR SCANNER, RIGHT: BIKE + APP)
    pod_x, pod_y, pod_w, pod_h = 40, 286, 440, 480
    draw.rounded_rectangle((pod_x, pod_y, pod_x + pod_w, pod_y + pod_h), radius=22, fill=(18, 14, 11, 255), outline=(255, 90, 38, 255), width=2)
    
    # Scanner badge
    draw.rounded_rectangle((pod_x + 18, pod_y + 14, pod_x + 240, pod_y + 44), radius=15, fill=(255, 90, 38, 255))
    draw.text((pod_x + 30, pod_y + 20), "📷 POINT CAMERA TO ORDER", font=get_font(FONT_BOLD, 12), fill=(255, 255, 255))
    
    draw.text((pod_x + 18, pod_y + 54), "SCAN & ORDER IN 30 SECS", font=get_font(FONT_IMPACT, 26), fill=(255, 255, 255))
    
    # QR Code Box (210x210)
    qr_s = 210
    qr_x = pod_x + int((pod_w - qr_s) / 2)
    qr_y = pod_y + 96
    draw.rounded_rectangle((qr_x, qr_y, qr_x + qr_s, qr_y + qr_s), radius=16, fill=(255, 255, 255, 255))
    
    qr_path = 'public/savera-paradise-qr.png'
    if os.path.exists(qr_path):
        qr_img = Image.open(qr_path).convert('RGBA').resize((qr_s - 20, qr_s - 20), Image.Resampling.LANCZOS)
        canvas.paste(qr_img, (qr_x + 10, qr_y + 10), qr_img)
    
    # HUD targeting reticles
    draw_hud_corners(draw, qr_x - 6, qr_y - 6, qr_s + 12, length=22, color=(255, 90, 38, 255), width=3)
    # Laser line
    laser_y = qr_y + int(qr_s / 2)
    draw.line([(qr_x + 4, laser_y), (qr_x + qr_s - 4, laser_y)], fill=(255, 90, 38, 220), width=3)
    draw.line([(qr_x + 14, laser_y), (qr_x + qr_s - 14, laser_y)], fill=(255, 255, 255, 255), width=1)
    
    # Website pill
    url_w = 380
    url_x = pod_x + int((pod_w - url_w) / 2)
    url_y = qr_y + qr_s + 14
    draw.rounded_rectangle((url_x, url_y, url_x + url_w, url_y + 38), radius=10, fill=(10, 8, 6, 255), outline=(255, 90, 38, 200), width=1)
    draw.text((url_x + 36, url_y + 8), "🌐 saveraparadise.foodbliz.in", font=get_font(FONT_BOLD, 16), fill=(255, 140, 60))
    
    draw.text((pod_x + 22, url_y + 46), "1️⃣ Open Camera  →  2️⃣ Tap  →  3️⃣ Enjoy Feast!", font=get_font(FONT_BOLD, 13), fill=(250, 204, 21))
    draw.text((pod_x + 22, url_y + 70), "💳 GPay • PhonePe • Paytm • UPI • COD", font=get_font(FONT_REGULAR, 12), fill=(148, 163, 184))
    
    # RIGHT: DELIVERY BIKE + APP
    right_x = 510
    bike_path = 'public/images/delivery-bike.jpg'
    if os.path.exists(bike_path):
        bike = Image.open(bike_path).convert('RGBA').resize((380, 380), Image.Resampling.LANCZOS)
        bmask = Image.new('L', (380, 380), 255)
        dbm = ImageDraw.Draw(bmask)
        for i in range(35):
            alpha = int((i / 35) * 255)
            dbm.rectangle((i, i, 380 - i, 380 - i), outline=alpha, width=1)
        bike.putalpha(bmask)
        canvas.paste(bike, (780, 310), bike)
    
    phone = create_phone_mockup(280, 470, compact=True)
    pshadow = Image.new('RGBA', (320, 510), (0, 0, 0, 0))
    dps = ImageDraw.Draw(pshadow)
    dps.rounded_rectangle((20, 20, 300, 490), radius=40, fill=(0, 0, 0, 180))
    pshadow = pshadow.filter(ImageFilter.GaussianBlur(20))
    canvas.paste(pshadow, (right_x - 10, 280), pshadow)
    canvas.paste(phone, (right_x + 10, 290), phone)
    
    # Overlapping Biryani Cutout
    biryani_path = 'public/images/intro/plate-biryani.webp'
    if os.path.exists(biryani_path):
        bplate = Image.open(biryani_path).convert('RGBA').resize((210, 155), Image.Resampling.LANCZOS)
        bshadow = Image.new('RGBA', (230, 175), (0, 0, 0, 0))
        dbs = ImageDraw.Draw(bshadow)
        dbs.ellipse((10, 10, 220, 165), fill=(0, 0, 0, 170))
        bshadow = bshadow.filter(ImageFilter.GaussianBlur(14))
        canvas.paste(bshadow, (right_x + 220, 570), bshadow)
        canvas.paste(bplate, (right_x + 230, 580), bplate)
    
    # 3. "AND BELOW THIS IMAGE": STOREFRONT SHOWCASE
    sf_x, sf_y, sf_w, sf_h = 40, 786, 1120, 310
    draw.rounded_rectangle((sf_x, sf_y, sf_x + sf_w, sf_y + sf_h), radius=20, fill=(16, 12, 10, 255), outline=(255, 90, 38, 200), width=2)
    
    sf_path = 'public/images/savera-storefront.jpg'
    if os.path.exists(sf_path):
        sf_raw = Image.open(sf_path).convert('RGBA')
        in_w, in_h = sf_w - 8, sf_h - 8
        raw_w, raw_h = sf_raw.size
        # Crop to emphasize "I ❤️ RAMANAGARA" and grand sign
        crop_box = (0, 0, raw_w, int(raw_h * 0.90))
        sf_cropped = sf_raw.crop(crop_box).resize((in_w, in_h), Image.Resampling.LANCZOS)
        
        sf_mask = Image.new('L', (in_w, in_h), 0)
        dsm = ImageDraw.Draw(sf_mask)
        dsm.rounded_rectangle((0, 0, in_w, in_h), radius=18, fill=255)
        canvas.paste(sf_cropped, (sf_x + 4, sf_y + 4), sf_mask)
        
        # Bottom dark gradient
        overlay = Image.new('RGBA', (in_w, in_h), (0, 0, 0, 0))
        dov = ImageDraw.Draw(overlay)
        for i in range(60):
            a = int((i/60) * 200)
            dov.line([(0, in_h - 60 + i), (in_w, in_h - 60 + i)], fill=(0, 0, 0, a))
        canvas.paste(overlay, (sf_x + 4, sf_y + 4), overlay)
        
        # Badge
        draw.rounded_rectangle((sf_x + 16, sf_y + 14, sf_x + 360, sf_y + 46), radius=16, fill=(14, 11, 9, 220), outline=(255, 90, 38, 200), width=1)
        draw.text((sf_x + 28, sf_y + 20), "📍 VISIT US IN PERSON • RAMANAGARA", font=get_font(FONT_BOLD, 13), fill=(255, 255, 255))
        
        draw.text((sf_x + 20, sf_y + sf_h - 38), "SAVERA PARADISE • Known for 'I ❤️ RAMANAGARA' • Dine-In & Doorstep Delivery", font=get_font(FONT_BOLD, 15), fill=(255, 255, 255))
    
    # 4. BOTTOM FOOTER
    foot_y = 1110
    draw.text((40, foot_y + 6), "📍 AGA Building, Railway Station Main Road, Ramanagara — 562159", font=get_font(FONT_REGULAR, 15), fill=(203, 213, 225))
    draw.text((40, foot_y + 30), "⏰ 11:30 AM – 11:30 PM Daily • 100% Halal Food Guaranteed", font=get_font(FONT_BOLD, 13), fill=(250, 204, 21))
    
    # Call Helpline
    draw.rounded_rectangle((780, foot_y - 2, 1160, foot_y + 54), radius=14, fill=(24, 18, 14, 255), outline=(255, 90, 38, 200), width=2)
    draw.text((798, foot_y + 8), "📞 CALL / HELPLINE:", font=get_font(FONT_BOLD, 12), fill=(148, 163, 184))
    draw.text((798, foot_y + 24), "+91 9742924237", font=get_font(FONT_IMPACT, 24), fill=(255, 90, 38))
    
    # Save PNG & JPG
    canvas.save(output_png, 'PNG', quality=95)
    canvas.convert('RGB').save(output_jpg, 'JPEG', quality=95)
    print(f"[OK] Generated Poster Square: {output_png} & {output_jpg}")

print("[OK] Defined generate_poster_square")
# =========================================================================
# VARIATION 3: MOBILE STORY & FULLSCREEN STATUS (1080 x 1920 px)
# =========================================================================
def generate_poster_story(output_png, output_jpg):
    W, H = 1080, 1920
    canvas = Image.new('RGBA', (W, H), (10, 8, 6, 255))
    
    # Ambient Lighting Flares
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    dg = ImageDraw.Draw(glow)
    dg.ellipse((60, 80, 1020, 520), fill=(255, 90, 38, 70))
    dg.ellipse((30, 480, 520, 1200), fill=(255, 90, 38, 85))
    dg.ellipse((480, 480, 1050, 1200), fill=(245, 158, 11, 65))
    dg.ellipse((80, 1200, 1000, 1720), fill=(245, 158, 11, 45))
    glow = glow.filter(ImageFilter.GaussianBlur(100))
    canvas = Image.alpha_composite(canvas, glow)
    
    draw = ImageDraw.Draw(canvas)
    
    # 1. HEADER
    logo_path = 'public/savera-logo.png'
    if os.path.exists(logo_path):
        logo = Image.open(logo_path).convert('RGBA').resize((110, 110), Image.Resampling.LANCZOS)
        draw.ellipse((40, 40, 158, 158), fill=(255, 90, 38, 50), outline=(245, 158, 11, 220), width=3)
        canvas.paste(logo, (44, 44), logo)
    
    draw.text((176, 42), "SAVERA PARADISE", font=get_font(FONT_IMPACT, 44), fill=(255, 255, 255))
    draw.text((176, 94), "ಸವೇರ ಪ್ಯಾರಡೈಸ್", font=get_font(FONT_KANNADA, 26), fill=(255, 170, 50))
    draw.text((350, 97), "• RAMANAGARA", font=get_font(FONT_BOLD, 16), fill=(203, 213, 225))
    draw.text((176, 130), "AGA Building, Railway Station Main Road — 562159", font=get_font(FONT_REGULAR, 15), fill=(148, 163, 184))
    
    # 2. HEADLINE
    font_h1 = get_font(FONT_IMPACT, 58)
    font_h2 = get_font(FONT_IMPACT, 76)
    draw.text((44, 186), "WE ARE NOW DELIVERING", font=font_h1, fill=(0, 0, 0, 200))
    draw.text((40, 182), "WE ARE NOW DELIVERING", font=font_h1, fill=(255, 255, 255))
    
    draw.text((44, 252), "TO YOUR DOORSTEP!", font=font_h2, fill=(160, 30, 0, 240))
    draw.text((40, 248), "TO YOUR DOORSTEP!", font=font_h2, fill=(255, 90, 38))
    
    # 3. 10% OFF PROMOTIONAL RIBBON
    strip_y = 350
    strip_h = 76
    draw.rounded_rectangle((40, strip_y, 1040, strip_y + strip_h), radius=18, fill=(24, 18, 14, 255), outline=(255, 90, 38, 220), width=2)
    
    draw.text((60, strip_y + 12), "🔥 SPECIAL LAUNCH OFFER: GET FLAT 10% OFF!", font=get_font(FONT_IMPACT, 26), fill=(255, 200, 50))
    draw.text((60, strip_y + 44), "Valid on all online food orders in Ramanagara", font=get_font(FONT_REGULAR, 14), fill=(203, 213, 225))
    
    coupon_x = 600
    draw.rounded_rectangle((coupon_x, strip_y + 12, coupon_x + 210, strip_y + 58), radius=12, fill=(255, 90, 38, 255))
    draw.text((coupon_x + 14, strip_y + 20), "CODE: SAVERA10", font=get_font(FONT_BOLD, 17), fill=(255, 255, 255))
    
    draw.text((830, strip_y + 14), "🛵 FREE DELIVERY", font=get_font(FONT_IMPACT, 22), fill=(16, 185, 129))
    draw.text((830, strip_y + 44), "Above ₹249", font=get_font(FONT_BOLD, 13), fill=(148, 163, 184))
    
    # 4. MIDDLE SECTION (LEFT: QR SCANNER POD, RIGHT: BIKE + APP)
    pod_x, pod_y, pod_w, pod_h = 40, 448, 440, 630
    draw.rounded_rectangle((pod_x, pod_y, pod_x + pod_w, pod_y + pod_h), radius=26, fill=(18, 14, 11, 255), outline=(255, 90, 38, 255), width=3)
    
    # Badge
    draw.rounded_rectangle((pod_x + 18, pod_y + 18, pod_x + 260, pod_y + 52), radius=17, fill=(255, 90, 38, 255))
    draw.text((pod_x + 30, pod_y + 24), "📷 POINT CAMERA TO ORDER", font=get_font(FONT_BOLD, 13), fill=(255, 255, 255))
    
    draw.text((pod_x + 18, pod_y + 64), "SCAN & ORDER IN 30 SECS", font=get_font(FONT_IMPACT, 30), fill=(255, 255, 255))
    draw.text((pod_x + 18, pod_y + 104), "Live menu opens in browser instantly!", font=get_font(FONT_REGULAR, 13), fill=(203, 213, 225))
    
    # QR Code Box (230x230)
    qr_s = 230
    qr_x = pod_x + int((pod_w - qr_s) / 2)
    qr_y = pod_y + 138
    draw.rounded_rectangle((qr_x, qr_y, qr_x + qr_s, qr_y + qr_s), radius=18, fill=(255, 255, 255, 255))
    
    qr_path = 'public/savera-paradise-qr.png'
    if os.path.exists(qr_path):
        qr_img = Image.open(qr_path).convert('RGBA').resize((qr_s - 20, qr_s - 20), Image.Resampling.LANCZOS)
        canvas.paste(qr_img, (qr_x + 10, qr_y + 10), qr_img)
    
    # HUD targeting reticles
    draw_hud_corners(draw, qr_x - 8, qr_y - 8, qr_s + 16, length=26, color=(255, 90, 38, 255), width=4)
    # Laser line
    laser_y = qr_y + int(qr_s / 2)
    draw.line([(qr_x + 6, laser_y), (qr_x + qr_s - 6, laser_y)], fill=(255, 90, 38, 220), width=4)
    draw.line([(qr_x + 16, laser_y), (qr_x + qr_s - 16, laser_y)], fill=(255, 255, 255, 255), width=2)
    
    # Website link pill
    url_w = 390
    url_x = pod_x + int((pod_w - url_w) / 2)
    url_y = qr_y + qr_s + 18
    draw.rounded_rectangle((url_x, url_y, url_x + url_w, url_y + 42), radius=12, fill=(10, 8, 6, 255), outline=(255, 90, 38, 200), width=2)
    draw.text((url_x + 32, url_y + 9), "🌐 saveraparadise.foodbliz.in", font=get_font(FONT_BOLD, 17), fill=(255, 140, 60))
    
    draw.text((pod_x + 20, url_y + 54), "1️⃣ Open Camera  →  2️⃣ Tap  →  3️⃣ Enjoy!", font=get_font(FONT_BOLD, 14), fill=(250, 204, 21))
    draw.text((pod_x + 20, url_y + 80), "💳 GPay • PhonePe • Paytm • UPI • COD", font=get_font(FONT_REGULAR, 12), fill=(148, 163, 184))
    
    # RIGHT: DELIVERY BIKE + APP
    right_x = 500
    bike_path = 'public/images/delivery-bike.jpg'
    if os.path.exists(bike_path):
        bike = Image.open(bike_path).convert('RGBA').resize((440, 440), Image.Resampling.LANCZOS)
        bmask = Image.new('L', (440, 440), 255)
        dbm = ImageDraw.Draw(bmask)
        for i in range(40):
            alpha = int((i / 40) * 255)
            dbm.rectangle((i, i, 440 - i, 440 - i), outline=alpha, width=1)
        bike.putalpha(bmask)
        canvas.paste(bike, (620, 470), bike)
    
    phone = create_phone_mockup(300, 600, compact=True)
    pshadow = Image.new('RGBA', (350, 650), (0, 0, 0, 0))
    dps = ImageDraw.Draw(pshadow)
    dps.rounded_rectangle((25, 25, 325, 625), radius=45, fill=(0, 0, 0, 180))
    pshadow = pshadow.filter(ImageFilter.GaussianBlur(25))
    canvas.paste(pshadow, (right_x - 10, 450), pshadow)
    canvas.paste(phone, (right_x + 15, 465), phone)
    
    # Overlapping Biryani
    biryani_path = 'public/images/intro/plate-biryani.webp'
    if os.path.exists(biryani_path):
        bplate = Image.open(biryani_path).convert('RGBA').resize((240, 180), Image.Resampling.LANCZOS)
        bshadow = Image.new('RGBA', (260, 200), (0, 0, 0, 0))
        dbs = ImageDraw.Draw(bshadow)
        dbs.ellipse((10, 10, 250, 190), fill=(0, 0, 0, 170))
        bshadow = bshadow.filter(ImageFilter.GaussianBlur(16))
        canvas.paste(bshadow, (right_x + 220, 840), bshadow)
        canvas.paste(bplate, (right_x + 230, 850), bplate)
    
    # 5. "AND BELOW THIS IMAGE": STOREFRONT SHOWCASE
    sf_x, sf_y, sf_w, sf_h = 40, 1100, 1000, 560
    draw.rounded_rectangle((sf_x, sf_y, sf_x + sf_w, sf_y + sf_h), radius=24, fill=(16, 12, 10, 255), outline=(255, 90, 38, 200), width=3)
    
    sf_path = 'public/images/savera-storefront.jpg'
    if os.path.exists(sf_path):
        sf_raw = Image.open(sf_path).convert('RGBA')
        in_w, in_h = sf_w - 10, sf_h - 10
        raw_w, raw_h = sf_raw.size
        crop_box = (0, 0, raw_w, int(raw_h * 0.96))
        sf_cropped = sf_raw.crop(crop_box).resize((in_w, in_h), Image.Resampling.LANCZOS)
        
        sf_mask = Image.new('L', (in_w, in_h), 0)
        dsm = ImageDraw.Draw(sf_mask)
        dsm.rounded_rectangle((0, 0, in_w, in_h), radius=20, fill=255)
        canvas.paste(sf_cropped, (sf_x + 5, sf_y + 5), sf_mask)
        
        # Shading overlays
        overlay = Image.new('RGBA', (in_w, in_h), (0, 0, 0, 0))
        dov = ImageDraw.Draw(overlay)
        for i in range(70):
            a = int((1 - i/70) * 180)
            dov.line([(0, i), (in_w, i)], fill=(0, 0, 0, a))
        for i in range(80):
            a = int((i/80) * 200)
            dov.line([(0, in_h - 80 + i), (in_w, in_h - 80 + i)], fill=(0, 0, 0, a))
        canvas.paste(overlay, (sf_x + 5, sf_y + 5), overlay)
        
        # Badge
        draw.rounded_rectangle((sf_x + 20, sf_y + 18, sf_x + 440, sf_y + 54), radius=18, fill=(14, 11, 9, 220), outline=(255, 90, 38, 220), width=2)
        draw.text((sf_x + 36, sf_y + 25), "📍 OUR RESTAURANT IN RAMANAGARA", font=get_font(FONT_BOLD, 14), fill=(255, 255, 255))
        
        draw.text((sf_x + 24, sf_y + sf_h - 52), "SAVERA PARADISE • LUXURY FAMILY DINING & EXPRESS DELIVERY", font=get_font(FONT_BOLD, 18), fill=(255, 255, 255))
        draw.text((sf_x + 24, sf_y + sf_h - 26), "Home of 'I ❤️ RAMANAGARA' • Sizzling Biryani, Chicken & Kebabs", font=get_font(FONT_REGULAR, 15), fill=(255, 170, 50))
    
    # 6. BOTTOM DETAILS FOOTER
    foot_y = 1680
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
    print(f"[OK] Generated Poster Story: {output_png} & {output_jpg}")

print("[OK] Defined generate_poster_story")

# =========================================================================
# MAIN EXECUTION ENTRY
# =========================================================================
if __name__ == '__main__':
    print("=== Generating Savera Paradise Posters Collection ===")
    
    # Variation 1: Vertical Flyer / Print Poster (1200 x 1800 px)
    generate_poster_v1(
        'public/images/savera_doorstep_poster_v3.png',
        'public/images/savera_doorstep_poster_v3.jpg'
    )
    # Also update doorstep_delivery_poster.png and jpg to use this layout
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
    
    print("=== ALL 3 POSTER VARIATIONS GENERATED SUCCESSFULLY ===")
