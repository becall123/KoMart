"""
Seed script — KoMart database utilities.

Commands:
  python -m app.seed --init          Create admin user + store settings + categories (idempotent)
  python -m app.seed --full-seed     Wipe and repopulate with full demo data (dev only)
  python -m app.seed --backfill-suppliers  Assign supplier_id on existing products without wiping data
  python -m app.seed --backfill-category-ids  Link product.category text to Category FK
"""
import argparse
import asyncio
import os
from datetime import datetime, timezone, timedelta

from app.database import init_db
from app.auth.jwt import hash_password
from app.models.user import User, UserRole
from app.models.product import Product, SellMode
from app.models.inventory import InventoryBatch, StockAdjustment
from app.models.supplier import Supplier
from app.models.purchase_order import PurchaseOrder
from app.models.customer import Customer, MembershipTier
from app.models.transaction import Transaction
from app.models.notification import Notification, NotificationType
from app.models.settings import StoreSettings
from app.models.expense import Expense, ExpenseCategory
from app.models.category import Category
from app.models.refresh_token import RefreshToken
from app.models.audit_log import AuditLog
from app.services.stock import refresh_all_product_stocks

# ---------------------------------------------------------------------------
# Helper image placeholder
# ---------------------------------------------------------------------------
def _img(name: str) -> str:
    slug = name.replace(" ", "+")[:30]
    return f"https://placehold.co/400x400/FF6B35/FFFFFF?text={slug}"


