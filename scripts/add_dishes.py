"""Automated order builder for https://hotelsenarys.vercel.app/

Loads the live site in Chromium, inspects the rendered DOM of the menu grid,
and performs a REAL mouse click on the "[ADD +]" button for every requested
dish that is not already in the cart. Dishes already in the cart are skipped,
so no duplicate quantities are ever created.

The site's cart is client-side only (`let cart={}` - no localStorage, no API),
so the work happens entirely inside one live browser page session.

Run:
    python add_dishes.py
"""

import sys

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

URL = "https://hotelsenarys.vercel.app/"

# Dishes to add, in the exact order requested by the user.
DISHES = [
    "Veg Manchow Soup",
    "Peri Peri Fries",
    "Raagi Mudde Saaru",
    "Chicken Pakoda",
    "Paneer Tikka",
    "Chicken Tikka",
    "Chilli Chicken (Dry/Gravy)",
    "Chicken 65",
    "Andhra Chilli Chicken",
    "Gun Powder Chicken",
    "Belluli Kebab",
    "Mutton Chops",
    "Tandoori Chicken",
    "Chicken Tom Yum Soup",
    "Veg Sheekh Kabab",
    "Mushroom Pepper Fry",
    "Achari Chicken Tikka",
    "Chicken Seekh Kabab",
    "Karivepaku Kodi Chicken (Curry Leaf Chicken Fry)",
    "Mutton Pepper Roast B/K",
    "Nati Koli Palya",
]


def card_for(page, dish):
    """Locator for the <article class="menu-card"> whose <h4> is exactly `dish`."""
    return page.locator("article.menu-card").filter(
        has=page.locator(f'h4:text-is("{dish}")')
    )


def cart_state(page, dish):
    """'added'   -> card already shows a qty stepper (already in cart)
       'addable' -> card shows an 'ADD +' button (not yet added)
       'missing' -> no matching card in the DOM
    """
    card = card_for(page, dish)
    if card.count() == 0:
        return "missing"
    if card.locator('button:has-text("ADD +")').count() > 0:
        return "addable"
    return "added"


def click_add(page, dish):
    """Perform a real mouse click on the dish's '[ADD +]' button.

    renderMenu() rewrites #menuGrid's innerHTML after every click, so the
    button node is re-queried each time (stale handles are avoided).
    """
    btn = card_for(page, dish).locator('button:has-text("ADD +")')
    btn.scroll_into_view_if_needed()
    try:
        btn.click(timeout=10000)
    except Exception:
        # Fallback: click the exact pixel centre of the button.
        box = btn.bounding_box()
        page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)


# __APPEND_MORE__
