"""
Knowledge Base Document Generator for MixBox – Box & Bundle Builder
Generates a comprehensive Word (.docx) file with all pages, fields, and sections.
"""

from docx import Document
from docx.shared import Pt, RGBColor, Inches, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
import os

doc = Document()

# ─── Page Setup ───────────────────────────────────────────────────────────────
section = doc.sections[0]
section.page_width  = Inches(8.5)
section.page_height = Inches(11)
section.left_margin   = Inches(1)
section.right_margin  = Inches(1)
section.top_margin    = Inches(1)
section.bottom_margin = Inches(1)

# ─── Colors ───────────────────────────────────────────────────────────────────
GREEN  = RGBColor(0x2A, 0x7A, 0x4F)
DARK   = RGBColor(0x1E, 0x1E, 0x2D)
GRAY   = RGBColor(0x6B, 0x72, 0x80)
LGRAY  = RGBColor(0xF3, 0xF4, 0xF6)
WHITE  = RGBColor(0xFF, 0xFF, 0xFF)
BLUE   = RGBColor(0x1D, 0x4E, 0xD8)
PURPLE = RGBColor(0x7C, 0x3A, 0xED)
RED    = RGBColor(0xDC, 0x26, 0x26)

# ─── Style Helpers ────────────────────────────────────────────────────────────
def set_run_font(run, name="Calibri", size=11, bold=False, italic=False, color=None):
    run.font.name  = name
    run.font.size  = Pt(size)
    run.font.bold  = bold
    run.font.italic = italic
    if color:
        run.font.color.rgb = color

def add_heading(doc, text, level=1):
    """Custom heading with brand color."""
    para = doc.add_paragraph()
    para.paragraph_format.space_before = Pt(18 if level == 1 else 12)
    para.paragraph_format.space_after  = Pt(6)
    run = para.add_run(text)
    sizes = {1: 20, 2: 16, 3: 13, 4: 12}
    colors = {1: GREEN, 2: DARK, 3: DARK, 4: GRAY}
    set_run_font(run, size=sizes.get(level, 12), bold=True, color=colors.get(level, DARK))
    if level == 1:
        para.paragraph_format.border_bottom_width = Pt(1)
    return para

def add_para(doc, text="", bold=False, italic=False, color=None, size=11, indent=0, bullet=False, space_after=4):
    para = doc.add_paragraph()
    para.paragraph_format.space_after  = Pt(space_after)
    para.paragraph_format.space_before = Pt(2)
    if bullet:
        para.style = doc.styles['List Bullet']
    if indent:
        para.paragraph_format.left_indent = Inches(indent * 0.25)
    run = para.add_run(text)
    set_run_font(run, size=size, bold=bold, italic=italic, color=color)
    return para

def add_field_row(doc, label, type_, description, required=False, default=None):
    """Add a single field description row."""
    para = doc.add_paragraph()
    para.paragraph_format.space_after  = Pt(3)
    para.paragraph_format.space_before = Pt(3)
    para.paragraph_format.left_indent  = Inches(0.25)
    # Label
    r = para.add_run(label)
    set_run_font(r, bold=True, size=10.5, color=DARK)
    # Type badge
    r2 = para.add_run(f"  [{type_}]")
    set_run_font(r2, size=9.5, italic=True, color=BLUE)
    if required:
        r3 = para.add_run("  *Required")
        set_run_font(r3, size=9, color=RED)
    if default:
        r4 = para.add_run(f"  Default: {default}")
        set_run_font(r4, size=9, italic=True, color=GRAY)
    # Description
    r5 = para.add_run(f"\n    → {description}")
    set_run_font(r5, size=10, color=GRAY)

def add_section_box(doc, title, color=None):
    """Section label box."""
    para = doc.add_paragraph()
    para.paragraph_format.space_before = Pt(10)
    para.paragraph_format.space_after  = Pt(4)
    run = para.add_run(f"  ■  {title}  ")
    set_run_font(run, bold=True, size=11, color=color or GREEN)

def add_table(doc, headers, rows, col_widths=None):
    """Add a styled table."""
    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.style = 'Table Grid'
    table.alignment = WD_TABLE_ALIGNMENT.LEFT

    # Header row
    hdr_cells = table.rows[0].cells
    for i, h in enumerate(headers):
        hdr_cells[i].text = h
        hdr_cells[i].paragraphs[0].runs[0].font.bold = True
        hdr_cells[i].paragraphs[0].runs[0].font.color.rgb = WHITE
        hdr_cells[i].paragraphs[0].runs[0].font.size = Pt(10)
        tc = hdr_cells[i]._tc
        tcPr = tc.get_or_add_tcPr()
        shd = OxmlElement('w:shd')
        shd.set(qn('w:val'), 'clear')
        shd.set(qn('w:color'), 'auto')
        shd.set(qn('w:fill'), '2A7A4F')
        tcPr.append(shd)

    # Data rows
    for ri, row in enumerate(rows):
        cells = table.rows[ri + 1].cells
        for ci, val in enumerate(row):
            cells[ci].text = str(val)
            cells[ci].paragraphs[0].runs[0].font.size = Pt(9.5)
            if ri % 2 == 0:
                tc = cells[ci]._tc
                tcPr = tc.get_or_add_tcPr()
                shd = OxmlElement('w:shd')
                shd.set(qn('w:val'), 'clear')
                shd.set(qn('w:color'), 'auto')
                shd.set(qn('w:fill'), 'F3F4F6')
                tcPr.append(shd)

    if col_widths:
        for i, w in enumerate(col_widths):
            for row in table.rows:
                if i < len(row.cells):
                    row.cells[i].width = Inches(w)
    return table

# ══════════════════════════════════════════════════════════════════════════════
#  COVER PAGE
# ══════════════════════════════════════════════════════════════════════════════
para = doc.add_paragraph()
para.alignment = WD_ALIGN_PARAGRAPH.CENTER
para.paragraph_format.space_before = Pt(80)
r = para.add_run("MixBox – Box & Bundle Builder")
set_run_font(r, size=28, bold=True, color=GREEN)

para2 = doc.add_paragraph()
para2.alignment = WD_ALIGN_PARAGRAPH.CENTER
r2 = para2.add_run("Knowledge Base Document")
set_run_font(r2, size=18, color=DARK)

para3 = doc.add_paragraph()
para3.alignment = WD_ALIGN_PARAGRAPH.CENTER
r3 = para3.add_run("Complete Page-by-Page Field & Section Reference")
set_run_font(r3, size=13, italic=True, color=GRAY)

doc.add_paragraph()
para4 = doc.add_paragraph()
para4.alignment = WD_ALIGN_PARAGRAPH.CENTER
r4 = para4.add_run("Version 1.0  |  April 2026  |  Pryxotech")
set_run_font(r4, size=10, color=GRAY)

doc.add_page_break()