# ---------------------------------------------------------------------------
# Raw product catalog (extracted from KO-MART-RATE.xlsx)
# Fields: name, cost_price, selling_price, category, country_of_origin, brand
# ---------------------------------------------------------------------------
CATALOG = [
    # ── Sheet 1 · Chinese Products ──────────────────────────────────────────
    ("Keema Noodles",                         200,  240,  "Instant Noodles",        "China",        "Keema"),
    ("Chilli Oil with Chicken",               375,  450,  "Sauces & Condiments",    "China",        "Chinese Brand"),
    ("IGG Hotpot Masala",                     380,  475,  "Sauces & Condiments",    "China",        "IGG"),
    ("Rice Noodles",                          265,  330,  "Instant Noodles",        "China",        "Chinese Brand"),
    ("Rice Paper",                            480,  575,  "Dry Goods",              "China",        "Chinese Brand"),
    ("Soy Sauce 800ml",                       290,  350,  "Sauces & Condiments",    "China",        "Chinese Brand"),
    ("Vinegar Plus Soy Sauce 800ml",          290,  350,  "Sauces & Condiments",    "China",        "Chinese Brand"),
    ("900 Biscuit",                           140,  180,  "Confectionery",          "China",        "900"),
    ("Luncheon Meat",                         460,  575,  "Canned Foods",           "China",        "Chinese Brand"),
    ("Pink Peach Drink",                      140,  175,  "Beverages",              "China",        "Chinese Brand"),
    ("Spicy Stick - Latiao",                  70,   80,   "Snacks",                 "China",        "Chinese Brand"),
    ("Pork Sausage",                          30,   40,   "Snacks",                 "China",        "Chinese Brand"),
    ("Chinese Coffee Cup",                    138,  165,  "Beverages",              "China",        "Chinese Brand"),
    ("Dali Garden Cake",                      300,  375,  "Confectionery",          "China",        "Dali Garden"),
    ("Nescafe Can Coffee",                    210,  240,  "Beverages",              "China",        "Nescafe"),
    ("Sesame Oil 600ml",                      520,  625,  "Sauces & Condiments",    "China",        "Chinese Brand"),
    ("White Rice Vinegar",                    390,  450,  "Sauces & Condiments",    "China",        "Chinese Brand"),
    ("Le Kum Ki Sesame Oil",                  504,  630,  "Sauces & Condiments",    "China",        "Lee Kum Kee"),
    ("Premium Dark Soy Sauce",               476,  595,  "Sauces & Condiments",    "China",        "Chinese Brand"),
    ("Small Keema Noodles 75g",              65,   75,   "Instant Noodles",        "China",        "Keema"),
    ("Small Keema Noodles 95g",              85,   95,   "Instant Noodles",        "China",        "Keema"),
    ("DGL Juice 450ml",                       155,  185,  "Beverages",              "China",        "DGL"),
    ("DGL Juice 330ml",                       115,  140,  "Beverages",              "China",        "DGL"),
    ("Snow Candy",                            155,  185,  "Confectionery",          "China",        "Chinese Brand"),
    ("Candazy Candy",                         105,  125,  "Confectionery",          "China",        "Candazy"),
    ("Chicken Sausage RTE",                   100,  120,  "Snacks",                 "China",        "Chinese Brand"),
    ("Bubble Gum 60pcs",                      750,  900,  "Confectionery",          "China",        "Chinese Brand"),

    # ── Sheet 2 · Korean Products ────────────────────────────────────────────
    ("Shin Ramyun Noodles 120g",             165,  190,  "Instant Noodles",        "South Korea",  "Nongshim"),
    ("Soon Veg / Kimchi Noodles",            165,  195,  "Instant Noodles",        "South Korea",  "Nongshim"),
    ("Chapagetti Noodles 140g",              195,  235,  "Instant Noodles",        "South Korea",  "Nongshim"),
    ("Chapagetti Spicy Noodles 137g",        205,  250,  "Instant Noodles",        "South Korea",  "Nongshim"),
    ("Super Red Noodles 120g",               178,  215,  "Instant Noodles",        "South Korea",  "Nongshim"),
    ("Stir Fry Noodles 137g",                185,  220,  "Instant Noodles",        "South Korea",  "Nongshim"),
    ("Shin / Kimchi / Soon Cup Small",       163,  195,  "Instant Noodles",        "South Korea",  "Nongshim"),
    ("Shin Bowl 86g",                        170,  200,  "Instant Noodles",        "South Korea",  "Nongshim"),
    ("Shin / Shrimp Big Cup",                225,  270,  "Instant Noodles",        "South Korea",  "Nongshim"),
    ("Pepero 5 Flavours",                    178,  210,  "Confectionery",          "South Korea",  "Lotte"),
    ("Custard Pie 6pcs",                     365,  425,  "Confectionery",          "South Korea",  "Korean Brand"),
    ("Jacob's Soda Cracker Biscuit",         330,  380,  "Snacks",                 "Malaysia",     "Jacob's"),
    ("Onion Ring Plain / Hot & Spicy",       160,  190,  "Snacks",                 "South Korea",  "Nongshim"),
    ("Onion Ring 90g",                       235,  280,  "Snacks",                 "South Korea",  "Nongshim"),
    ("Shrimp Cracker Plain / Hot & Spicy",   185,  220,  "Snacks",                 "South Korea",  "Korean Brand"),
    ("Shrimp Meat Chips",                    210,  250,  "Snacks",                 "South Korea",  "Korean Brand"),
    ("Maxim Coffee (Box)",                   3820, 4500, "Beverages",              "South Korea",  "Maxim"),
    ("White Rabbit Candy 25g",               52,   60,   "Confectionery",          "China",        "White Rabbit"),
    ("White Rabbit Candy 39g",               103,  120,  "Confectionery",          "China",        "White Rabbit"),
    ("White Rabbit Candy 108g",              195,  240,  "Confectionery",          "China",        "White Rabbit"),
    ("Zubi Watermelon Lollipop",             135,  160,  "Confectionery",          "South Korea",  "Zubi"),
    ("Zubi Heart Lollipop",                  65,   80,   "Confectionery",          "South Korea",  "Zubi"),
    ("Zubi Stick Lollipop",                  32,   40,   "Confectionery",          "South Korea",  "Zubi"),
    ("Zubi Strawberry / Mickey Lollipop",    42,   50,   "Confectionery",          "South Korea",  "Zubi"),
    ("Zubi Small Lollipop",                  65,   80,   "Confectionery",          "South Korea",  "Zubi"),
    ("Zubi Colour Rose Lollipop",            120,  150,  "Confectionery",          "South Korea",  "Zubi"),

    # ── Sheet 3 · Korean Products (Samyang & Sauces) ─────────────────────────
    ("Buldak 2x / 1x Spicy Noodles",        205,  235,  "Instant Noodles",        "South Korea",  "Samyang"),
    ("Buldak 3x / Jjajang / Carbo / Cheese",215,  250,  "Instant Noodles",        "South Korea",  "Samyang"),
    ("Buldak Rose / Cream Carbo / Lime",     215,  250,  "Instant Noodles",        "South Korea",  "Samyang"),
    ("Buldak Tangle Pasta Noodles",          215,  250,  "Instant Noodles",        "South Korea",  "Samyang"),
    ("Buldak Cup Noodles 1x / 2x",          190,  230,  "Instant Noodles",        "South Korea",  "Samyang"),
    ("Buldak Topokki Carbo / 1x",           400,  500,  "Snacks",                 "South Korea",  "Samyang"),
    ("Roasted Seaweed 100pcs",              3000, 3750, "Snacks",                 "South Korea",  "Korean Brand"),
    ("Roasted Seaweed 10pcs",               500,  575,  "Snacks",                 "South Korea",  "Korean Brand"),
    ("Roasted Seaweed 3pcs",                275,  350,  "Snacks",                 "South Korea",  "Korean Brand"),
    ("Gochujang Paste 250g",                450,  540,  "Sauces & Condiments",    "South Korea",  "CJ"),
    ("Gochujang Paste 500g",                875,  1050, "Sauces & Condiments",    "South Korea",  "CJ"),
    ("Gochujang Paste 1kg",                 1430, 1720, "Sauces & Condiments",    "South Korea",  "CJ"),
    ("Korean Fish Sauce 1 Litre",           992,  1240, "Sauces & Condiments",    "South Korea",  "Korean Brand"),
    ("Korean Kimchi Can 160g",              400,  500,  "Sauces & Condiments",    "South Korea",  "Korean Brand"),
    ("Butane Mini Gas Cylinder",            224,  280,  "Kitchen Supplies",       "South Korea",  "Korean Brand"),
    ("Dasida Soup Powder 1kg",              2400, 3000, "Sauces & Condiments",    "South Korea",  "CJ"),
    ("Kochukaro Red Pepper Powder 1kg",     2400, 3000, "Sauces & Condiments",    "South Korea",  "Korean Brand"),
    ("Sempio Soy Sauce 500ml",              480,  580,  "Sauces & Condiments",    "South Korea",  "Sempio"),
    ("Udon Noodles",                        275,  340,  "Instant Noodles",        "South Korea",  "Korean Brand"),
    ("Doenjang Soybean Paste 950g",         832,  1040, "Sauces & Condiments",    "South Korea",  "Korean Brand"),
    ("Soba / Somen Noodles",                515,  620,  "Instant Noodles",        "Japan",        "Japanese Brand"),
    ("Korean Sesame Oil (Can)",             1270, 1520, "Sauces & Condiments",    "South Korea",  "Korean Brand"),
    ("Korean Rice 1kg",                     208,  250,  "Rice & Grains",          "South Korea",  "Korean Brand"),
    ("Bamboo Sushi Mat",                    390,  500,  "Kitchen Supplies",       "South Korea",  "Korean Brand"),
    ("Buldak Sauce Pink / Black / Red",     790,  990,  "Sauces & Condiments",    "South Korea",  "Samyang"),
    ("Samjang Dipping Sauce 250g",          450,  540,  "Sauces & Condiments",    "South Korea",  "Korean Brand"),

    # ── Sheet 4 · Thai Products ──────────────────────────────────────────────
    ("Roza Tuna Chunk in Brine",            178,  205,  "Canned Foods",           "Thailand",     "Roza"),
    ("Roza Tuna in Vegetable Oil",          192,  220,  "Canned Foods",           "Thailand",     "Roza"),
    ("Roza Sardine Tomato Sauce",           170,  195,  "Canned Foods",           "Thailand",     "Roza"),
    ("Roza Sardine with Cumin / Masala",    170,  195,  "Canned Foods",           "Thailand",     "Roza"),
    ("Roza Mackerel with Cumin",            170,  195,  "Canned Foods",           "Thailand",     "Roza"),
    ("Roza Mackerel Cumin & Chilli",        170,  195,  "Canned Foods",           "Thailand",     "Roza"),
    ("Roza Oyster Sauce 670g",              330,  380,  "Sauces & Condiments",    "Thailand",     "Roza"),
    ("Orient Mayochup",                     295,  340,  "Sauces & Condiments",    "Thailand",     "Orient"),
    ("Orient Squeeze Mayo 300ml",           210,  240,  "Sauces & Condiments",    "Thailand",     "Orient"),
    ("Orient Mayo 483ml",                   260,  300,  "Sauces & Condiments",    "Thailand",     "Orient"),
    ("Orient Mayo 238ml",                   165,  190,  "Sauces & Condiments",    "Thailand",     "Orient"),
    ("Orient Natural Vinegar",             200,  230,  "Sauces & Condiments",    "Thailand",     "Orient"),
    ("Orient Apple Cider Vinegar",         235,  270,  "Sauces & Condiments",    "Thailand",     "Orient"),
    ("Agnesi Spaghetti",                    275,  315,  "Dry Goods",              "Italy",        "Agnesi"),
    ("Gustora Spaghetti",                   150,  180,  "Dry Goods",              "Italy",        "Gustora"),
    ("Agnesi Tricolor Pasta",               326,  375,  "Dry Goods",              "Italy",        "Agnesi"),
    ("Antat Chocolate 400g",                405,  465,  "Confectionery",          "Thailand",     "Antat"),
    ("Antat Chocolate Mix 1kg",             880,  1010, "Confectionery",          "Thailand",     "Antat"),
    ("Antat Chocolate 800g",                813,  935,  "Confectionery",          "Thailand",     "Antat"),
    ("Antat Oats Chocolate 400g",           626,  720,  "Confectionery",          "Thailand",     "Antat"),
    ("Antat Cocobite 500g",                 685,  790,  "Confectionery",          "Thailand",     "Antat"),
    ("Siam Elephant Fish Sauce 720ml",      305,  350,  "Sauces & Condiments",    "Thailand",     "Siam Elephant"),
    ("Red Cherry Jar 727g",                 580,  665,  "Dry Goods",              "Thailand",     "Thai Brand"),
    ("Siam Vegan Curry Red/Green/Yellow",   440,  505,  "Sauces & Condiments",    "Thailand",     "Siam"),
    ("Orient Chocolate Syrup 623g",         495,  570,  "Sauces & Condiments",    "Thailand",     "Orient"),
    ("Orient Strawberry Syrup 623ml",       470,  540,  "Sauces & Condiments",    "Thailand",     "Orient"),
    ("Premier Cotton Bud 200 Tips",         140,  160,  "Personal Care",          "Thailand",     "Premier"),
    ("Premier Cotton Bud 400 Tips",         245,  280,  "Personal Care",          "Thailand",     "Premier"),
    ("Premier Cotton Bud 640 Tips",         226,  260,  "Personal Care",          "Thailand",     "Premier"),
    ("Premier Box Tissue 100 Sheet",        130,  150,  "Personal Care",          "Thailand",     "Premier"),
    ("Premier Box Tissue 200 Sheet",        230,  265,  "Personal Care",          "Thailand",     "Premier"),
    ("Super Delux Panty Liner",             78,   90,   "Personal Care",          "Thailand",     "Super Delux"),
    ("TG Honey / Salted Sunflower Snack",   65,   75,   "Snacks",                 "Thailand",     "TG"),
    ("Pumpkin Sunflower Seeds 30g",         110,  125,  "Snacks",                 "Thailand",     "Thai Brand"),
    ("Dried Pitted Prunes 130g",            445,  510,  "Snacks",                 "Thailand",     "Thai Brand"),
    ("Mala Flavoured Broadbean 120g",       210,  240,  "Snacks",                 "Thailand",     "Thai Brand"),
    ("Dried Cranberries 110g",              395,  455,  "Snacks",                 "Thailand",     "Thai Brand"),
    ("Jumbo Thomson Snack 120g",            260,  300,  "Snacks",                 "Thailand",     "Jumbo"),
    ("Sakura Plum 200g",                    360,  415,  "Snacks",                 "Thailand",     "Sakura"),

    # ── Sheet 5 · Snacks & Beverages ────────────────────────────────────────
    ("Yopokki Cup 120g",                    370,  425,  "Snacks",                 "South Korea",  "Yopokki"),
    ("Rice Cracker",                        260,  300,  "Snacks",                 "South Korea",  "Korean Brand"),
    ("Kracks",                              260,  300,  "Snacks",                 "South Korea",  "Korean Brand"),
    ("Soyo Milk 100ml (Assorted Flavours)", 55,   65,   "Beverages",              "South Korea",  "Soyo"),
    ("Soyo Milk 180ml (Assorted Flavours)", 92,   105,  "Beverages",              "South Korea",  "Soyo"),
    ("Mogumogu Iced Tea",                   190,  220,  "Beverages",              "South Korea",  "Mogumogu"),
    ("Mogumogu Jelly 120ml Lychee/Strawberry", 105, 120, "Beverages",            "South Korea",  "Mogumogu"),
    ("Pintola High Protein Muesli 1kg",     1145, 1375, "Health Foods",           "India",        "Pintola"),
    ("Pintola High Protein Muesli 400g",    520,  625,  "Health Foods",           "India",        "Pintola"),
    ("Pintola High Protein Oats 1kg",       995,  1195, "Health Foods",           "India",        "Pintola"),
    ("Pintola High Protein Oats 400g",      495,  595,  "Health Foods",           "India",        "Pintola"),
    ("Pintola Peanut Butter Natural 1kg",   770,  925,  "Health Foods",           "India",        "Pintola"),
    ("Pintola Peanut Butter Natural 350g",  280,  335,  "Health Foods",           "India",        "Pintola"),
    ("Pintola Peanut Butter Choco 1kg",     780,  935,  "Health Foods",           "India",        "Pintola"),
    ("Pintola Peanut Butter Choco 350g",    295,  355,  "Health Foods",           "India",        "Pintola"),
    ("Pintola Rice Cake",                   210,  250,  "Snacks",                 "India",        "Pintola"),

    # ── Sheet 6 · Others ─────────────────────────────────────────────────────
    ("OKF Juice Watermelon/Peach/Musk Melon", 165, 190, "Beverages",             "South Korea",  "OKF"),
    ("OKF Smoothie",                        220,  250,  "Beverages",              "South Korea",  "OKF"),
    ("Snowpie",                             275,  310,  "Confectionery",          "South Korea",  "Korean Brand"),
    ("Orion Chocopie (5 Flavours)",         117,  150,  "Confectionery",          "South Korea",  "Orion"),
    ("Lotte Chocopie",                      120,  150,  "Confectionery",          "South Korea",  "Lotte"),
    ("Charcoal 2kg",                        290,  330,  "Kitchen Supplies",       "South Korea",  "Korean Brand"),
    ("Wasabi Paste 35g",                    440,  500,  "Sauces & Condiments",    "Japan",        "Japanese Brand"),
    ("Wasabi Powder 200g",                  1040, 1300, "Sauces & Condiments",    "Japan",        "Japanese Brand"),
    ("Kimchi Pickle 250g",                  230,  275,  "Sauces & Condiments",    "South Korea",  "Korean Brand"),
    ("Kimchi Pickle 500g",                  460,  550,  "Sauces & Condiments",    "South Korea",  "Korean Brand"),
    ("Cheese Powder 100g",                  130,  155,  "Sauces & Condiments",    "South Korea",  "Korean Brand"),
    ("Cheese Powder 250g",                  260,  325,  "Sauces & Condiments",    "South Korea",  "Korean Brand"),
    ("Nookey Chocolate",                    660,  800,  "Confectionery",          "South Korea",  "Nookey"),
    ("Pistachio Kunafa 100g",               1100, 1320, "Confectionery",          "Saudi Arabia", "Middle Eastern Brand"),
    ("Choila Paure",                        116,  145,  "Snacks",                 "Nepal",        "Local Brand"),
    ("CJ Gochujang 500g",                   520,  625,  "Sauces & Condiments",    "South Korea",  "CJ"),
    ("CJ Samjang 170g",                     216,  260,  "Sauces & Condiments",    "South Korea",  "CJ"),
]

