import base64
import os
from PIL import Image, ImageDraw, ImageFilter

source_path = 'public/images/Logo_badge_for_Savera_Paradise_b428aa62_2K.jpg'
if not os.path.exists(source_path):
    raise FileNotFoundError(f"Source image not found at {source_path}")

img = Image.open(source_path).convert('RGBA')

# High-precision crop preserving full chef cooking stove and hat steam
# Crop box (28, 52, 2008, 2032) -> 1980 x 1980
crop_box = (28, 52, 2008, 2032)
cropped = img.crop(crop_box)
w, h = cropped.size

# High-resolution circular mask with smooth anti-aliased edge
mask = Image.new('L', (w, h), 0)
draw = ImageDraw.Draw(mask)
cx, cy = w // 2, h // 2
r = (w // 2) - 4
draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=255)
mask = mask.filter(ImageFilter.GaussianBlur(1.2))

# Composite onto transparent background
master_logo = cropped.copy()
master_logo.putalpha(mask)

# 1. admin-logo.png (1024x1024)
admin_logo = master_logo.resize((1024, 1024), Image.Resampling.LANCZOS)
admin_logo.save('public/admin-logo.png', format='PNG', optimize=True)
print('Saved public/admin-logo.png (1024x1024)')

# 2. icon-admin-512.png (512x512)
icon_512 = master_logo.resize((512, 512), Image.Resampling.LANCZOS)
icon_512.save('public/icon-admin-512.png', format='PNG', optimize=True)
print('Saved public/icon-admin-512.png (512x512)')

# 3. icon-admin-192.png (192x192)
icon_192 = master_logo.resize((192, 192), Image.Resampling.LANCZOS)
icon_192.save('public/icon-admin-192.png', format='PNG', optimize=True)
print('Saved public/icon-admin-192.png (192x192)')

# 4. icon-admin-apple-touch.png (180x180)
apple_icon = master_logo.resize((180, 180), Image.Resampling.LANCZOS)
apple_icon.save('public/icon-admin-apple-touch.png', format='PNG', optimize=True)
print('Saved public/icon-admin-apple-touch.png (180x180)')

# 5. favicon-admin-32x32.png and favicon-admin-16x16.png
fav_32 = master_logo.resize((32, 32), Image.Resampling.LANCZOS)
fav_32.save('public/favicon-admin-32x32.png', format='PNG', optimize=True)
fav_16 = master_logo.resize((16, 16), Image.Resampling.LANCZOS)
fav_16.save('public/favicon-admin-16x16.png', format='PNG', optimize=True)
print('Saved admin favicons (32x32, 16x16)')

# 6. favicon-admin.ico containing (16, 32, 48)
fav_48 = master_logo.resize((48, 48), Image.Resampling.LANCZOS)
fav_48.save('public/favicon-admin.ico', format='ICO', sizes=[(16, 16), (32, 32), (48, 48)])
print('Saved public/favicon-admin.ico')

# 7. Update public/icon-admin-192.svg and public/icon-admin-512.svg with embedded data URI
with open('public/icon-admin-192.png', 'rb') as f:
    b64_192 = base64.b64encode(f.read()).decode('utf-8')

svg_192 = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" width="192" height="192">
  <image width="192" height="192" href="data:image/png;base64,{b64_192}"/>
</svg>'''
with open('public/icon-admin-192.svg', 'w', encoding='utf-8') as f:
    f.write(svg_192)
print('Saved public/icon-admin-192.svg')

with open('public/icon-admin-512.png', 'rb') as f:
    b64_512 = base64.b64encode(f.read()).decode('utf-8')

svg_512 = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <image width="512" height="512" href="data:image/png;base64,{b64_512}"/>
</svg>'''
with open('public/icon-admin-512.svg', 'w', encoding='utf-8') as f:
    f.write(svg_512)
print('Saved public/icon-admin-512.svg')