# ══════════════════════════════════════════════════════════════════════════════
#  TABLE OF CONTENTS
# ══════════════════════════════════════════════════════════════════════════════
add_heading(doc, "Table of Contents", 1)
toc_items = [
    ("1.", "App Overview & Configuration"),
    ("2.", "Dashboard / Home Page"),
    ("3.", "Manage Boxes Page"),
    ("4.", "Create Simple Box"),
    ("5.", "Create Build-Your-Own Box (Specific Combo)"),
    ("6.", "Edit Simple Box"),
    ("7.", "Edit Build-Your-Own Box"),
    ("8.", "Analytics Page"),
    ("9.", "Widget Settings Page"),
    ("10.", "Pricing / Plan Selection Page"),
    ("11.", "Storefront Widget (Theme App Block)"),
    ("12.", "Data Models & Database Schema"),
    ("13.", "API Endpoints Reference"),
    ("14.", "Billing & Subscription Plans"),
]
for num, title in toc_items:
    para = doc.add_paragraph()
    para.paragraph_format.space_after = Pt(3)
    r_n = para.add_run(f"{num}  ")
    set_run_font(r_n, bold=True, size=11, color=GREEN)
    r_t = para.add_run(title)
    set_run_font(r_t, size=11, color=DARK)

doc.add_page_break()

# ══════════════════════════════════════════════════════════════════════════════
#  1. APP OVERVIEW
# ══════════════════════════════════════════════════════════════════════════════
add_heading(doc, "1. App Overview & Configuration", 1)

add_para(doc, "MixBox – Box & Bundle Builder is a Shopify embedded app that allows merchants to create "
         "combo/bundle boxes. Customers can pick from a curated set of products to fill a box at a "
         "fixed or dynamically calculated price. The app supports two bundle types — Simple (fixed) "
         "and Build-Your-Own (step-by-step customizable).", size=11)

add_heading(doc, "1.1 App Identity", 2)
add_table(doc,
    ["Property", "Value"],
    [
        ["App Name",        "MixBox – Box & Bundle Builder"],
        ["Handle",          "mixbox-box-bundle-builder"],
        ["Client ID",       "335f2a536c3bcb46c4450e5ecaa080b1"],
        ["Shopify API Ver.", "2026-04"],
        ["Embedded",        "Yes (Shopify Admin)"],
        ["Framework",       "React Router v7 + Polaris"],
        ["Database ORM",    "Prisma (MySQL)"],
        ["App Proxy Path",  "/apps/combo-builder"],
        ["Deployed URL",    "https://combo-product-ten.vercel.app/"],
    ],
    [2.2, 4.0]
)

add_heading(doc, "1.2 Access Scopes", 2)
add_para(doc, "The app requires the following Shopify permission scopes:")
scopes = [
    ("write_products",    "Create and update Shopify bundle products"),
    ("read_products",     "Fetch product data for the product picker"),
    ("read_orders",       "Track bundle orders for analytics"),
    ("read_inventory",    "Check stock levels for products"),
    ("read_themes",       "Detect which theme blocks are installed"),
    ("write_themes",      "Deploy the theme app embed block"),
    ("read_publications", "Fetch sales channels for product publishing"),
    ("write_publications","Publish bundle products to sales channels"),
    ("write_discounts",   "Create automatic discount codes for bundles"),
    ("read_discounts",    "Read existing discount configurations"),
]
add_table(doc, ["Scope", "Purpose"], scopes, [2.0, 4.2])

add_heading(doc, "1.3 Webhooks", 2)
webhooks = [
    ("app/uninstalled",          "Clean up shop data on uninstall"),
    ("app/scopes_update",        "Handle permission scope changes"),
    ("app_subscriptions/update", "Sync billing plan changes"),
    ("orders/paid",              "Track bundle orders for analytics"),
    ("customers/data_request",   "GDPR – respond to data requests"),
    ("customers/redact",         "GDPR – erase customer data"),
    ("shop/redact",              "GDPR – erase shop data"),
]
add_table(doc, ["Webhook Topic", "Purpose"], webhooks, [2.5, 3.7])

doc.add_page_break()

# ══════════════════════════════════════════════════════════════════════════════
#  2. DASHBOARD
# ══════════════════════════════════════════════════════════════════════════════
add_heading(doc, "2. Dashboard / Home Page", 1)
add_para(doc, "Route: /app  |  File: app/routes/app._index.jsx", italic=True, color=GRAY, size=10)
add_para(doc, "The Dashboard is the first page merchants see after opening the app. It provides a "
         "high-level overview of their bundle performance, quick action buttons, recent orders, "
         "and setup guidance.", size=11)

add_heading(doc, "2.1 Statistics Cards", 2)
add_para(doc, "Five metric cards appear at the top of the dashboard:")
add_table(doc,
    ["Card", "Metric Shown", "Notes"],
    [
        ["Live",                "Number of currently active boxes",         "Only counts isActive = true boxes"],
        ["Order Credit Left",   "Remaining orders for current billing cycle","Shows 'Unlimited' on Plus plan"],
        ["Orders",              "Bundle orders in last 30 days",            "Links to Analytics page"],
        ["Total Revenue",       "Revenue from bundles (last 30 days)",      "In shop currency"],
        ["Conversion Rate",     "Bundle conversion %",                      "'Unavailable' without order permissions"],
    ],
    [1.8, 2.5, 2.0]
)

add_heading(doc, "2.2 Conditional Banners", 2)
banners = [
    ["Just Subscribed",    "Shown when ?subscribed=1 param present", "Green success tone – confirms plan activation"],
    ["Theme Embed Off",    "Shown when embed block is not active",   "Orange warning – prompts activation"],
    ["Order Limit 80%",    "Shown when 80% of monthly quota used",   "Yellow warning – suggests upgrade"],
    ["Order Limit 100%",   "Shown when monthly quota exhausted",     "Red critical – blocks new orders"],
]
add_table(doc, ["Banner", "Trigger Condition", "Message / Action"], banners, [1.8, 2.5, 2.0])

add_heading(doc, "2.3 Three-Column Info Cards", 2)

add_section_box(doc, "Theme App Embed Status Card")
add_field_row(doc, "Status Badge",   "Badge",  "Shows 'On' (green) if embed block is active in live theme")
add_field_row(doc, "Activate Button","Button", "Opens Shopify Theme Customizer if embed is disabled")

add_section_box(doc, "Theme Widget Setup Card")
add_para(doc, "Numbered step-by-step guide:", indent=1)
steps_setup = [
    "Opens Theme Customization on your live product template.",
    "Combo Builder block is auto-added to the Apps section.",
    "Drag the block to the right position.",
    "Click Save – your storefront is live.",
]
for i, s in enumerate(steps_setup, 1):
    add_para(doc, f"  {i}. {s}", indent=1, size=10.5)
add_field_row(doc, "Open Shopify Theme Editor", "Button (Primary)", "Opens the Shopify theme editor in a new tab")

add_section_box(doc, "Quick Actions Card")
quick_actions = [
    ("Create Bundle Box", "Primary",   "Opens box type selection modal"),
    ("Manage Boxes",      "Secondary", "Navigates to /app/boxes"),
    ("View Analytics",    "Secondary", "Navigates to /app/analytics"),
    ("Widget Settings",   "Secondary", "Navigates to /app/widget-settings"),
]
for label, btn_type, desc in quick_actions:
    add_field_row(doc, label, f"Button ({btn_type})", desc)