# ---------------------------------------------------------------------------
# Category → brief description templates
# ---------------------------------------------------------------------------
DESC_TEMPLATES = {
    "Instant Noodles":      "Delicious instant noodles with authentic Asian flavor. Quick and easy to prepare.",
    "Snacks":               "Crunchy and tasty snack, perfect for any time of day.",
    "Confectionery":        "Sweet treat made with premium ingredients. A crowd-pleasing favorite.",
    "Beverages":            "Refreshing beverage with a distinct and satisfying taste.",
    "Sauces & Condiments":  "Authentic Asian sauce or condiment to elevate your cooking.",
    "Canned Foods":         "High-quality canned product with long shelf life and great taste.",
    "Dry Goods":            "Premium dry goods ingredient sourced from quality producers.",
    "Health Foods":         "Nutritious health food made with natural, wholesome ingredients.",
    "Rice & Grains":        "Premium quality rice or grain product for everyday cooking.",
    "Kitchen Supplies":     "Essential kitchen supply for Asian cooking and food preparation.",
    "Personal Care":        "Quality personal care product for daily hygiene and comfort.",
}

# ---------------------------------------------------------------------------
# Allergen info by category
# ---------------------------------------------------------------------------
ALLERGEN_MAP = {
    "Instant Noodles":   "Contains wheat (gluten), soy. May contain traces of shellfish.",
    "Snacks":            "May contain wheat, soy, milk, tree nuts. Check packaging for details.",
    "Confectionery":     "Contains milk, soy, wheat. May contain traces of nuts.",
    "Beverages":         "No major allergens. Check label for specific ingredients.",
    "Sauces & Condiments": "Contains soy, wheat (gluten). Check label for full allergen info.",
    "Canned Foods":      "Contains fish. May contain soy. Check label for full information.",
    "Dry Goods":         "Contains wheat (gluten). May contain soy and tree nuts.",
    "Health Foods":      "Contains oats, peanuts, or tree nuts depending on variant.",
    "Rice & Grains":     "Gluten-free. No major allergens.",
    "Kitchen Supplies":  "Non-food item. No allergen information applicable.",
    "Personal Care":     "Non-food item. Check label for ingredient details.",
}

