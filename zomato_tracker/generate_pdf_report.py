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

# Distance stats
under_1km_orders = []
exact_1km_orders = []
exact_2km_orders = []
over_2km_orders = []
local_orders = []

for o in orders:
    loc = o.get('location', '')
    if '<1 km' in loc:
        under_1km_orders.append(o)
    else:
        m = re.search(r'\(<?\s*([\d\.]+)\s*km', loc, re.IGNORECASE)
        if m:
            val = float(m.group(1))
            if val < 2.0:
                exact_1km_orders.append(o)
            elif val == 2.0:
                exact_2km_orders.append(o)
            else:
                over_2km_orders.append(o)
        else:
            local_orders.append(o)

within_2km_count = len(under_1km_orders) + len(exact_1km_orders) + len(exact_2km_orders)
known_distance_count = within_2km_count + len(over_2km_orders)
pct_within_2km = (within_2km_count / known_distance_count * 100) if known_distance_count > 0 else 0
pct_under_1km = (len(under_1km_orders) / known_distance_count * 100) if known_distance_count > 0 else 0
pct_1km = (len(exact_1km_orders) / known_distance_count * 100) if known_distance_count > 0 else 0
pct_2km = (len(exact_2km_orders) / known_distance_count * 100) if known_distance_count > 0 else 0
pct_over_2km = (len(over_2km_orders) / known_distance_count * 100) if known_distance_count > 0 else 0

def format_contact_html(phone_str):
    phone = str(phone_str or '').strip()
    if phone.startswith('+91'):
        digits_only = re.sub(r'\D', '', phone)
        # Ensure country code 91
        if not digits_only.startswith('91') and len(digits_only) == 10:
            full_digits = f"91{digits_only}"
        else:
            full_digits = digits_only
        
        display_phone = f"+{full_digits}"
        return f"""
        <div class="contact-group">
            <a href="tel:{display_phone}" class="call-badge" title="Click to Call">📞 {display_phone}</a>
            <a href="https://wa.me/{full_digits}" class="wa-badge" target="_blank" title="Chat on WhatsApp">💬 WA</a>
        </div>
        """
    return '<span class="phone-badge masked">Masked</span>'

rows_html = []
for i, o in enumerate(orders, 1):
    price_val = o.get('price_num', 0.0)
    bill_str = f"₹{price_val:.2f}" if price_val > 0 else "—"
    
    phone_html = format_contact_html(o.get('customer_phone'))

    loc = o.get('location', 'Ramanagara')
    dist_m = re.search(r'\(<?\s*([\d\.]+\s*km[s]?[^\)]*)\)', loc, re.IGNORECASE)
    dist_text = dist_m.group(1) if dist_m else ("<1 km" if "<1 km" in loc else "Local")
    
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

# Build over 2km rows with clickable call & WA
over_2km_rows = []
for o in over_2km_orders:
    p_val = o.get('price_num', 0.0)
    b_str = f"₹{p_val:.2f}" if p_val > 0 else "—"
    loc = o.get('location', '')
    dist_m = re.search(r'\(<?\s*([\d\.]+\s*km[s]?[^\)]*)\)', loc, re.IGNORECASE)
    dist_text = dist_m.group(1) if dist_m else "Far"
    area = loc.split('(')[0].strip() if '(' in loc else loc
    contact_html = format_contact_html(o.get('customer_phone'))
    over_2km_rows.append(f"""
    <tr>
        <td><strong>#{o.get('order_id')}</strong></td>
        <td><strong>{o.get('customer_name')}</strong></td>
        <td>{contact_html}</td>
        <td><span class="dist-pill red">{dist_text}</span></td>
        <td>{area}</td>
        <td>{o.get('items_summary')}</td>
        <td style="text-align: right; font-weight: 700; color: #047857;">{b_str}</td>
    </tr>
    """)
over_2km_table_html = "\n".join(over_2km_rows)