add_heading(doc, "2.4 Box Type Selection Modal", 2)
add_para(doc, "Appears when clicking 'Create Bundle Box' or 'Create Box'. Two options:")
add_table(doc,
    ["Option", "Icon", "Description", "Destination"],
    [
        ["Create Simple",           "Package",  "Fixed Shopify product bundle",              "/app/boxes/new"],
        ["Create Build-Your-Own Box","Target",  "Step-by-step customer-customizable bundle", "/app/boxes/specific-combo"],
    ],
    [1.8, 0.8, 2.4, 1.8]
)

add_heading(doc, "2.5 Recent Orders Table", 2)
add_table(doc,
    ["Column", "Content", "Interaction"],
    [
        ["Order ID",  "Order number badge (#1234)",                "Clickable link to Shopify Admin order"],
        ["Name",      "Box title",                                 "Clickable link to Shopify Admin order"],
        ["Type",      "Badge: Specific (purple) or Simple (green)","Visual filter indicator"],
        ["Products",  "First product + '+N more' button",          "Click '+N more' opens items modal"],
        ["Revenue",   "Currency formatted bundle price",           "Green badge style"],
        ["Date",      "Order date (formatted)",                    "—"],
    ],
    [1.2, 1.6, 1.8, 1.8]
)

add_para(doc, "Items Modal: Opens when clicking '+N more' — lists all products in that bundle order with links to Shopify Admin.", indent=1, size=10)

add_heading(doc, "2.6 Support Links Card", 2)
add_para(doc, "Conditionally shown. Provides quick access to:")
for link in ["WhatsApp direct chat", "Support Ticket form", "Knowledge Base", "Leave a Review"]:
    add_para(doc, f"• {link}", indent=1, size=10.5)

doc.add_page_break()

# ══════════════════════════════════════════════════════════════════════════════
#  3. MANAGE BOXES
# ══════════════════════════════════════════════════════════════════════════════
add_heading(doc, "3. Manage Boxes Page", 1)
add_para(doc, "Route: /app/boxes  |  File: app/routes/app.boxes._index.jsx", italic=True, color=GRAY, size=10)
add_para(doc, "The Manage Boxes page lists all bundle boxes created for the shop. "
         "Merchants can search, filter, reorder, toggle status, and delete boxes.", size=11)

add_heading(doc, "3.1 Statistics Row", 2)
add_table(doc,
    ["Stat Card", "Metric"],
    [
        ["Total Boxes",    "Total number of boxes (including inactive)"],
        ["Active Boxes",   "Boxes with isActive = true"],
        ["Inactive Boxes", "Boxes with isActive = false"],
        ["Total Orders",   "Cumulative orders across all boxes"],
    ],
    [2.0, 4.2]
)

add_heading(doc, "3.2 Search & Filter Toolbar", 2)
add_field_row(doc, "Search Field",     "Text Input",       "Filters boxes by name in real time. Placeholder: 'Search box by name...'", required=False)
add_field_row(doc, "All Button",       "Filter Tab",       "Shows all boxes with total count badge")
add_field_row(doc, "Active Button",    "Filter Tab",       "Shows only active boxes with count badge")
add_field_row(doc, "Inactive Button",  "Filter Tab",       "Shows only inactive boxes with count badge")

add_heading(doc, "3.3 Box List Table Columns", 2)
add_table(doc,
    ["Column", "Content", "Interactions"],
    [
        ["Name",    "Box avatar + Name (bold) + Gift icon if gift box",  "—"],
        ["Code",    "5-digit box code as blue badge",                    "Copy icon copies code to clipboard"],
        ["Price",   "Manual: currency amount. Dynamic: discount label",  "—"],
        ["Type",    "Badge: 'Specific' (purple) or 'Simple' (green)",    "—"],
        ["Orders",  "Order count with icon",                             "—"],
        ["Status",  "Toggle switch ON/OFF",                              "Click to toggle isActive"],
        ["Actions", "Eye / Edit / Delete icons",                         "Eye=Preview, Edit=Edit page, Delete=Confirm modal"],
    ],
    [1.2, 1.5, 2.2, 1.6]
)

add_heading(doc, "3.4 Price Display Formats", 2)
add_table(doc,
    ["Price Type", "Display Format", "Example"],
    [
        ["Manual",          "Currency formatted fixed price",         "₹999.00"],
        ["Dynamic – Percent","'{N}% off'",                            "15% off"],
        ["Dynamic – Fixed", "'{Currency}{N} off'",                   "₹100 off"],
        ["Dynamic – BXGY",  "'Buy {N} Get {N} Free'",                "Buy 3 Get 1 Free"],
    ],
    [1.8, 2.2, 2.2]
)

add_heading(doc, "3.5 Action Buttons (per row)", 2)
add_field_row(doc, "Eye Icon",    "Button", "Opens box preview on storefront. Disabled if no preview URL is configured.")
add_field_row(doc, "Edit Icon",   "Button", "Navigates to the edit page for that box (/app/boxes/{id})")
add_field_row(doc, "Delete Icon", "Button (Destructive)", "Only shown if box has 0 orders. Opens delete confirmation modal.")

add_heading(doc, "3.6 Delete Confirmation Modal", 2)
add_para(doc, "Triggered by: Delete icon on a box with 0 orders")
add_field_row(doc, "Modal Title",   "Text",            "'Delete box?'")
add_field_row(doc, "Message",       "Text",            "'Are you sure you want to delete \"{box name}\"? Its Shopify product will be permanently removed.'")
add_field_row(doc, "Delete Button", "Destructive CTA", "Permanently deletes box and its linked Shopify product")
add_field_row(doc, "Cancel Button", "Secondary",       "Closes modal with no changes")

add_heading(doc, "3.7 Pagination", 2)
add_para(doc, "Displays: 'Showing {start}–{end} of {total} boxes (Page {page} of {pages})' "
         "with Previous and Next navigation buttons.")

doc.add_page_break()

# ══════════════════════════════════════════════════════════════════════════════
#  4. CREATE SIMPLE BOX
# ══════════════════════════════════════════════════════════════════════════════
add_heading(doc, "4. Create Simple Box", 1)
add_para(doc, "Route: /app/boxes/new  |  File: app/routes/app.boxes.new.jsx", italic=True, color=GRAY, size=10)
add_para(doc, "This page allows merchants to create a Simple (fixed) bundle box. A Shopify product "
         "is automatically created and linked to the box upon saving.", size=11)

add_heading(doc, "4.1 Bundle Details Card", 2)
add_field_row(doc, "Box Name",         "Text",   "Internal identifier for this bundle. Shown only in admin.",       required=True)
add_field_row(doc, "Display Title",    "Text",   "Customer-facing title shown on the storefront widget.",           required=True)
add_field_row(doc, "Bundle Price",     "Number", "Fixed price for the bundle or starting price if dynamic pricing.  Min: 0.", required=True)
add_field_row(doc, "Bundle Price Type","Select", "Manual = fixed price | Dynamic = price calculated from discount rules")
add_field_row(doc, "Items Count",      "Number", "Number of products the customer must select to fill the box. Min: 1, Max: 20.", required=True, default="1")
add_field_row(doc, "Banner Image",     "File Upload (DropZone)", "Optional hero image for the box. Max 5MB. Accepted: JPG, PNG, WEBP, GIF, AVIF.")