# ---------------------------------------------------------------------------
# Nutrition info by category
# ---------------------------------------------------------------------------
NUTRITION_MAP = {
    "Instant Noodles":   "Serving size: 1 pack. Calories: ~450 kcal. Protein: 9g, Fat: 16g, Carbs: 65g.",
    "Snacks":            "Serving size: 30g. Calories: ~150 kcal. Protein: 2g, Fat: 8g, Carbs: 18g.",
    "Confectionery":     "Serving size: 1 piece (30g). Calories: ~130 kcal. Sugar: 15g, Fat: 5g.",
    "Beverages":         "Serving size: 1 bottle. Calories: ~90 kcal. Sugar: 20g, Sodium: 30mg.",
    "Sauces & Condiments": "Per 15ml serving. Calories: ~20 kcal. Sodium: 700mg.",
    "Canned Foods":      "Per 85g serving. Calories: ~120 kcal. Protein: 18g, Fat: 5g.",
    "Dry Goods":         "Per 100g. Calories: ~350 kcal. Protein: 12g, Carbs: 72g.",
    "Health Foods":      "Per serving. High protein, natural ingredients. See label for full nutrition.",
    "Rice & Grains":     "Per 100g cooked. Calories: ~130 kcal. Carbs: 28g. Gluten-free.",
    "Kitchen Supplies":  "N/A",
    "Personal Care":     "N/A",
}

