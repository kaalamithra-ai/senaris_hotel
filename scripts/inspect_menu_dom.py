"""Dump the LIVE DOM structure of the menu grid on hotelsenarys.vercel.app.

Read-only: inspects the rendered DOM, the in-page cart state and every
menu card, so we can confirm the real structure before clicking anything.
"""
import sys

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

URL = "https://hotelsenarys.vercel.app/"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    page.goto(URL, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_selector("article.menu-card", timeout=30000)
    page.wait_for_timeout(1500)

    print("=== PAGE / CART STATE ===")
    print("menuCount    :", page.locator("#menuCount").inner_text())
    print("menuCartCount:", page.locator("#menuCartCount").inner_text())
    print("cartBadge    :", page.locator("#cartBadge").inner_text())
    print("floatCount   :", page.locator("#floatCount").inner_text())
    print("search value :", repr(page.locator("#menuSearch").input_value()))
    print("vegOnly      :", page.locator("#vegOnly").is_checked())
    print("sort         :", page.locator("#menuSort").input_value())
    print("cart object  :", page.evaluate("() => JSON.stringify(cart)"))
    print("cartCount()  :", page.evaluate("() => cartCount()"))
    print("MENU.length  :", page.evaluate("() => MENU.length"))
    print("persisted?   :", page.evaluate(
        "() => JSON.stringify({ls: !!localStorage.length, ss: !!sessionStorage.length})"))

    print("\n=== RENDERED MENU CARDS ===")
    cards = page.locator("article.menu-card")
    n = cards.count()
    print("cards rendered:", n)
    for i in range(n):
        c = cards.nth(i)
        name = c.locator("h4").inner_text().strip()
        price = c.locator("span.font-display").first.inner_text().strip()
        add = c.locator('button:has-text("ADD +")').count()
        step = c.locator('button[aria-label="Increase quantity"]').count()
        state = "ADD+ available" if add else ("ALREADY IN CART" if step else "??")
        print(f"{i+1:2d}. {name:32s} {price:>8s}  {state}")

    browser.close()