add_heading(doc, "4.2 Dynamic Pricing Sub-fields", 2)
add_para(doc, "Shown only when Bundle Price Type = 'Dynamic':")
add_field_row(doc, "Discount Type",  "Select", "Options: None | Percent off | Fixed amount | Buy X Get Y Free")
add_field_row(doc, "Discount Value", "Number", "Percentage (0–100) or fixed amount to subtract. Hidden for BXGY type.")
add_field_row(doc, "Buy Quantity",   "Number", "For BXGY only: number of products to buy.")
add_field_row(doc, "Get Quantity",   "Number", "For BXGY only: number of free products given.")

add_heading(doc, "4.3 Features Card", 2)
add_field_row(doc, "Is Gift Box",           "Toggle (Boolean)", "Marks box as a gift box. Enables gift-related features.",           default="Off")
add_field_row(doc, "Allow Duplicates",      "Toggle (Boolean)", "Lets customers select the same product more than once.",            default="Off")
add_field_row(doc, "Gift Message Enabled",  "Toggle (Boolean)", "Shows a gift message text area at checkout. Requires Is Gift Box.", default="Off")

add_heading(doc, "4.4 Button Customization Card", 2)
add_field_row(doc, "Combo Button Title",   "Text", "Label for the main CTA button. Shown on the widget.",   default="BUILD YOUR OWN BOX")
add_field_row(doc, "Product Button Title", "Text", "Label on each product card's add button.",              default="ADD TO BOX")

add_heading(doc, "4.5 Scope Selection Card", 2)
add_para(doc, "Defines which products customers can choose from:")
add_field_row(doc, "Whole Store",           "Scope Option", "All products in the shop (excluding ComboBuilder vendor products) are eligible.")
add_field_row(doc, "Specific Collections",  "Scope Option", "Only products from selected collections are shown.")
add_field_row(doc, "Eligible Products",     "Scope Option", "Merchant manually selects individual products.")

add_heading(doc, "4.6 Product / Collection Picker", 2)
add_para(doc, "Shown when scope is Specific Collections or Eligible Products:")
add_field_row(doc, "Search Field",           "Text",     "Search products or collections by name.")
add_field_row(doc, "Collection/Product List","Checkbox", "Multi-select list with name, image, and price (products) or product count (collections).")
add_field_row(doc, "Selected Items",         "Display",  "Shows selected items as removable tags below the picker.")

add_heading(doc, "4.7 Form Actions", 2)
add_field_row(doc, "Save & Continue", "Button (Primary)",   "Creates the box, generates a Shopify product, and redirects to the edit page.")
add_field_row(doc, "Cancel",          "Button (Secondary)", "Discards changes and returns to the Manage Boxes list.")

add_heading(doc, "4.8 Validation Rules", 2)
add_table(doc,
    ["Field", "Validation Rule"],
    [
        ["Display Title",    "Required – cannot be empty"],
        ["Box Name",         "Required – auto-populates from Display Title if left blank"],
        ["Bundle Price",     "Must be ≥ 0"],
        ["Items Count",      "Must be between 1 and 20"],
        ["Discount Value",   "0–100 for percent; any positive number for fixed"],
        ["Scope Products",   "At least 1 product/collection when scope is not Whole Store"],
        ["Banner Image",     "Max 5MB; must be JPG/PNG/WEBP/GIF/AVIF"],
    ],
    [2.0, 4.2]
)

doc.add_page_break()

# ══════════════════════════════════════════════════════════════════════════════
#  5. CREATE BUILD-YOUR-OWN BOX
# ══════════════════════════════════════════════════════════════════════════════
add_heading(doc, "5. Create Build-Your-Own Box (Specific Combo)", 1)
add_para(doc, "Route: /app/boxes/specific-combo  |  File: app/routes/app.boxes.specific-combo.jsx", italic=True, color=GRAY, size=10)
add_para(doc, "A multi-tab wizard for creating a fully customizable, step-by-step bundle builder. "
         "Customers will walk through each step on the storefront and pick one product per step.", size=11)

add_heading(doc, "5.1 Tab Overview", 2)
add_table(doc,
    ["Tab #", "Tab Name", "Purpose"],
    [
        ["1", "Box Details",        "Name, image, title, and global settings"],
        ["2", "Steps Configuration","Define 2–8 steps, each with its own products"],
        ["3", "Pricing & Discounts","Set price type and discount rules"],
        ["4", "Review & Publish",   "Summary review before creating the box"],
    ],
    [0.6, 1.8, 3.8]
)

add_heading(doc, "5.2 Tab 1 — Box Details", 2)
add_field_row(doc, "Box Name",             "Text",    "Internal name. Not shown to customers.",              required=True)
add_field_row(doc, "Display Title",        "Text",    "Main heading shown to customers on storefront.",      required=True)
add_field_row(doc, "Subtitle",             "Text",    "Supporting tagline below the title on storefront.")
add_field_row(doc, "Banner Image",         "DropZone","Hero image. Max 5MB. Types: JPG/PNG/WEBP/GIF/AVIF.")
add_field_row(doc, "Is Active",            "Toggle",  "Publish this box on the storefront.",                 default="Off")
add_field_row(doc, "Is Gift Box",          "Toggle",  "Enables gift-wrap and message features.",             default="Off")
add_field_row(doc, "Gift Message Enabled", "Toggle",  "Shows message input to customer. Requires Is Gift Box.", default="Off")
add_field_row(doc, "Allow Duplicates",     "Toggle",  "Customers can select same product across multiple steps.", default="Off")

add_heading(doc, "5.3 Tab 2 — Steps Configuration", 2)
add_field_row(doc, "Number of Steps", "Select (2–8)", "Defines how many selection steps the customer goes through.", required=True, default="2")
add_para(doc, "\nFor each step, the following fields are available:", size=11)
add_field_row(doc, "Step Label",            "Text",    "Customer-facing label for this step. Shown in step progress bar.", default="Step N")
add_field_row(doc, "Step Image",            "DropZone","Optional image for this step (Max 2MB). Shown on product cards.")
add_field_row(doc, "Optional Step",         "Toggle",  "If enabled, customer can skip this step.",            default="Off")
add_field_row(doc, "Scope",                 "Select",  "Products = specific product list | Collections = one or more collections")
add_field_row(doc, "Product / Collection Picker", "Multi-select", "Choose which products/collections are available in this step.")
add_field_row(doc, "Popup Title",           "Text",    "Heading in the product selection modal.",             default="Choose product for {Step Label}")
add_field_row(doc, "Popup Description",     "Text",    "Body text in the product selection modal.",           default="Select a product for this step.")
add_field_row(doc, "Confirm Button Label",  "Text",    "Button text in the selection modal.",                 default="Confirm selection")