# ---------------------------------------------------------------------------
# Expiry by category (months from now)
# ---------------------------------------------------------------------------
EXPIRY_MONTHS = {
    "Instant Noodles":   12,
    "Snacks":            8,
    "Confectionery":     10,
    "Beverages":         6,
    "Sauces & Condiments": 18,
    "Canned Foods":      24,
    "Dry Goods":         18,
    "Health Foods":      12,
    "Rice & Grains":     24,
    "Kitchen Supplies":  None,  # no expiry
    "Personal Care":     None,
}

# ---------------------------------------------------------------------------
# SKU prefix by category
# ---------------------------------------------------------------------------
SKU_PREFIX = {
    "Instant Noodles":      "IM",
    "Snacks":               "SN",
    "Confectionery":        "CF",
    "Beverages":            "BV",
    "Sauces & Condiments":  "SC",
    "Canned Foods":         "CN",
    "Dry Goods":            "DG",
    "Health Foods":         "HF",
    "Rice & Grains":        "RG",
    "Kitchen Supplies":     "KS",
    "Personal Care":        "PC",
}


def _expiry_date(category: str, offset_months: int = 0) -> str | None:
    months = EXPIRY_MONTHS.get(category)
    if months is None:
        return None
    base = datetime.now(timezone.utc) + timedelta(days=(months + offset_months) * 30)
    return base.strftime("%Y-%m-%d")


def _barcode(idx: int) -> str:
    base = 8801000000000 + idx
    return str(base)


# ---------------------------------------------------------------------------
# Initial categories (sourced from CATALOG unique categories)
# ---------------------------------------------------------------------------
INITIAL_CATEGORIES = [
    "Instant Noodles",
    "Snacks",
    "Confectionery",
    "Beverages",
    "Sauces & Condiments",
    "Canned Foods",
    "Dry Goods",
    "Health Foods",
    "Rice & Grains",
    "Kitchen Supplies",
    "Personal Care",
]


