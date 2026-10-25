import json, os, re, sys
from datetime import datetime
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')

JSON_PATH = r'C:\Users\DELL\Desktop\Zomato_Tracker\zomato_customer_orders.json'
DESKTOP_PDF = r'C:\Users\DELL\Desktop\Zomato_Orders_Report_2026-10-25.pdf'
TRACKER_PDF = r'C:\Users\DELL\Desktop\Zomato_Tracker\Zomato_Orders_Report_2026-10-25.pdf'

with open(JSON_PATH, 'r', encoding='utf-8') as f:
    orders = json.load(f)

# Sort highest to lowest
orders.sort(key=lambda x: x.get('price_num', 0.0), reverse=True)

# Metrics calculation
total_orders = len(orders)
total_revenue = sum(o.get('price_num', 0.0) for o in orders)
aov = total_revenue / total_orders if total_orders > 0 else 0.0
highest_order = max(o.get('price_num', 0.0) for o in orders) if orders else 0.0
lowest_order = min((o.get('price_num', 0.0) for o in orders if o.get('price_num', 0.0) > 0), default=0.0)

phones_captured = sum(1 for o in orders if str(o.get('customer_phone', '')).startswith('+91'))
phone_rate = (phones_captured / total_orders * 100) if total_orders > 0 else 0

rows_html = []
for i, o in enumerate(orders, 1):
    price_val = o.get('price_num', 0.0)
    bill_str = f"₹{price_val:.2f}" if price_val > 0 else "—"
    
    phone = o.get('customer_phone', '—')
    if phone.startswith('+91'):
        phone_html = f"<span class='phone-badge valid'>{phone}</span>"
    else:
        phone_html = f"<span class='phone-badge masked'>Masked</span>"

    loc = o.get('location', 'Ramanagara')
    dist_m = re.search(r'\(<?\s*([\d\.]+\s*km[s]?[^\)]*)\)', loc, re.IGNORECASE)
    dist_text = dist_m.group(1) if dist_m else ("<1 km" if "<1 km" in loc else "Local")
    
    # Clean location text
    area = loc.split('(')[0].strip() if '(' in loc else loc

    items = o.get('items_summary', '—')
    
    row = f"""
    <tr>
        <td class="col-rank">{i}</td>
        <td class="col-id"><strong>#{o.get('order_id')}</strong></td>
        <td class="col-cust">{o.get('customer_name', 'Customer')}</td>
        <td class="col-phone">{phone_html}</td>
        <td class="col-loc">
            <div class="area-text">{area}</div>
            <div class="dist-pill">{dist_text}</div>
        </td>
        <td class="col-items">{items}</td>
        <td class="col-bill"><strong>{bill_str}</strong></td>
    </tr>
    """
    rows_html.append(row)

table_rows = "\n".join(rows_html)