add_heading(doc, "5.4 Tab 3 — Pricing & Discounts", 2)
add_field_row(doc, "Bundle Price",  "Currency Number", "Starting or fixed price for the bundle.",             required=True)
add_field_row(doc, "Price Type",    "Toggle",          "Manual = fixed price | Dynamic = calculated at checkout")
add_field_row(doc, "Discount Type", "Select",          "None | Percent off | Fixed amount. Shown only when Price Type = Dynamic.")
add_field_row(doc, "Discount Value","Number",          "Discount percentage (0–100) or fixed amount.")
add_field_row(doc, "CTA Button Label",         "Text", "Main call-to-action button label on the widget.",   default="BUILD YOUR OWN BOX")
add_field_row(doc, "Add to Cart Button Label", "Text", "Final add-to-cart button label.",                   default="Add To Cart")

add_heading(doc, "5.5 Tab 4 — Review & Publish", 2)
add_para(doc, "A read-only summary card showing:")
for item in ["Box name", "Number of steps", "Price type and discount", "Step labels and thumbnails"]:
    add_para(doc, f"• {item}", indent=1, size=10.5)
add_field_row(doc, "Back to Steps", "Button (Secondary)", "Returns to Tab 2 for editing")
add_field_row(doc, "Publish",       "Button (Primary)",   "Creates the box. Redirects to the edit page for further configuration.")

doc.add_page_break()

# ══════════════════════════════════════════════════════════════════════════════
#  6. EDIT SIMPLE BOX
# ══════════════════════════════════════════════════════════════════════════════
add_heading(doc, "6. Edit Simple Box", 1)
add_para(doc, "Route: /app/boxes/{id}  |  File: app/routes/app.boxes.$id.jsx", italic=True, color=GRAY, size=10)
add_para(doc, "The Edit page contains all the same fields as Create Simple Box (Section 4), "
         "pre-populated with the saved values. The key differences are listed below.", size=11)

add_heading(doc, "6.1 Differences from Create", 2)
add_table(doc,
    ["Aspect", "Create", "Edit"],
    [
        ["Page title",        "'Create Bundle Box'",              "'Edit {Box Name}'"],
        ["Submit action",     "Creates new box + Shopify product","Updates existing box + syncs to Shopify"],
        ["Delete button",     "Not present",                      "Available if box has 0 orders"],
        ["Code field",        "Generated on save",                "Displayed as read-only badge"],
        ["Redirect on save",  "Goes to edit page",               "Stays on edit page with success toast"],
    ],
    [1.8, 2.2, 2.2]
)

add_heading(doc, "6.2 All Form Fields", 2)
add_para(doc, "Refer to Section 4 (Create Simple Box) for the full list of fields — "
         "all fields are identical with pre-filled values from the database.", size=11)

add_heading(doc, "6.3 Page Actions", 2)
add_field_row(doc, "Save Changes", "Button (Primary)",   "Updates box in DB and syncs the Shopify product title/price.")
add_field_row(doc, "Delete Box",   "Button (Destructive)","Soft-deletes the box. Shown only if the box has 0 orders.")
add_field_row(doc, "Cancel",       "Button (Secondary)", "Discards unsaved changes and returns to Manage Boxes.")

doc.add_page_break()

# ══════════════════════════════════════════════════════════════════════════════
#  7. EDIT BUILD-YOUR-OWN BOX
# ══════════════════════════════════════════════════════════════════════════════
add_heading(doc, "7. Edit Build-Your-Own Box", 1)
add_para(doc, "Route: /app/boxes/{id}/combo  |  File: app/routes/app.boxes.$id.combo.jsx", italic=True, color=GRAY, size=10)
add_para(doc, "Contains the same four tabs as Create Build-Your-Own Box (Section 5), "
         "plus two additional tabs: Storefront Display and Preview.", size=11)

add_heading(doc, "7.1 Tab 5 — Storefront Display", 2)
add_field_row(doc, "Show Product Images", "Toggle", "Display product photos inside each step card on the storefront.",   default="On")
add_field_row(doc, "Show Progress Bar",   "Toggle", "Show a step-completion progress indicator at the top of the widget.", default="On")
add_field_row(doc, "Allow Reselection",   "Toggle", "Let customers go back and change a previously selected step.",       default="Off")
add_field_row(doc, "Highlight Text",      "Text",   "Optional promotional text displayed prominently on the widget.")
add_field_row(doc, "Support Text",        "Text",   "Help / guidance text shown to customers below the widget.")

add_heading(doc, "7.2 Tab 6 — Preview", 2)
add_para(doc, "An embedded live preview of the storefront widget. Shows:")
for item in [
    "Step-by-step product selection flow",
    "Progress bar",
    "Live price calculations as selections change",
    "Cart/Checkout button behavior",
]:
    add_para(doc, f"• {item}", indent=1, size=10.5)
add_para(doc, "Note: Preview is read-only and not editable from this tab.", italic=True, size=10, color=GRAY)

doc.add_page_break()

# ══════════════════════════════════════════════════════════════════════════════
#  8. ANALYTICS
# ══════════════════════════════════════════════════════════════════════════════
add_heading(doc, "8. Analytics Page", 1)
add_para(doc, "Route: /app/analytics  |  File: app/routes/app.analytics.jsx", italic=True, color=GRAY, size=10)
add_para(doc, "Provides detailed performance data for all bundle sales. All charts are built "
         "with pure SVG/CSS — no external chart libraries.", size=11)

add_heading(doc, "8.1 Filters & Date Range", 2)
add_field_row(doc, "Date Range Picker", "Select / Date Input", "Preset options: Last 30 days, Last 90 days, All time, Custom range", default="Last 30 days")
add_field_row(doc, "Combo Type Filter", "Select",              "All | Simple only | Specific only")

add_heading(doc, "8.2 Metrics Cards (Row 1)", 2)
add_table(doc,
    ["Metric Card", "Value Shown", "Comparison"],
    [
        ["Total Orders",         "Count of bundle orders in period",           "±% vs previous period"],
        ["Total Revenue",        "Sum of bundle prices in period",             "±% vs previous period"],
        ["Average Bundle Value", "Revenue ÷ Orders",                          "—"],
        ["Active Boxes",         "Current count of active boxes",              "—"],
    ],
    [2.0, 2.4, 1.8]
)

add_heading(doc, "8.3 Charts", 2)
add_section_box(doc, "Daily Trend Chart")
add_para(doc, "SVG line/bar chart showing daily revenue and order count over the selected period. "
         "Compares current period vs previous period.", indent=1, size=10.5)

add_section_box(doc, "Top 10 Products Chart")
add_para(doc, "Horizontal bar chart listing the 10 most frequently selected products in bundles "
         "with their selection counts.", indent=1, size=10.5)

add_section_box(doc, "Box Performance Table")
add_table(doc,
    ["Column", "Content"],
    [
        ["Box Name",    "Name of the bundle box"],
        ["Orders",      "Total orders for this box in the period"],
        ["Revenue",     "Total revenue from this box"],
        ["% of Total",  "This box's share of total revenue"],
    ],
    [1.8, 4.4]
)

add_heading(doc, "8.4 Recent Orders Table", 2)
add_para(doc, "Shows the 10 most recent bundle orders. Same columns as the Dashboard Recent Orders table (see Section 2.5). Paginated with prev/next controls.")

doc.add_page_break()