# ---------------------------------------------------------------------------
# Init mode — idempotent, creates admin + settings + categories only
# ---------------------------------------------------------------------------
async def init():
    await init_db()
    print("Connected to MongoDB.")

    # Admin user
    existing_users = await User.find().count()
    if existing_users == 0:
        admin_email = os.environ.get("ADMIN_EMAIL", "admin@komart.com")
        admin_password = os.environ.get("ADMIN_PASSWORD", "changeme123")
        admin_name = os.environ.get("ADMIN_NAME", "Admin")
        await User(
            email=admin_email,
            name=admin_name,
            hashed_password=hash_password(admin_password),
            role=UserRole.admin,
        ).insert()
        print(f"  Created admin user: {admin_email} (password: {admin_password})")
    else:
        print(f"  Skipped users — {existing_users} user(s) already exist.")

    # Store settings
    if not await StoreSettings.find_one():
        await StoreSettings(
            store_name="KoMart",
            address="Thamel, Kathmandu, Nepal",
            phone="+977-1-4123456",
            email="info@komart.com",
            currency="NPR",
            tax_rate=13.0,
            tax_inclusive=False,
            loyalty_points_per_currency=100,
        ).insert()
        print("  Created default store settings.")
    else:
        print("  Skipped store settings — already exists.")

    # Categories
    existing_cats = await Category.find().count()
    if existing_cats == 0:
        for idx, cat_name in enumerate(INITIAL_CATEGORIES, start=1):
            desc = DESC_TEMPLATES.get(cat_name, "")
            await Category(
                name=cat_name,
                description=desc,
                code=f"{idx:02d}",
                next_sku_seq=1,
            ).insert()
        print(f"  Created {len(INITIAL_CATEGORIES)} categories.")
    else:
        print(f"  Skipped categories — {existing_cats} category(ies) already exist.")

    from app.models.expense_category import DEFAULT_EXPENSE_CATEGORIES, ExpenseCategoryDoc
    existing_exp = {c.code for c in await ExpenseCategoryDoc.find_all().to_list()}
    created_exp = 0
    for code, label in DEFAULT_EXPENSE_CATEGORIES:
        if code in existing_exp:
            continue
        await ExpenseCategoryDoc(code=code, label=label).insert()
        created_exp += 1
    if created_exp:
        print(f"  Created {created_exp} expense categories.")
    else:
        print("  Skipped expense categories — already exist.")

    print()
    print("Init complete! Run the app and log in:")
    print("  Admin email : " + os.environ.get("ADMIN_EMAIL", "admin@komart.com"))
    print("  API docs    : http://localhost:8000/docs")


