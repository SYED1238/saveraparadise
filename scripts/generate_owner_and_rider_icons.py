import base64
import os
from PIL import Image, ImageDraw, ImageFilter

def process_badge(source_path, prefix, title):
    if not os.path.exists(source_path):
        raise FileNotFoundError(f"Source image not found at {source_path}")

    img = Image.open(source_path).convert('RGBA')

    # Centered 1620x1620 square crop around (1024, 1024)
    crop_box = (214, 214, 1834, 1834)
    cropped = img.crop(crop_box)
    w, h = cropped.size

    # High-resolution circular mask with smooth anti-aliased edge
    mask = Image.new('L', (w, h), 0)
    draw = ImageDraw.Draw(mask)
    cx, cy = w // 2, h // 2
    r = (w // 2) - 4 # 806 px radius
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(1.2))

    master_logo = cropped.copy()
    master_logo.putalpha(mask)

    # 1. Primary brand logo PNG (1024x1024)
    logo_path = f'public/{prefix}-logo.png'
    logo_1024 = master_logo.resize((1024, 1024), Image.Resampling.LANCZOS)
    logo_1024.save(logo_path, format='PNG', optimize=True)
    print(f'Saved {logo_path} (1024x1024)')

    # 2. PWA icon 512x512
    icon_512_path = f'public/icon-{prefix}-512.png'
    icon_512 = master_logo.resize((512, 512), Image.Resampling.LANCZOS)
    icon_512.save(icon_512_path, format='PNG', optimize=True)
    print(f'Saved {icon_512_path}')

    # 3. PWA icon 192x192
    icon_192_path = f'public/icon-{prefix}-192.png'
    icon_192 = master_logo.resize((192, 192), Image.Resampling.LANCZOS)
    icon_192.save(icon_192_path, format='PNG', optimize=True)
    print(f'Saved {icon_192_path}')

    # 4. Apple Touch Icon 180x180
    apple_path = f'public/icon-{prefix}-apple-touch.png'
    apple_icon = master_logo.resize((180, 180), Image.Resampling.LANCZOS)
    apple_icon.save(apple_path, format='PNG', optimize=True)
    print(f'Saved {apple_path}')

    # 5. Favicons 32x32 and 16x16
    fav_32_path = f'public/favicon-{prefix}-32x32.png'
    fav_32 = master_logo.resize((32, 32), Image.Resampling.LANCZOS)
    fav_32.save(fav_32_path, format='PNG', optimize=True)

    fav_16_path = f'public/favicon-{prefix}-16x16.png'
    fav_16 = master_logo.resize((16, 16), Image.Resampling.LANCZOS)
    fav_16.save(fav_16_path, format='PNG', optimize=True)
    print(f'Saved {fav_32_path} and {fav_16_path}')

    # 6. Multi-resolution ICO (16, 32, 48)
    ico_path = f'public/favicon-{prefix}.ico'
    fav_48 = master_logo.resize((48, 48), Image.Resampling.LANCZOS)
    fav_48.save(ico_path, format='ICO', sizes=[(16, 16), (32, 32), (48, 48)])
    print(f'Saved {ico_path}')

    # 7. Scalable SVG wrappers with embedded PNG
    with open(icon_192_path, 'rb') as f:
        b64_192 = base64.b64encode(f.read()).decode('utf-8')
    svg_192 = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" width="192" height="192">
  <image width="192" height="192" href="data:image/png;base64,{b64_192}"/>
</svg>'''
    svg_192_path = f'public/icon-{prefix}-192.svg'
    with open(svg_192_path, 'w', encoding='utf-8') as f:
        f.write(svg_192)
    print(f'Saved {svg_192_path}')

    with open(icon_512_path, 'rb') as f:
        b64_512 = base64.b64encode(f.read()).decode('utf-8')
    svg_512 = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <image width="512" height="512" href="data:image/png;base64,{b64_512}"/>
</svg>'''
    svg_512_path = f'public/icon-{prefix}-512.svg'
    with open(svg_512_path, 'w', encoding='utf-8') as f:
        f.write(svg_512)
    print(f'Saved {svg_512_path}')


# 1. Process Owner Portal
process_badge(
    source_path='public/images/Logo_badge_for_Savera_Paradise_beefb445_2K.jpg',
    prefix='owner',
    title='Savera Paradise Owner'
)

# 2. Process Rider Portal
process_badge(
    source_path='public/images/Logo_badge_for_Savera_Paradise_db7b5228_2K.jpg',
    prefix='rider',
    title='Savera Paradise Rider'
)