html_content = f"""
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Zomato Orders & Revenue Report - 25 Oct 2026</title>
<style>
    @page {{
        size: A4 landscape;
        margin: 10mm 12mm 12mm 12mm;
        @bottom-right {{
            content: "Page " counter(page) " of " counter(pages);
            font-size: 9pt;
            color: #6b7280;
        }}
    }}
    * {{
        box-sizing: border-box;
        margin: 0;
        padding: 0;
    }}
    body {{
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        color: #1f2937;
        background: #ffffff;
        font-size: 11px;
        line-height: 1.4;
    }}
    .header {{
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        padding-bottom: 12px;
        border-bottom: 2px solid #e5e7eb;
        margin-bottom: 14px;
    }}
    .brand-section h1 {{
        font-size: 20px;
        font-weight: 800;
        color: #e23744;
        letter-spacing: -0.5px;
        margin-bottom: 2px;
    }}
    .brand-section .subtitle {{
        font-size: 11px;
        color: #4b5563;
        font-weight: 500;
    }}
    .report-meta {{
        text-align: right;
    }}
    .report-meta .date {{
        font-size: 14px;
        font-weight: 700;
        color: #111827;
    }}
    .report-meta .badge {{
        display: inline-block;
        background: #ecfdf5;
        color: #047857;
        padding: 3px 8px;
        border-radius: 9999px;
        font-size: 10px;
        font-weight: 600;
        margin-top: 4px;
        border: 1px solid #a7f3d0;
    }}
    .kpi-grid {{
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 10px;
        margin-bottom: 14px;
    }}
    .kpi-card {{
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 8px 12px;
    }}
    .kpi-label {{
        font-size: 9px;
        font-weight: 600;
        text-transform: uppercase;
        color: #6b7280;
        letter-spacing: 0.5px;
        margin-bottom: 2px;
    }}
    .kpi-value {{
        font-size: 16px;
        font-weight: 800;
        color: #111827;
    }}
    .kpi-sub {{
        font-size: 9px;
        color: #9ca3af;
        margin-top: 2px;
    }}
    table {{
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
    }}
    thead {{
        display: table-header-group;
    }}
    tr {{
        page-break-inside: avoid;
    }}
    th {{
        background: #111827;
        color: #ffffff;
        font-weight: 600;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        padding: 7px 8px;
        text-align: left;
    }}
    td {{
        padding: 6px 8px;
        border-bottom: 1px solid #f3f4f6;
        vertical-align: middle;
        font-size: 10px;
    }}
    tr:nth-child(even) td {{
        background-color: #fafafa;
    }}
    .col-rank {{ width: 32px; text-align: center; color: #9ca3af; }}
    .col-id {{ width: 65px; color: #111827; }}
    .col-cust {{ width: 120px; font-weight: 600; color: #1f2937; }}
    .col-phone {{ width: 110px; }}
    .col-loc {{ width: 170px; }}
    .col-items {{ width: auto; color: #374151; }}
    .col-bill {{ width: 85px; text-align: right; color: #047857; font-size: 11px; }}

    .phone-badge {{
        display: inline-block;
        padding: 2px 6px;
        border-radius: 4px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 9.5px;
        font-weight: 600;
    }}
    .phone-badge.valid {{
        background: #eff6ff;
        color: #1d4ed8;
        border: 1px solid #bfdbfe;
    }}
    .phone-badge.masked {{
        background: #f3f4f6;
        color: #9ca3af;
        font-style: italic;
    }}
    .area-text {{
        font-weight: 500;
        color: #374151;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }}
    .dist-pill {{
        display: inline-block;
        background: #fef3c7;
        color: #92400e;
        font-size: 8.5px;
        font-weight: 700;
        padding: 1px 5px;
        border-radius: 3px;
        margin-top: 2px;
    }}
    .footer-note {{
        margin-top: 14px;
        text-align: center;
        font-size: 9px;
        color: #9ca3af;
        border-top: 1px solid #e5e7eb;
        padding-top: 8px;
    }}
</style>
</head>
<body>

<div class="header">
    <div class="brand-section">
        <h1>SAS CRISPY CHICKEN / SMM TAJ</h1>
        <div class="subtitle">Zomato Restaurant Partner • Daily Order & Revenue Audit Report</div>
    </div>
    <div class="report-meta">
        <div class="date">Sunday, 25 October 2026</div>
        <div class="badge">Autonomously Tracked via CDP Bot</div>
    </div>
</div>

<div class="kpi-grid">
    <div class="kpi-card">
        <div class="kpi-label">Total Orders</div>
        <div class="kpi-value">{total_orders}</div>
        <div class="kpi-sub">Full shift tracking</div>
    </div>
    <div class="kpi-card">
        <div class="kpi-label">Gross Order Value</div>
        <div class="kpi-value" style="color: #047857;">₹{total_revenue:,.2f}</div>
        <div class="kpi-sub">Total revenue today</div>
    </div>
    <div class="kpi-card">
        <div class="kpi-label">Average Order Value</div>
        <div class="kpi-value">₹{aov:.2f}</div>
        <div class="kpi-sub">Per completed order</div>
    </div>
    <div class="kpi-card">
        <div class="kpi-label">Highest Ticket</div>
        <div class="kpi-value" style="color: #2563eb;">₹{highest_order:.2f}</div>
        <div class="kpi-sub">Order #3402 (Bhumika)</div>
    </div>
    <div class="kpi-card">
        <div class="kpi-label">Customer Contacts</div>
        <div class="kpi-value" style="color: #d97706;">{phones_captured} / {total_orders}</div>
        <div class="kpi-sub">{phone_rate:.1f}% phone unmask rate</div>
    </div>
</div>

<table>
    <thead>
        <tr>
            <th class="col-rank">#</th>
            <th class="col-id">Order ID</th>
            <th class="col-cust">Customer Name</th>
            <th class="col-phone">Phone Number</th>
            <th class="col-loc">Delivery Area & Dist</th>
            <th class="col-items">Ordered Items & Add-ons</th>
            <th class="col-bill">Total Bill</th>
        </tr>
    </thead>
    <tbody>
        {table_rows}
    </tbody>
</table>

<div class="footer-note">
    Generated automatically on {datetime.now().strftime('%Y-%m-%d %I:%M %p')} • All customer details, distances, and billings recorded autonomously.
</div>

</body>
</html>
"""

HTML_PATH = r'C:\Users\DELL\Desktop\Zomato_Tracker\orders_report.html'
with open(HTML_PATH, 'w', encoding='utf-8') as f:
    f.write(html_content)

print("[+] HTML report generated. Rendering PDF via Chrome headless...")

with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=True,
        executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe'
    )
    page = browser.new_page()
    page.goto(f'file:///{HTML_PATH.replace(os.sep, "/")}', wait_until='networkidle')
    
    # Generate PDF with print background and proper margins
    page.pdf(
        path=DESKTOP_PDF,
        format='A4',
        landscape=True,
        print_background=True,
        margin={'top': '10mm', 'bottom': '12mm', 'left': '10mm', 'right': '10mm'}
    )
    
    # Also save inside Zomato_Tracker folder
    page.pdf(
        path=TRACKER_PDF,
        format='A4',
        landscape=True,
        print_background=True,
        margin={'top': '10mm', 'bottom': '12mm', 'left': '10mm', 'right': '10mm'}
    )
    
    browser.close()

print(f"[+] PDF generated successfully at:\n  - {DESKTOP_PDF}\n  - {TRACKER_PDF}")