# ---------------------------------------------------------------------------
# Full seed (dev only) — wipes and repopulates with demo data
# ---------------------------------------------------------------------------
async def seed():
    await init_db()
    print("Connected to MongoDB.")

    # Clear all collections
    for model in [User, Product, InventoryBatch, StockAdjustment, Supplier, PurchaseOrder,
                  Customer, Transaction, Notification, StoreSettings, Expense, Category,
                  RefreshToken, AuditLog]:
        await model.find_all().delete()
    print("Cleared existing collections.")

    # ── Users ─────────────────────────────────────────────────────────────
    admin = await User(
        email="admin@komart.com",
        name="Admin User",
        hashed_password=hash_password("password"),
        role=UserRole.admin,
    ).insert()
    manager = await User(
        email="manager@komart.com",
        name="Store Manager",
        hashed_password=hash_password("password"),
        role=UserRole.manager,
    ).insert()
    await User(
        email="cashier@komart.com",
        name="Ram Cashier",
        hashed_password=hash_password("password"),
        role=UserRole.cashier,
    ).insert()
    print("Created 3 users  (admin / manager / cashier — password: 'password')")

    # ── Suppliers ─────────────────────────────────────────────────────────
    sup_korean = await Supplier(
        name="Seoul Foods Import Pvt. Ltd.",
        country="South Korea",
        contact_person="Kim Min-jun",
        phone="+977-9801234567",
        email="contact@seoulfoods.kr",
        address="Thamel, Kathmandu, Nepal",
    ).insert()

    sup_chinese = await Supplier(
        name="Dragon Gate Trading Co.",
        country="China",
        contact_person="Li Wei",
        phone="+977-9802345678",
        email="sales@dragongate.cn",
        address="Asan, Kathmandu, Nepal",
    ).insert()

    sup_thai = await Supplier(
        name="Bangkok Imports Nepal",
        country="Thailand",
        contact_person="Somchai Rattanawong",
        phone="+977-9803456789",
        email="info@bkkimports.th",
        address="New Road, Kathmandu, Nepal",
    ).insert()

    sup_misc = await Supplier(
        name="Asia Pacific Distributors",
        country="Nepal",
        contact_person="Rajan Shrestha",
        phone="+977-9804567890",
        email="rajan@asiapacific.com.np",
        address="Putalisadak, Kathmandu, Nepal",
    ).insert()

    print("Created 4 suppliers.")

    def _supplier_for_country(country: str) -> tuple:
        if country == "South Korea":
            return str(sup_korean.id), sup_korean.name
        if country == "China":
            return str(sup_chinese.id), sup_chinese.name
        if country == "Thailand":
            return str(sup_thai.id), sup_thai.name
        return str(sup_misc.id), sup_misc.name

    # ── Products ──────────────────────────────────────────────────────────
    products = []
    sku_counters: dict[str, int] = {}

    for idx, (name, cost, sell, cat, country, brand) in enumerate(CATALOG):
        prefix = SKU_PREFIX.get(cat, "GN")
        sku_counters[prefix] = sku_counters.get(prefix, 0) + 1
        sku = f"KM-{prefix}-{str(sku_counters[prefix]).zfill(3)}"
        barcode = _barcode(idx + 1)

        # Stock starts at 0 — inventory is populated via Purchase Order receipt flow
        if cat in ("Kitchen Supplies", "Personal Care"):
            threshold = 5
        elif cat in ("Health Foods", "Rice & Grains"):
            threshold = 5
        elif cat == "Beverages":
            threshold = 15
        else:
            threshold = 10

        supplier_id, supplier_name = _supplier_for_country(country)

        # Pack-buy / piece-sell examples for common retail SKUs
        if cat in ("Snacks", "Instant Noodles", "Confectionery"):
            buy_uom, sell_uom, units_per_buy, sell_mode = "pack", "pcs", 12, SellMode.both
        elif cat == "Beverages":
            buy_uom, sell_uom, units_per_buy, sell_mode = "box", "bottle", 6, SellMode.both
        else:
            buy_uom, sell_uom, units_per_buy, sell_mode = "pcs", "pcs", 1, SellMode.unit

        pack_selling_price = 0.0
        if units_per_buy > 1 and sell_mode in (SellMode.unit, SellMode.both):
            pack_selling_price = round(float(sell) * units_per_buy * 0.93, 2)

        p = await Product(
            name=name,
            sku=sku,
            barcode=barcode,
            brand=brand,
            country_of_origin=country,
            category=cat,
            supplier_id=supplier_id,
            supplier_name=supplier_name,
            description=DESC_TEMPLATES.get(cat, "Quality Asian imported product."),
            buy_uom=buy_uom,
            uom=sell_uom,
            units_per_buy_uom=units_per_buy,
            sell_mode=sell_mode,
            cost_price=float(cost),
            selling_price=float(sell),
            pack_selling_price=pack_selling_price,
            images=[_img(name)],
            nutrition_info=NUTRITION_MAP.get(cat),
            allergen_info=ALLERGEN_MAP.get(cat),
            stock=0,
            low_stock_threshold=threshold,
        ).insert()
        products.append(p)

    print(f"Created {len(products)} products (stock 0 — add stock via Purchase Orders).")

    # No purchase orders, inventory batches, or stock adjustments in seed.
    # Workflow: Create PO → Place Order → Process Receipt → stock appears in Inventory.

    # ── Customers ─────────────────────────────────────────────────────────
    cust1 = await Customer(
        name="Sita Sharma",
        phone="+977-9841234567",
        email="sita@email.com",
        birthday="1995-03-15",
        loyalty_points=450,
        membership_tier=MembershipTier.gold,
        total_spent=45000,
    ).insert()

    cust2 = await Customer(
        name="Ram Thapa",
        phone="+977-9857654321",
        email="ram@email.com",
        loyalty_points=120,
        membership_tier=MembershipTier.silver,
        total_spent=12000,
    ).insert()

    cust3 = await Customer(
        name="Anita Rai",
        phone="+977-9869876543",
        email="anita@email.com",
        birthday="1990-08-22",
        loyalty_points=980,
        membership_tier=MembershipTier.platinum,
        total_spent=98000,
    ).insert()

    print("Created 3 customers.")

    # ── Notifications ─────────────────────────────────────────────────────
    await Notification(
        type=NotificationType.purchase_reminder,
        title="Inventory Workflow",
        message="Create a purchase order, place it, then process receipt to add stock to inventory.",
        read=False,
        link="/purchase-orders",
    ).insert()

    print("Created notifications.")

    # ── Store Settings ────────────────────────────────────────────────────
    await StoreSettings(
        store_name="KoMart",
        address="Thamel, Kathmandu, Nepal",
        phone="+977-1-4123456",
        email="info@komart.com",
        currency="NPR",
        tax_rate=13.0,
        tax_inclusive=False,
        loyalty_points_per_currency=100,
    ).insert()

    print("Created store settings.")

    # ── Categories ────────────────────────────────────────────────────────
    for idx, cat_name in enumerate(INITIAL_CATEGORIES, start=1):
        desc = DESC_TEMPLATES.get(cat_name, "")
        await Category(
            name=cat_name,
            description=desc,
            code=f"{idx:02d}",
            next_sku_seq=1,
        ).insert()
    print(f"Created {len(INITIAL_CATEGORIES)} categories.")

    # ── Expenses ──────────────────────────────────────────────────────────
    expense_seeds = [
        Expense(
            title="Store Renovation & Setup",
            description="Initial renovation of the store space including shelving, flooring and paint",
            amount=250000,
            category=ExpenseCategory.setup_investment,
            date="2024-01-10",
            paid_to="Kathmandu Interiors Pvt Ltd",
            payment_method="cash",
            is_setup_cost=True,
        ),
        Expense(
            title="POS System & Hardware",
            description="Touchscreen POS terminal, barcode scanners, receipt printer",
            amount=85000,
            category=ExpenseCategory.equipment,
            date="2024-01-12",
            paid_to="TechHub Nepal",
            payment_method="bank",
            is_setup_cost=True,
        ),
        Expense(
            title="Initial Inventory Purchase",
            description="First batch of stock purchased from suppliers",
            amount=320000,
            category=ExpenseCategory.setup_investment,
            date="2024-01-15",
            paid_to="Various Suppliers",
            payment_method="cash",
            is_setup_cost=True,
        ),
        Expense(
            title="Store Rent - January 2026",
            amount=45000,
            category=ExpenseCategory.rent,
            date="2026-01-01",
            paid_to="Thamel Property Management",
            payment_method="esewa",
            is_setup_cost=False,
        ),
        Expense(
            title="Electricity Bill - January 2026",
            amount=8500,
            category=ExpenseCategory.utilities,
            date="2026-01-20",
            paid_to="Nepal Electricity Authority",
            payment_method="esewa",
            is_setup_cost=False,
        ),
        Expense(
            title="Staff Salaries - January 2026",
            amount=75000,
            category=ExpenseCategory.salaries,
            date="2026-01-31",
            paid_to="Staff",
            payment_method="cash",
            is_setup_cost=False,
        ),
        Expense(
            title="Social Media Marketing",
            description="Facebook and Instagram ad campaigns for store promotion",
            amount=12000,
            category=ExpenseCategory.marketing,
            date="2026-02-10",
            paid_to="Digital Nepal Agency",
            payment_method="bank",
            is_setup_cost=False,
        ),
        Expense(
            title="Packaging & Carry Bags",
            amount=6500,
            category=ExpenseCategory.supplies,
            date="2026-06-05",
            paid_to="Packaging Solutions Nepal",
            payment_method="cash",
            is_setup_cost=False,
        ),
        Expense(
            title="AC Maintenance",
            description="Annual servicing and gas refill for store AC units",
            amount=9000,
            category=ExpenseCategory.maintenance,
            date="2026-06-20",
            paid_to="Cool Tech Services",
            payment_method="cash",
            is_setup_cost=False,
        ),
    ]
    for exp in expense_seeds:
        await exp.insert()
    print(f"Created {len(expense_seeds)} expenses.")

    await refresh_all_product_stocks()
    print("Synced product stock cache (all products start at 0).")
    print()
    print("Seed complete!")
    print(f"  Products           : {len(products)}")
    print(f"  Inventory batches  : {await InventoryBatch.count()}")
    print(f"  Purchase orders    : {await PurchaseOrder.count()}")
    print(f"  Stock adjustments  : {await StockAdjustment.count()}")
    print("  Users              : 3  (admin / manager / cashier — password: 'password')")
    print("  Suppliers          : 4")
    print("  Customers          : 3")
    print(f"  Expenses           : {await Expense.count()}")
    print("  Login URL          : http://localhost:8000/docs")
    print("  Admin email        : admin@komart.com")