# ══════════════════════════════════════════════════════════════════════════════
#  9. WIDGET SETTINGS
# ══════════════════════════════════════════════════════════════════════════════
add_heading(doc, "9. Widget Settings Page", 1)
add_para(doc, "Route: /app/widget-settings  |  File: app/routes/app.widget-settings.jsx", italic=True, color=GRAY, size=10)
add_para(doc, "Controls the visual appearance and behavior of the combo-builder widget "
         "displayed on the merchant's storefront.", size=11)

add_heading(doc, "9.1 Theme Customizer Card", 2)
add_field_row(doc, "Preset Color Buttons (5)", "Buttons",        "Quick-apply preset color pairs: Forest, Ocean, Sunset, Plum, Rose")
add_field_row(doc, "Primary Color",            "Color Picker + Hex Input", "Main brand color used for buttons and accents.",    default="#2A7A4F")
add_field_row(doc, "Secondary Color",          "Color Picker + Hex Input", "Supporting color for hover states and highlights.")

add_para(doc, "\nPreset Themes Detail:", bold=True, size=10.5)
add_table(doc,
    ["Preset Name", "Primary Color"],
    [
        ["Forest",  "#2A7A4F / #14532D"],
        ["Ocean",   "#0E7490 / #164E63"],
        ["Sunset",  "#EA580C / #9A3412"],
        ["Plum",    "#7C3AED / #4C1D95"],
        ["Rose",    "#E11D48 / #9F1239"],
    ],
    [2.0, 4.2]
)

add_heading(doc, "9.2 Widget Width Card", 2)
add_field_row(doc, "Preset Width Buttons (5)", "Buttons", "Quick-select widths: Full Width (100%), Narrow (860px), Default (1140px), Wide (1400px), Full HD (1920px)")
add_field_row(doc, "Custom Width",             "Number",  "Enter any pixel width. Applied as max-width on the widget container.")

add_heading(doc, "9.3 Product Cards Card", 2)
add_field_row(doc, "Show Savings Badge",       "Toggle", "Show a discount/savings badge on product cards.",   default="On")
add_field_row(doc, "Show Product Prices",      "Toggle", "Display individual product prices on cards.",       default="On")
add_field_row(doc, "Force Show Out of Stock",  "Toggle", "Show OOS products even if inventory = 0.",          default="Off")
add_field_row(doc, "Product Cards Per Row",    "Select", "Number of product cards per row. Options: 3, 4, 5, 6.", default="4")
add_field_row(doc, "Layout Mode",              "Select", "Grid = all products at once | Steps = one at a time (for specific combo)", default="Grid")

add_heading(doc, "9.4 Additional Settings Card", 2)
add_field_row(doc, "Email Notifications", "Toggle", "Receive email when a bundle order is placed.",  default="Off")
add_field_row(doc, "Analytics Tracking",  "Toggle", "Track storefront interaction events.",           default="On")

add_heading(doc, "9.5 Page Action", 2)
add_field_row(doc, "Save Settings", "Button (Primary)", "Saves all widget settings. Shows loading spinner during save. Displays success banner on completion.")

doc.add_page_break()

# ══════════════════════════════════════════════════════════════════════════════
#  10. PRICING PAGE
# ══════════════════════════════════════════════════════════════════════════════
add_heading(doc, "10. Pricing / Plan Selection Page", 1)
add_para(doc, "Route: /app/pricing  |  File: app/routes/app.pricing.jsx", italic=True, color=GRAY, size=10)
add_para(doc, "Merchants select or upgrade their billing plan here. Billing is handled by "
         "Shopify's native billing API.", size=11)

add_heading(doc, "10.1 Current Plan Display", 2)
add_para(doc, "A badge at the top shows the active plan name: FREE | BASIC | ADVANCE | PLUS")

add_heading(doc, "10.2 Plan Cards", 2)
add_table(doc,
    ["Plan",    "Monthly Price", "Order Limit",  "Key Features"],
    [
        ["FREE",    "₹0",         "10 orders/mo",   "1 box, basic bundling"],
        ["Basic",   "₹7.99/mo",   "50 orders/mo",   "5 boxes, analytics, custom colors"],
        ["Advance", "₹12.99/mo",  "100 orders/mo",  "All Basic + Build-Your-Own boxes, advanced analytics"],
        ["Plus",    "₹24.99/mo",  "Unlimited",      "All Advance + Unlimited boxes, priority support"],
    ],
    [1.0, 1.4, 1.4, 2.4]
)

add_heading(doc, "10.3 Plan Card Fields", 2)
add_field_row(doc, "Plan Name",        "Heading",         "FREE / Basic / Advance / Plus")
add_field_row(doc, "Price",            "Currency Display","Monthly price in shop currency")
add_field_row(doc, "Order Limit",      "Text Badge",      "'N orders/month' or 'Unlimited'")
add_field_row(doc, "Features List",    "Bulleted List",   "Highlights what's included in this plan")
add_field_row(doc, "Select Plan CTA",  "Button (Primary)","Initiates Shopify billing checkout for this plan")
add_field_row(doc, "Current Plan Badge","Badge (Disabled)","Shown on the active plan card — button is disabled")

add_heading(doc, "10.4 Billing Flow", 2)
add_table(doc,
    ["Step", "What Happens"],
    [
        ["1 – Click Plan",          "User clicks 'Select Plan' or 'Upgrade'"],
        ["2 – Shopify Billing",     "Redirected to Shopify billing confirmation page"],
        ["3 – Approve",             "Merchant approves charge in Shopify Admin"],
        ["4 – Callback",            "Redirected back to /app?subscribed=1"],
        ["5 – Success Banner",      "Dashboard shows 'Plan activated: {Plan Name}' banner"],
    ],
    [2.0, 4.2]
)

add_heading(doc, "10.5 Order Limit Warnings", 2)
add_table(doc,
    ["Threshold", "Banner Type", "Message"],
    [
        ["80% usage",   "Warning (yellow)", "Approaching order limit — consider upgrading"],
        ["100% usage",  "Critical (red)",   "Order limit reached — new bundle orders blocked until next cycle"],
    ],
    [1.4, 1.8, 3.0]
)

doc.add_page_break()

# ══════════════════════════════════════════════════════════════════════════════
#  11. STOREFRONT WIDGET
# ══════════════════════════════════════════════════════════════════════════════
add_heading(doc, "11. Storefront Widget (Theme App Block)", 1)
add_para(doc, "Files: extensions/combo-product/blocks/combo-builder.liquid  |  assets/combo-builder.js", italic=True, color=GRAY, size=10)
add_para(doc, "The storefront widget is a vanilla JavaScript + CSS app block that renders the "
         "combo builder UI on the merchant's Shopify storefront. It is added via the Shopify "
         "Theme Customizer and communicates with the app server via the app proxy.", size=11)