html_content = f"""
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Daily Orders & Revenue Audit Report - 25 Oct 2026</title>
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
        color: #111827;
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
    .col-rank {{ width: 28px; text-align: center; color: #9ca3af; }}
    .col-id {{ width: 62px; color: #111827; }}
    .col-cust {{ width: 110px; font-weight: 600; color: #1f2937; }}
    .col-phone {{ width: 145px; }}
    .col-loc {{ width: 160px; }}
    .col-items {{ width: auto; color: #374151; }}
    .col-bill {{ width: 80px; text-align: right; color: #047857; font-size: 11px; }}

    /* CALLABLE & WHATSAPP BUTTONS */
    .contact-group {{
        display: flex;
        align-items: center;
        gap: 4px;
        flex-wrap: nowrap;
    }}
    .call-badge {{
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 2.5px 6px;
        background: #eff6ff;
        color: #1d4ed8;
        border: 1px solid #bfdbfe;
        border-radius: 4px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 9px;
        font-weight: 600;
        text-decoration: none;
        white-space: nowrap;
    }}
    .call-badge:hover {{
        background: #dbeafe;
    }}
    .wa-badge {{
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding: 2.5px 5px;
        background: #ecfdf5;
        color: #047857;
        border: 1px solid #a7f3d0;
        border-radius: 4px;
        font-size: 8.5px;
        font-weight: 700;
        text-decoration: none;
        white-space: nowrap;
    }}
    .wa-badge:hover {{
        background: #d1fae5;
    }}
    .phone-badge.masked {{
        display: inline-block;
        padding: 2px 6px;
        border-radius: 4px;
        background: #f3f4f6;
        color: #9ca3af;
        font-style: italic;
        font-size: 9px;
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
    .dist-pill.red {{
        background: #fee2e2;
        color: #991b1b;
    }}
    .dist-pill.green {{
        background: #dcfce7;
        color: #166534;
    }}

    /* LAST PAGE STYLES */
    .last-page-section {{
        page-break-before: always;
        padding-top: 4px;
    }}
    .section-title-box {{
        background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
        color: #ffffff;
        padding: 14px 18px;
        border-radius: 8px;
        margin-bottom: 16px;
        display: flex;
        justify-content: space-between;
        align-items: center;
    }}
    .section-title-box h2 {{
        font-size: 16px;
        font-weight: 800;
        letter-spacing: -0.3px;
    }}
    .section-title-box p {{
        font-size: 10px;
        color: #94a3b8;
        margin-top: 2px;
    }}
    .distance-kpis {{
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
        margin-bottom: 18px;
    }}
    .dist-kpi-card {{
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 10px 14px;
        background: #f8fafc;
    }}
    .dist-kpi-card.highlight {{
        background: #eff6ff;
        border-color: #bfdbfe;
    }}
    .dist-kpi-card .d-label {{
        font-size: 9.5px;
        font-weight: 700;
        text-transform: uppercase;
        color: #64748b;
        letter-spacing: 0.5px;
    }}
    .dist-kpi-card .d-val {{
        font-size: 20px;
        font-weight: 800;
        color: #0f172a;
        margin: 4px 0 2px 0;
    }}
    .dist-kpi-card .d-sub {{
        font-size: 9.5px;
        color: #64748b;
    }}

    .analytics-table {{
        margin-bottom: 18px;
    }}
    .analytics-table th {{
        background: #334155;
    }}
    .analytics-table td {{
        padding: 8px 10px;
        font-size: 10.5px;
    }}

    .takeaways-grid {{
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 12px;
        margin-top: 14px;
    }}
    .takeaway-card {{
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 12px;
    }}
    .takeaway-card h4 {{
        font-size: 11px;
        font-weight: 700;
        color: #1e293b;
        margin-bottom: 4px;
        display: flex;
        align-items: center;
        gap: 6px;
    }}
    .takeaway-card p {{
        font-size: 10px;
        color: #475569;
        line-height: 1.45;
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

<!-- MAIN ORDERS TABLE -->
<div class="header">
    <div class="brand-section">
        <h1>DAILY ORDERS & REVENUE AUDIT REPORT</h1>
        <div class="subtitle">Zomato Partner Operational & Delivery Performance Report</div>
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
        <div class="kpi-sub">Order #{highest_order:.0f}</div>
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
            <th class="col-phone">Customer Contact (Call / WA)</th>
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

<!-- LAST PAGE: DISTANCE BREAKDOWN & GEOGRAPHIC ANALYTICS -->
<div class="last-page-section">
    <div class="section-title-box">
        <div>
            <h2>DELIVERY DISTANCE & GEOGRAPHIC ANALYTICS</h2>
            <p>Spatial distribution of delivery radii, neighborhood customer hotspots, and transit time analytics</p>
        </div>
        <div style="text-align: right;">
            <span style="background: rgba(255,255,255,0.15); padding: 4px 10px; border-radius: 6px; font-size: 10px; font-weight: 600;">
                {pct_within_2km:.0f}% Local Concentration
            </span>
        </div>
    </div>

    <div class="distance-kpis">
        <div class="dist-kpi-card highlight">
            <div class="d-label">Within 2 Kms Core</div>
            <div class="d-val" style="color: #1d4ed8;">{within_2km_count} Orders</div>
            <div class="d-sub"><strong>{pct_within_2km:.1f}%</strong> of total delivery volume</div>
        </div>
        <div class="dist-kpi-card">
            <div class="d-label">Under 1 Km (Walking)</div>
            <div class="d-val" style="color: #047857;">{len(under_1km_orders)} Orders</div>
            <div class="d-sub"><strong>{pct_under_1km:.1f}%</strong> • 3 to 5 mins transit</div>
        </div>
        <div class="dist-kpi-card">
            <div class="d-label">1 Km Radius</div>
            <div class="d-val" style="color: #b45309;">{len(exact_1km_orders)} Orders</div>
            <div class="d-sub"><strong>{pct_1km:.1f}%</strong> • 5 to 8 mins transit</div>
        </div>
        <div class="dist-kpi-card">
            <div class="d-label">Beyond 2 Kms (> 2 Kms)</div>
            <div class="d-val" style="color: #dc2626;">{len(over_2km_orders)} Orders</div>
            <div class="d-sub"><strong>{pct_over_2km:.1f}%</strong> • 12 to 20 mins transit</div>
        </div>
    </div>

    <h3 style="font-size: 12px; font-weight: 700; color: #1e293b; margin-bottom: 8px;">Delivery Distance Breakdown Table</h3>
    <table class="analytics-table">
        <thead>
            <tr>
                <th style="width: 140px;">Distance Category</th>
                <th style="width: 90px; text-align: center;">Orders Count</th>
                <th style="width: 80px; text-align: center;">% Share</th>
                <th style="width: 120px;">Avg Transit Time</th>
                <th>Key Neighborhoods & Customer Hotspots</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td><span class="dist-pill green">&lt; 1 km (Hyperlocal)</span></td>
                <td style="text-align: center; font-weight: 700;">{len(under_1km_orders)} orders</td>
                <td style="text-align: center; font-weight: 600;">{pct_under_1km:.1f}%</td>
                <td>3 – 5 mins away</td>
                <td><strong>Agrahar, Ijoor, Mandipet, Tippu Nagar</strong></td>
            </tr>
            <tr>
                <td><span class="dist-pill">1 km Radius</span></td>
                <td style="text-align: center; font-weight: 700;">{len(exact_1km_orders)} orders</td>
                <td style="text-align: center; font-weight: 600;">{pct_1km:.1f}%</td>
                <td>5 – 8 mins away</td>
                <td><strong>Balageri, Mehboob Nagar, Rehmaniya Nagar, Kothipura</strong></td>
            </tr>
            <tr>
                <td><span class="dist-pill">2 kms Radius</span></td>
                <td style="text-align: center; font-weight: 700;">{len(exact_2km_orders)} orders</td>
                <td style="text-align: center; font-weight: 600;">{pct_2km:.1f}%</td>
                <td>8 – 10 mins away</td>
                <td><strong>Archikarahalli, Rayaradoddi, Vijaya Nagar, Yarab Nagara</strong></td>
            </tr>
            <tr>
                <td><span class="dist-pill red">Beyond 2 kms (&gt; 2 kms)</span></td>
                <td style="text-align: center; font-weight: 700;">{len(over_2km_orders)} orders</td>
                <td style="text-align: center; font-weight: 600;">{pct_over_2km:.1f}%</td>
                <td>12 – 20 mins away</td>
                <td><strong>Bangalore Rd, Ramanagara outer, Doddamannugudde, Dannaayakanpur</strong></td>
            </tr>
            <tr>
                <td><span class="dist-pill" style="background:#f1f5f9; color:#475569;">Town Core (Unspecified)</span></td>
                <td style="text-align: center; font-weight: 700;">{len(local_orders)} orders</td>
                <td style="text-align: center; font-weight: 600;">—</td>
                <td>Fast local transit</td>
                <td><strong>Ramanagara central town cluster</strong></td>
            </tr>
        </tbody>
    </table>

    <h3 style="font-size: 12px; font-weight: 700; color: #1e293b; margin: 14px 0 8px 0;">Orders Beyond 2 Kms (> 2 kms) Detailed Audit</h3>
    <table class="analytics-table">
        <thead>
            <tr>
                <th style="width: 60px;">Order ID</th>
                <th style="width: 110px;">Customer Name</th>
                <th style="width: 140px;">Contact (Call / WA)</th>
                <th style="width: 100px;">Distance & Time</th>
                <th style="width: 150px;">Delivery Location</th>
                <th>Ordered Items Summary</th>
                <th style="width: 80px; text-align: right;">Total Bill</th>
            </tr>
        </thead>
        <tbody>
            {over_2km_table_html}
        </tbody>
    </table>

    <div class="takeaways-grid">
        <div class="takeaway-card">
            <h4>⚡ Rapid Kitchen Turnaround</h4>
            <p><strong>{pct_within_2km:.0f}% of orders are within 2 kms</strong> (4 to 8 mins away). Prioritizing instant packaging for fast-moving items ensures orders are handed to riders within 4 mins of placement.</p>
        </div>
        <div class="takeaway-card">
            <h4>🍱 High-Ticket Far Deliveries</h4>
            <p>Deliveries beyond 2 kms (6–9 kms) carry higher average ticket sizes (₹220 to ₹480). Ensure foil thermal wrapping for gravies and breads to preserve temperature over 15+ min transit.</p>
        </div>
        <div class="takeaway-card">
            <h4>📍 Hyperlocal Density Hubs</h4>
            <p><strong>Agrahar, Ijoor, and Balageri</strong> represent your densest delivery triangle. Direct customer retention outreach via WhatsApp in these hubs will yield the highest return.</p>
        </div>
    </div>

    <div class="footer-note" style="margin-top: 16px;">
        Zomato Distance Analytics Engine • Generated automatically on {datetime.now().strftime('%Y-%m-%d %I:%M %p')}
    </div>
</div>

</body>
</html>
"""

HTML_PATH = r'C:\Users\DELL\Desktop\Zomato_Tracker\orders_report.html'
with open(HTML_PATH, 'w', encoding='utf-8') as f:
    f.write(html_content)

print("[+] Clean HTML report generated. Rendering PDF via Chrome headless...")

with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=True,
        executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe'
    )
    page = browser.new_page()
    page.goto(f'file:///{HTML_PATH.replace(os.sep, "/")}', wait_until='networkidle')
    
    page.pdf(
        path=DESKTOP_PDF,
        format='A4',
        landscape=True,
        print_background=True,
        margin={'top': '10mm', 'bottom': '12mm', 'left': '10mm', 'right': '10mm'}
    )
    
    page.pdf(
        path=TRACKER_PDF,
        format='A4',
        landscape=True,
        print_background=True,
        margin={'top': '10mm', 'bottom': '12mm', 'left': '10mm', 'right': '10mm'}
    )
    
    browser.close()

print(f"[+] Updated PDF generated successfully at:\n  - {DESKTOP_PDF}\n  - {TRACKER_PDF}")