def _supplier_for_product_country(country: str, by_supplier_country: dict[str, Supplier], fallback: Supplier) -> tuple[str, str]:
    target = {"South Korea": "South Korea", "China": "China", "Thailand": "Thailand"}.get(country, "Nepal")
    supplier = by_supplier_country.get(target, fallback)
    return str(supplier.id), supplier.name


async def backfill_product_suppliers():
    """Assign supplier_id/supplier_name on products missing them (no data wipe)."""
    await init_db()
    suppliers = await Supplier.find_all().to_list()
    if not suppliers:
        print("No suppliers found — run full seed first.")
        return

    by_supplier_country = {s.country: s for s in suppliers}
    fallback = by_supplier_country.get("Nepal") or suppliers[0]

    products = await Product.find_all().to_list()
    updated = 0
    for product in products:
        if product.supplier_id and product.supplier_name:
            continue
        supplier_id, supplier_name = _supplier_for_product_country(
            product.country_of_origin, by_supplier_country, fallback,
        )
        await product.set({"supplier_id": supplier_id, "supplier_name": supplier_name})
        updated += 1

    await refresh_all_product_stocks()
    print(f"Backfill complete — updated {updated} product(s).")


async def backfill_category_ids() -> None:
    """Link products.category text to Category documents via category_id."""
    await init_db()
    categories = await Category.find_all().to_list()
    by_name = {c.name.lower(): c for c in categories}
    products = await Product.find_all().to_list()
    updated = 0
    unmatched: list[str] = []
    for product in products:
        if getattr(product, "category_id", ""):
            continue
        key = (product.category or "").strip().lower()
        if not key:
            continue
        cat = by_name.get(key)
        if not cat:
            unmatched.append(product.name)
            continue
        await product.set({"category_id": str(cat.id), "category": cat.name})
        updated += 1
    print(f"Category backfill — updated {updated} product(s).")
    if unmatched:
        print(f"Unmatched ({len(unmatched)}): {', '.join(unmatched[:10])}{'...' if len(unmatched) > 10 else ''}")


async def backfill_cashier_ids() -> None:
    """Populate cashier_id on existing transactions using created_by (name → user ID)."""
    await init_db()
    users = await User.find_all().to_list()
    name_to_id = {u.name: str(u.id) for u in users}

    transactions = await Transaction.find(Transaction.cashier_id == None).to_list()  # noqa: E711
    updated = 0
    skipped = 0
    for txn in transactions:
        uid = name_to_id.get(txn.created_by)
        if uid:
            await txn.set({"cashier_id": uid})
            updated += 1
        else:
            skipped += 1

    print(f"Backfill complete — updated {updated} transaction(s), skipped {skipped} (no matching user).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="KoMart database seed utilities")
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--init",
        action="store_true",
        help="Idempotent init: create admin user + store settings + categories (default)",
    )
    group.add_argument(
        "--full-seed",
        action="store_true",
        help="[DEV ONLY] Wipe all data and repopulate with full demo data",
    )
    group.add_argument(
        "--backfill-suppliers",
        action="store_true",
        help="Assign supplier_id on existing products without wiping data",
    )
    group.add_argument(
        "--backfill-cashier-ids",
        action="store_true",
        help="Populate cashier_id on existing transactions from created_by email",
    )
    group.add_argument(
        "--backfill-category-ids",
        action="store_true",
        help="Link product.category text to Category.category_id",
    )
    args = parser.parse_args()

    if args.backfill_suppliers:
        asyncio.run(backfill_product_suppliers())
    elif args.backfill_cashier_ids:
        asyncio.run(backfill_cashier_ids())
    elif args.backfill_category_ids:
        asyncio.run(backfill_category_ids())
    elif args.full_seed:
        asyncio.run(seed())
    else:
        # Default: --init (also runs when --init is explicitly passed)
        asyncio.run(init())