add_heading(doc, "11.1 Theme Block Settings", 2)
add_para(doc, "These settings are configurable in the Shopify Theme Customizer by the merchant:")
add_field_row(doc, "layout_mode",       "Select",   "Grid = all products visible | Steps = one product at a time",     default="grid")
add_field_row(doc, "enable_sticky_cart","Checkbox", "Show a sticky cart bar pinned to the bottom of the page.",         default="false")
add_field_row(doc, "box_filter",        "Select",   "all = show all active boxes | specific = show only listed boxes", default="all")
add_field_row(doc, "box_names",         "Text",     "Comma-separated box IDs or names. Used when box_filter = specific.")
add_field_row(doc, "cart_btn_label",    "Text",     "Label for the Add to Cart button.",                                default="Add To Cart")
add_field_row(doc, "checkout_btn_label","Text",     "Label for the Checkout button.",                                   default="Checkout")
add_field_row(doc, "step1_label",       "Text",     "Label for Step 1.",                                               default="Select Box")
add_field_row(doc, "step2_label",       "Text",     "Label for Step 2.",                                               default="Pick Items")
add_field_row(doc, "step3_label",       "Text",     "Label for Step 3.",                                               default="Add to Cart")
add_field_row(doc, "step1_heading",     "Text",     "Heading text displayed inside Step 1.",                           default="Step 1: Select your box")
add_field_row(doc, "step2_heading",     "Text",     "Heading text displayed inside Step 2.")
add_field_row(doc, "step3_heading",     "Text",     "Heading text displayed inside Step 3.")

add_heading(doc, "11.2 Dynamic Pricing Functions", 2)
add_table(doc,
    ["Function", "Description"],
    [
        ["formatPrice(amount, symbol, code)",                   "Formats price with Intl.NumberFormat and currency fallback"],
        ["isDynamicBundlePrice(box)",                           "Returns true if bundle uses dynamic pricing"],
        ["getComboDiscountBreakdown(total, config, items)",     "Returns { discountedTotal, discountAmount, freeUnits }"],
        ["getBuyXGetYFreeUnits(totalQty, buyQty, getQty)",     "Calculates free unit count for BXGY discount"],
        ["applyComboDiscount(price, config, items)",            "Returns final discounted total price"],
    ],
    [2.8, 3.4]
)

add_heading(doc, "11.3 CSS Variables (Theming)", 2)
add_table(doc,
    ["CSS Variable", "Controls"],
    [
        ["--cb-primary",           "Main brand color (buttons, active states)"],
        ["--cb-primary-hover",     "Hover state for primary elements"],
        ["--cb-primary-light",     "Light variant for backgrounds"],
        ["--cb-bg",                "Widget background color"],
        ["--cb-text",              "Main text color"],
        ["--cb-text-muted",        "Secondary / caption text"],
        ["--cb-border",            "Card and container border color"],
        ["--cb-product-card-bg",   "Product card background"],
        ["--cb-product-btn-bg",    "Product card button background"],
        ["--cb-product-btn-text",  "Product card button text color"],
    ],
    [2.0, 4.2]
)

add_heading(doc, "11.4 Built-in Themes", 2)
themes = [
    "oh-so-minimal","fresh-gradient","aqua","golden-hour","sharp-edge",
    "poseidon","sand-dunes","bubblegum","cape-town","blackout",
    "urban-underground","cyber-pink","key-lime-pie","lemonade","nile",
    "lavender","magma-lake","smooth-silk","custom (user-defined)"
]
add_para(doc, "20 built-in preset themes available (selectable in Widget Settings):")
for t in themes:
    add_para(doc, f"• {t}", indent=1, size=10)

doc.add_page_break()

# ══════════════════════════════════════════════════════════════════════════════
#  12. DATA MODELS
# ══════════════════════════════════════════════════════════════════════════════
add_heading(doc, "12. Data Models & Database Schema", 1)
add_para(doc, "The app uses Prisma ORM with a MySQL database. Below are the core data models.", size=11)

add_heading(doc, "12.1 ComboBox (Main Box Record)", 2)
add_table(doc,
    ["Field", "Type", "Description"],
    [
        ["id",                  "Integer (PK, auto)",   "Unique box identifier"],
        ["shop",                "String",               "Shop permanent domain (FK)"],
        ["boxCode",             "String (unique)",      "5-digit merchant-facing code"],
        ["boxName",             "String",               "Internal name"],
        ["displayTitle",        "String",               "Customer-facing title"],
        ["itemCount",           "Integer",              "Number of products to fill the box"],
        ["bundlePrice",         "Decimal",              "Fixed or base price"],
        ["bundlePriceType",     "Enum",                 "'manual' or 'dynamic'"],
        ["isGiftBox",           "Boolean",              "Is this a gift box?"],
        ["allowDuplicates",     "Boolean",              "Can same product be selected twice?"],
        ["isActive",            "Boolean",              "Is box live on storefront?"],
        ["giftMessageEnabled",  "Boolean",              "Show gift message field?"],
        ["sortOrder",           "Integer",              "Display order in box list"],
        ["deletedAt",           "DateTime (nullable)",  "Soft-delete timestamp"],
        ["shopifyProductId",    "String (nullable)",    "Linked Shopify Product GID"],
        ["shopifyVariantId",    "String (nullable)",    "Linked Shopify Variant GID"],
        ["shopifyDiscountId",   "String (nullable)",    "Linked Shopify Discount GID"],
        ["bannerImageUrl",      "String (nullable)",    "CDN URL of banner image"],
        ["scopeType",           "Enum",                 "'wholestore' or 'specific_collections'"],
        ["scopeItemsJson",      "String (nullable)",    "JSON array of collection/product IDs"],
        ["comboStepsConfig",    "String (nullable)",    "JSON config for specific combo steps"],
        ["comboButtonTitle",    "String (nullable)",    "Custom CTA button text"],
        ["productButtonTitle",  "String (nullable)",    "Custom product card button text"],
        ["createdAt",           "DateTime",             "Record creation timestamp"],
        ["updatedAt",           "DateTime",             "Last modification timestamp"],
    ],
    [1.8, 1.4, 3.0]
)

add_heading(doc, "12.2 ComboBoxProduct (Eligible Products)", 2)
add_table(doc,
    ["Field", "Type", "Description"],
    [
        ["id",               "Integer (PK)",   "Auto-increment"],
        ["boxId",            "Integer (FK)",   "References ComboBox.id"],
        ["productId",        "String",         "Shopify Product GID"],
        ["productTitle",     "String",         "Product name at time of selection"],
        ["productImageUrl",  "String (null)",  "Product image URL"],
        ["productHandle",    "String (null)",  "Shopify product URL handle"],
        ["productPrice",     "Decimal (null)", "Product price"],
        ["variantIds",       "String (null)",  "JSON array of available variant GIDs"],
    ],
    [1.6, 1.4, 3.2]
)

add_heading(doc, "12.3 BundleOrder (Order Tracking)", 2)
add_table(doc,
    ["Field", "Type", "Description"],
    [
        ["id",               "Integer (PK)",   "Auto-increment"],
        ["shop",             "String",         "Shop domain"],
        ["orderId",          "String",         "Shopify Order GID"],
        ["orderName",        "String (null)",  "Human-readable order name (#1001)"],
        ["orderNumber",      "Integer (null)", "Shopify order number"],
        ["boxId",            "Integer (FK)",   "References ComboBox.id"],
        ["selectedProducts", "String",         "JSON array of selected product IDs/names"],
        ["bundlePrice",      "Decimal",        "Price charged for this bundle"],
        ["giftMessage",      "String (null)",  "Customer's gift message if provided"],
        ["orderDate",        "DateTime",       "When the order was placed"],
        ["customerId",       "String (null)",  "Shopify Customer GID"],
    ],
    [1.6, 1.4, 3.2]
)

