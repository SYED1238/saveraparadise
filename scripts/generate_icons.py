import base64
from PIL import Image, ImageDraw, ImageFilter

source_path = 'public/images/Logo_badge_for_Savera_Paradise_f84684f3_2K.jpg'
img = Image.open(source_path).convert('RGBA')

# Center of Savera Paradise emblem in 2048x2048 source
cx, cy = 1024, 1039
half_box = 800  # 1600 x 1600 bounding square around entire emblem
cropped_artwork = img.crop((cx - half_box, cy - half_box, cx + half_box, cy + half_box))
w, h = cropped_artwork.size

# -------------------------------------------------------------
# 1. NAVBAR / IN-APP LOGO: savera-logo.png (1024x1024)
# Circular badge with smooth anti-aliased edge
# -------------------------------------------------------------
navbar_mask = Image.new('L', (w, h), 0)
d_nav = ImageDraw.Draw(navbar_mask)
d_nav.ellipse((cx - half_box + 20 - (cx - half_box), 
               cy - half_box + 20 - (cy - half_box), 
               cx + half_box - 20 - (cx - half_box), 
               cy + half_box - 20 - (cy - half_box)), fill=255)
# Equivalent to:
r_nav = half_box - 20
d_nav_clean = ImageDraw.Draw(navbar_mask)
navbar_mask = Image.new('L', (w, h), 0)
d_nav_clean = ImageDraw.Draw(navbar_mask)
d_nav_clean.ellipse((w // 2 - r_nav, h // 2 - r_nav, w // 2 + r_nav, h // 2 + r_nav), fill=255)
navbar_mask = navbar_mask.filter(ImageFilter.GaussianBlur(1.5))

master_logo = cropped_artwork.copy()
master_logo.putalpha(navbar_mask)
logo_1024 = master_logo.resize((1024, 1024), Image.Resampling.LANCZOS)
logo_1024.save('public/savera-logo.png', format='PNG', optimize=True)
print('Saved public/savera-logo.png (1024x1024)')

# -------------------------------------------------------------
# 2. PWA ADAPTIVE / MASKABLE ICONS (512x512 and 192x192)
# Standard Android Adaptive Icon Safe Zone:
# Canvas = 108dp (512px). Safe Zone circle = 72dp (341.3px).
# Artwork bounding size = 296px (~58% of canvas, 87% of safe circle).
# Background = Solid #FFFFFF extending to all edges.
# Guarantees ZERO clipping on circular, squircle, or rounded-rect launchers.
# -------------------------------------------------------------
# 512x512
size_512 = 512
art_size_512 = 296
offset_512 = (size_512 - art_size_512) // 2  # 108px

icon_512_canvas = Image.new('RGBA', (size_512, size_512), (255, 255, 255, 255))
scaled_512 = cropped_artwork.resize((art_size_512, art_size_512), Image.Resampling.LANCZOS)
icon_512_canvas.paste(scaled_512, (offset_512, offset_512), scaled_512)

icon_512_canvas.save('public/icon-512.png', format='PNG', optimize=True)
icon_512_canvas.save('public/icon-maskable-512.png', format='PNG', optimize=True)
print('Saved public/icon-512.png and public/icon-maskable-512.png (512x512)')

# 192x192
size_192 = 192
art_size_192 = 110
offset_192 = (size_192 - art_size_192) // 2  # 41px

icon_192_canvas = Image.new('RGBA', (size_192, size_192), (255, 255, 255, 255))
scaled_192 = cropped_artwork.resize((art_size_192, art_size_192), Image.Resampling.LANCZOS)
icon_192_canvas.paste(scaled_192, (offset_192, offset_192), scaled_192)

icon_192_canvas.save('public/icon-192.png', format='PNG', optimize=True)
icon_192_canvas.save('public/icon-maskable-192.png', format='PNG', optimize=True)
print('Saved public/icon-192.png and public/icon-maskable-192.png (192x192)')

# -------------------------------------------------------------
# 3. APPLE TOUCH ICON (180x180)
# iOS squircle mask safe-zone on solid #FFFFFF
# -------------------------------------------------------------
size_180 = 180
art_size_180 = 104
offset_180 = (size_180 - art_size_180) // 2

apple_canvas = Image.new('RGBA', (size_180, size_180), (255, 255, 255, 255))
scaled_180 = cropped_artwork.resize((art_size_180, art_size_180), Image.Resampling.LANCZOS)
apple_canvas.paste(scaled_180, (offset_180, offset_180), scaled_180)
apple_canvas.save('public/apple-touch-icon.png', format='PNG', optimize=True)
print('Saved public/apple-touch-icon.png (180x180)')

# -------------------------------------------------------------
# 4. BROWSER FAVICONS (32x32, 16x16, favicon.ico)
# High-contrast circular badges optimized for small browser tabs
# -------------------------------------------------------------
fav_32 = master_logo.resize((32, 32), Image.Resampling.LANCZOS)
fav_32.save('public/favicon-32x32.png', format='PNG', optimize=True)

fav_16 = master_logo.resize((16, 16), Image.Resampling.LANCZOS)
fav_16.save('public/favicon-16x16.png', format='PNG', optimize=True)

fav_48 = master_logo.resize((48, 48), Image.Resampling.LANCZOS)
fav_48.save('public/favicon.ico', format='ICO', sizes=[(16, 16), (32, 32), (48, 48)])
print('Saved favicons (32x32, 16x16, favicon.ico)')

# -------------------------------------------------------------
# 5. VECTOR SVG ICONS WITH EMBEDDED DATA URIs
# -------------------------------------------------------------
with open('public/icon-192.png', 'rb') as f:
    b64_192 = base64.b64encode(f.read()).decode('utf-8')

svg_192 = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" width="192" height="192">
  <image width="192" height="192" href="data:image/png;base64,{b64_192}"/>
</svg>'''
with open('public/icon-192.svg', 'w', encoding='utf-8') as f:
    f.write(svg_192)
print('Saved public/icon-192.svg')

with open('public/icon-512.png', 'rb') as f:
    b64_512 = base64.b64encode(f.read()).decode('utf-8')

svg_512 = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <image width="512" height="512" href="data:image/png;base64,{b64_512}"/>
</svg>'''
with open('public/icon-512.svg', 'w', encoding='utf-8') as f:
    f.write(svg_512)
print('Saved public/icon-512.svg')