add_heading(doc, "12.4 AppSettings (Widget Configuration)", 2)
add_table(doc,
    ["Field", "Type", "Description"],
    [
        ["shop",                 "String (PK)",   "Shop permanent domain"],
        ["buttonColor",          "String",        "Primary button hex color"],
        ["activeSlotColor",      "String",        "Selected slot highlight color"],
        ["showSavingsBadge",     "Boolean",       "Show savings badge on cards"],
        ["allowDuplicates",      "Boolean",       "Global duplicate selection setting"],
        ["showProductPrices",    "Boolean",       "Show prices on product cards"],
        ["forceShowOos",         "Boolean",       "Show OOS products"],
        ["giftMessageField",     "Boolean",       "Show gift message input"],
        ["analyticsTracking",    "Boolean",       "Enable storefront event tracking"],
        ["emailNotifications",   "Boolean",       "Email on bundle order"],
        ["widgetMaxWidth",       "Integer",       "Max width in pixels"],
        ["productCardsPerRow",   "Integer",       "Cards per row (3–6)"],
        ["presetTheme",          "String",        "Active theme name or 'custom'"],
    ],
    [1.8, 1.2, 3.2]
)

doc.add_page_break()

# ══════════════════════════════════════════════════════════════════════════════
#  13. API ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════
add_heading(doc, "13. API Endpoints Reference", 1)
add_para(doc, "The app exposes both Admin (authenticated) and Storefront (public, via App Proxy) API routes.", size=11)

add_heading(doc, "13.1 Admin API Routes", 2)
add_table(doc,
    ["Method", "Endpoint", "Purpose"],
    [
        ["POST",   "/api/admin/boxes",               "Create new box"],
        ["PATCH",  "/api/admin/boxes/{id}",          "Update existing box"],
        ["DELETE", "/api/admin/boxes/{id}",          "Soft-delete box"],
        ["GET",    "/api/admin/boxes",               "List all boxes for shop"],
        ["POST",   "/api/admin/boxes/reorder",       "Update box sort order"],
        ["POST",   "/api/admin/boxes/{id}/config",   "Upsert specific-combo config"],
        ["POST",   "/api/admin/boxes/{id}/images",   "Upload step images"],
        ["POST",   "/api/admin/analytics",           "Get analytics for date range"],
        ["POST",   "/api/admin/settings",            "Upsert widget settings"],
        ["POST",   "/api/admin/sync-orders",         "Sync paid orders from Shopify"],
    ],
    [0.8, 2.6, 2.8]
)

add_heading(doc, "13.2 Storefront API Routes (App Proxy)", 2)
add_table(doc,
    ["Method", "Endpoint", "Purpose"],
    [
        ["GET",  "/api/storefront/boxes",                            "List active boxes for storefront"],
        ["GET",  "/api/storefront/boxes/{id}/products",             "Get products for a box/step"],
        ["GET",  "/api/storefront/boxes/{id}/banner",               "Get box banner image blob"],
        ["POST", "/api/storefront/boxes/{id}/variant",              "Resolve product variant GID"],
        ["POST", "/api/storefront/boxes/{id}/update-price",         "Calculate dynamic bundle price"],
        ["GET",  "/api/storefront/boxes/{id}/step-image/{stepIndex}","Get step image blob"],
    ],
    [0.8, 3.0, 2.4]
)

doc.add_page_break()

# ══════════════════════════════════════════════════════════════════════════════
#  14. BILLING & PLANS
# ══════════════════════════════════════════════════════════════════════════════
add_heading(doc, "14. Billing & Subscription Plans", 1)
add_para(doc, "Billing is managed entirely through Shopify's native billing API. "
         "Plans are registered as recurring application charges.", size=11)

add_heading(doc, "14.1 Plan Comparison", 2)
add_table(doc,
    ["Plan", "Price (Monthly)", "Order Limit", "Max Boxes", "Key Feature"],
    [
        ["FREE",    "₹0",         "10/month",   "1",         "Basic simple bundling"],
        ["Basic",   "₹7.99",      "50/month",   "5",         "Analytics + custom colors"],
        ["Advance", "₹12.99",     "100/month",  "Unlimited", "Build-Your-Own boxes"],
        ["Plus",    "₹24.99",     "Unlimited",  "Unlimited", "Priority support"],
    ],
    [1.0, 1.4, 1.2, 1.2, 2.4]
)

add_heading(doc, "14.2 Important Billing Rules", 2)
rules = [
    "Plan names registered with Shopify must match exactly: 'Basic', 'Advance', 'Plus'.",
    "Order limits reset at the start of each billing cycle (monthly).",
    "Orders are counted at the time of webhook receipt (orders/paid).",
    "Merchants on FREE plan who reach 10 orders/month cannot process new bundles.",
    "Upgrading plan immediately increases the limit — no waiting period.",
    "Downgrading takes effect at the next billing cycle.",
    "All plans billed in USD regardless of shop currency.",
]
for rule in rules:
    add_para(doc, f"• {rule}", indent=1, size=10.5)

add_heading(doc, "14.3 Order Limit Warning System", 2)
add_table(doc,
    ["Threshold", "UI Warning", "Location"],
    [
        ["80% used",  "Yellow warning banner",  "Dashboard top banner area"],
        ["100% used", "Red critical banner",    "Dashboard top + nav bar"],
    ],
    [1.4, 2.0, 2.8]
)

add_heading(doc, "14.4 Legacy Plan Support", 2)
add_para(doc, "The 'PRO' plan key is recognized as a legacy paid plan. "
         "The isPaidPlanActive() function checks both PRO and current paid plan keys "
         "to ensure legacy merchants retain full access.", size=10.5)

# ══════════════════════════════════════════════════════════════════════════════
#  FOOTER
# ══════════════════════════════════════════════════════════════════════════════
doc.add_page_break()
para = doc.add_paragraph()
para.alignment = WD_ALIGN_PARAGRAPH.CENTER
para.paragraph_format.space_before = Pt(100)
r = para.add_run("MixBox – Box & Bundle Builder")
set_run_font(r, size=14, bold=True, color=GREEN)

para2 = doc.add_paragraph()
para2.alignment = WD_ALIGN_PARAGRAPH.CENTER
r2 = para2.add_run("Knowledge Base Document  |  Version 1.0  |  April 2026")
set_run_font(r2, size=10, color=GRAY)

para3 = doc.add_paragraph()
para3.alignment = WD_ALIGN_PARAGRAPH.CENTER
r3 = para3.add_run("Prepared by Pryxotech  |  balvant@pryxotech.com")
set_run_font(r3, size=10, italic=True, color=GRAY)

# ─── Save ────────────────────────────────────────────────────────────────────
out_path = r"c:\shopify apps\combo-product\MixBox_Knowledge_Base.docx"
doc.save(out_path)
print(f"Saved: {out_path}")
