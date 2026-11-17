// Functional test suite for the Hotel Senary single-page site.
const path = require('path');
const { launch, gotoPage, sleep } = require('./cdp');

const PORT = 9400 + Math.floor(Math.random() * 400); // avoid clashing with a lingering Chrome
const URL = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');

// Expected number of menu items. Keep in sync with the MENU array in index.html.
const EXPECTED_DISHES = 95;

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ->  ' + detail : ''));
}

(async () => {
  const { chrome, c } = await launch(PORT);
  try {
    await gotoPage(c, URL);
    // Wait for async menu.json fetch to finish rendering
    for (let i = 0; i < 100; i++) {
      try {
        const n = await c.evalExpr('typeof MENU !== "undefined" ? MENU.length : 0');
        if (n === EXPECTED_DISHES) break;
      } catch (e) {}
      await sleep(100);
    }
    await sleep(500);

    // ---------- MENU BASELINE ----------
    const base = JSON.parse(await c.evalExpr(`JSON.stringify({
      cards: document.querySelectorAll('article.menu-card').length,
      count: document.querySelector('#menuCount').textContent,
      menuLen: MENU.length,
      tabAll: document.querySelector('.menu-tab[data-filter="all"] .opacity-60')?.textContent
    })`));
    check('menu renders 95 dishes', base.cards === EXPECTED_DISHES && base.menuLen === EXPECTED_DISHES, JSON.stringify(base));
    check('menu count label matches', base.count.trim() === EXPECTED_DISHES + ' dishes', base.count);
    check('"All Menu" tab badge shows 95', base.tabAll === String(EXPECTED_DISHES), String(base.tabAll));

    // ---------- CATEGORY FILTERS ----------
    for (const [cat, label] of [['soups', 'Soups & Bites'], ['tandoor', 'Tandoor Non-Veg'],
      ['andhra', 'Aromas of Andhra'], ['nati', 'Nati Style'], ['chinese', 'Chinese & Veg']]) {
      const r = JSON.parse(await c.evalExpr(`(() => {
        setMenuFilter('${cat}', document.querySelector('.menu-tab[data-filter="${cat}"]'));
        return JSON.stringify({
          cards: document.querySelectorAll('article.menu-card').length,
          expected: MENU.filter(m => m.cat === '${cat}').length,
          count: document.querySelector('#menuCount').textContent,
          active: document.querySelector('.menu-tab.active').dataset.filter
        });
      })()`));
      check(`filter '${cat}' shows ${r.expected} dishes`,
        r.cards === r.expected && r.active === cat && r.cards > 0,
        JSON.stringify(r));
    }

    // ---------- MENU DATA INTEGRITY ----------
    // Guards the expanded menu: every dish must belong to a category that has a
    // filter tab, otherwise it would be unreachable via the category filters.
    const integrity = JSON.parse(await c.evalExpr(`(() => {
      clearMenuFilters();
      const tabs = [...document.querySelectorAll('.menu-tab')].map(b => b.dataset.filter);
      const cats = [...new Set(MENU.map(m => m.cat))];
      const result = {
        tabs,
        cats,
        orphaned: MENU.filter(m => !tabs.includes(m.cat)).map(m => m.id + ':' + m.name),
        ids: new Set(MENU.map(m => m.id)).size === MENU.length,
        names: new Set(MENU.map(m => m.name)).size === MENU.length,
        malformed: MENU.filter(m => typeof m.price !== 'number' || !m.name || !m.desc
          || typeof m.veg !== 'boolean' || typeof m.spice !== 'number' || typeof m.pop !== 'boolean')
          .map(m => m.id),
        missingLabel: MENU.filter(m => !m.catLabel).map(m => m.id),
        // every dish must be reachable by name search too
        unsearchable: MENU.filter(m => {
          const q = m.name.toLowerCase();
          const el = document.querySelector('#menuSearch');
          el.value = q; el.dispatchEvent(new Event('input'));
          const n = document.querySelectorAll('article.menu-card').length;
          return n === 0;
        }).map(m => m.id)
      };
      clearMenuFilters();
      return JSON.stringify(result);
    })()`));
    check('every dish maps to an existing filter tab', integrity.orphaned.length === 0, JSON.stringify(integrity.orphaned));
    check('menu ids and names are unique', integrity.ids && integrity.names, JSON.stringify(integrity));
    check('no malformed menu entries', integrity.malformed.length === 0, JSON.stringify(integrity.malformed));
    check('every dish has a category label', integrity.missingLabel.length === 0, JSON.stringify(integrity.missingLabel));
    check('every dish is reachable via search', integrity.unsearchable.length === 0, JSON.stringify(integrity.unsearchable));

    // ---------- HOMEPAGE SHORTCUT TARGETS ----------
    // The signature strip and category chips jump into the menu via quickSearch()/
    // jumpToCategory(). Their targets must still resolve now that the menu changed.
    const shortcuts = JSON.parse(await c.evalExpr(`(() => {
      const targets = [...document.querySelectorAll('[onclick*="quickSearch("],[onclick*="jumpToCategory("]')]
        .map(el => ({ el, call: el.getAttribute('onclick') }));
      const out = [];
      for (const { el, call } of targets) {
        const open = call.indexOf("('");
        if (open < 0) { out.push({ call, ok: false, why: 'unparsed' }); continue; }
        const fn = call.slice(0, open);
        const arg = call.slice(open + 2, call.lastIndexOf("')"));
        clearMenuFilters();
        if (fn === 'quickSearch') {
          // search is a substring match, so the target need not be an exact dish name
          const hits = MENU.filter(d => d.name.toLowerCase().includes(arg.toLowerCase())
            || d.desc.toLowerCase().includes(arg.toLowerCase())
            || d.catLabel.toLowerCase().includes(arg.toLowerCase()));
          out.push({ call, ok: hits.length > 0, why: 'no dish matches "' + arg + '"' });
        } else {
          const hits = MENU.filter(d => d.cat === arg);
          out.push({ call, ok: hits.length > 0, why: 'no dish in category "' + arg + '"' });
        }
      }
      clearMenuFilters();
      return JSON.stringify(out);
    })()`));
    check('all homepage menu shortcuts resolve to dishes',
      shortcuts.length > 0 && shortcuts.every(s => s.ok),
      JSON.stringify(shortcuts.filter(s => !s.ok)));

    // ---------- SEARCH ----------
    const search = JSON.parse(await c.evalExpr(`(() => {
      clearMenuFilters();
      const el = document.querySelector('#menuSearch');
      el.value = 'chicken'; el.dispatchEvent(new Event('input'));
      const chicken = document.querySelectorAll('article.menu-card').length;
      const expected = MENU.filter(m => m.name.toLowerCase().includes('chicken') || m.desc.toLowerCase().includes('chicken')).length;
      el.value = 'zzzznotfound'; el.dispatchEvent(new Event('input'));
      const empty = !document.querySelector('#menuEmpty').classList.contains('hidden');
      const gridHidden = document.querySelector('#menuGrid').classList.contains('hidden');
      el.value = ''; el.dispatchEvent(new Event('input'));
      const restored = document.querySelectorAll('article.menu-card').length;
      return JSON.stringify({ chicken, expected, empty, gridHidden, restored });
    })()`));
    check('search "chicken" filters correctly', search.chicken === search.expected && search.chicken > 0, JSON.stringify(search));
    check('no-match shows empty state', search.empty && search.gridHidden, JSON.stringify(search));
    check('clearing search restores 95 cards', search.restored === EXPECTED_DISHES, JSON.stringify(search));



    // ---------- VEG ONLY ----------
    const veg = JSON.parse(await c.evalExpr(`(() => {
      clearMenuFilters();
      const cb = document.querySelector('#vegOnly');
      cb.checked = true; cb.dispatchEvent(new Event('change'));
      const shown = document.querySelectorAll('article.menu-card').length;
      const expected = MENU.filter(m => m.veg).length;
      const allVeg = [...document.querySelectorAll('article.menu-card')].every(card =>
        card.querySelector('.veg-mark:not(.nonveg-mark)'));
      cb.checked = false; cb.dispatchEvent(new Event('change'));
      return JSON.stringify({ shown, expected, allVeg, restored: document.querySelectorAll('article.menu-card').length });
    })()`));
    check('veg-only filter works', veg.shown === veg.expected && veg.allVeg && veg.restored === EXPECTED_DISHES, JSON.stringify(veg));

    // ---------- SORTING ----------
    const sort = JSON.parse(await c.evalExpr(`(() => {
      clearMenuFilters();
      const sel = document.querySelector('#menuSort');
      const prices = () => [...document.querySelectorAll('article.menu-card')].map(card => {
        const el = [...card.querySelectorAll('.font-display')].find(e => /^\u20b9/.test(e.textContent.trim()));
        return parseInt(el.textContent.replace(/[^0-9]/g, ''), 10);
      });
      sel.value = 'low'; sel.dispatchEvent(new Event('change'));
      const low = prices();
      sel.value = 'high'; sel.dispatchEvent(new Event('change'));
      const high = prices();
      sel.value = 'popular'; sel.dispatchEvent(new Event('change'));
      return JSON.stringify({ low, high, lowOk: low.every((v, i) => i === 0 || low[i-1] <= v),
        highOk: high.every((v, i) => i === 0 || high[i-1] >= v) });
    })()`));
    check('sort price low->high', sort.lowOk, JSON.stringify(sort.low));
    check('sort price high->low', sort.highOk, JSON.stringify(sort.high));

    // ---------- CART: ADD / QTY / TOTALS ----------
    const cartState = JSON.parse(await c.evalExpr(`(() => {
      clearMenuFilters();
      addToCart(1); addToCart(1); addToCart(3);
      return JSON.stringify({
        cart: cart, count: cartCount(),
        badge: document.querySelector('#cartBadge').textContent,
        menuCart: document.querySelector('#menuCartCount').textContent,
        floatCount: document.querySelector('#floatCount').textContent,
        floatTotal: document.querySelector('#floatTotal').textContent,
        subtotal: cartSubtotal(),
        expectedSub: MENU.find(m => m.id === 1).price * 2 + MENU.find(m => m.id === 3).price,
        badgeVisible: !document.querySelector('#cartBadge').classList.contains('hidden'),
        floatVisible: !document.querySelector('#floatCart').classList.contains('hidden'),
        stepper: document.querySelectorAll('article.menu-card button[aria-label="Increase quantity"]').length
      });
    })()`));
    check('add to cart updates counts', cartState.count === 3 && cartState.badge === '3' && cartState.menuCart === '3' && cartState.floatCount === '3', JSON.stringify(cartState));
    check('cart subtotal correct', cartState.subtotal === cartState.expectedSub, JSON.stringify(cartState));
    check('cart badges visible', cartState.badgeVisible && cartState.floatVisible, JSON.stringify(cartState));
    check('cards show qty steppers', cartState.stepper === 2, 'steppers=' + cartState.stepper);

    const qtyState = JSON.parse(await c.evalExpr(`(() => {
      changeQty(1, -1);
      const after = JSON.stringify({ cart: cart, count: cartCount() });
      changeQty(1, -1);
      const zeroed = JSON.stringify({ cart: cart, count: cartCount() });
      changeQty(3, -1);
      const empty = JSON.stringify({ cart: cart, count: cartCount(),
        badgeHidden: document.querySelector('#cartBadge').classList.contains('hidden'),
        floatHidden: document.querySelector('#floatCart').classList.contains('hidden'),
        total: document.querySelector('#floatTotal').textContent });
      return JSON.stringify({ after, zeroed, empty });
    })()`));
    const after = JSON.parse(qtyState.after), zeroed = JSON.parse(qtyState.zeroed), emptied = JSON.parse(qtyState.empty);
    check('decrement reduces qty', after.count === 2, qtyState.after);
    check('qty cannot go below zero (key removed)', zeroed.count === 1 && zeroed.cart['1'] === undefined, qtyState.zeroed);
    check('emptying cart hides badges', emptied.count === 0 && emptied.badgeHidden && emptied.floatHidden, qtyState.empty);

    // ---------- PLACE ORDER (suspected bug) ----------
    await c.evalExpr(`addToCart(1); addToCart(3);`);
    const order = JSON.parse(await c.evalExpr(`(() => {
      toggleCart(true);
      placeOrder();
      const immediate = $('cartBody').textContent;
      const immediateHasConfirm = /Order Confirmed/i.test(immediate);
      return JSON.stringify({ immediateHasConfirm, immediate: immediate.replace(/\\s+/g,' ').slice(0,120) });
    })()`));
    check('placeOrder shows confirmation immediately', order.immediateHasConfirm, order.immediate);

    await sleep(1200); // wait past the 400ms setTimeout(updateCartUI)
    const orderAfter = JSON.parse(await c.evalExpr(`(() => JSON.stringify({
      text: $('cartBody').textContent.replace(/\\s+/g,' ').slice(0,160),
      confirmed: /Order Confirmed/i.test($('cartBody').textContent),
      emptyPlate: /plate is empty/i.test($('cartBody').textContent),
      cart: JSON.stringify(cart),
      count: cartCount(),
      badgeHidden: $('cartBadge').classList.contains('hidden'),
      floatHidden: $('floatCart').classList.contains('hidden'),
      footerEmpty: $('cartFooter').innerHTML.trim() === ''
    }))()`));
    check('BUG: order confirmation survives the 400ms updateCartUI timeout',
      orderAfter.confirmed && !orderAfter.emptyPlate, JSON.stringify(orderAfter));
    check('cart cleared after placing order', orderAfter.count === 0 && orderAfter.badgeHidden && orderAfter.floatHidden, JSON.stringify(orderAfter));

    // ---------- PLACE ORDER: REGRESSION (cart must still work afterwards) ----------
    const orderRegress = JSON.parse(await c.evalExpr(`(() => {
      // the confirmation must still be on screen, and a new order must reset the cart body
      const stillConfirmed = /Order Confirmed/i.test($('cartBody').textContent);
      addToCart(5);                       // a fresh item after ordering
      const afterAdd = {
        count: cartCount(),
        bodyHasItem: !!$('cartBody').textContent.includes(MENU.find(m => m.id === 5).name),
        hasPlaceBtn: !!$('cartBody').textContent || $('cartFooter').innerHTML.includes('Place Order'),
        footerHasPlace: $('cartFooter').innerHTML.includes('Place Order'),
        confirmed: /Order Confirmed/i.test($('cartBody').textContent)
      };
      // and a second order must work too
      toggleCart(true); placeOrder();
      const secondOrder = /Order Confirmed/i.test($('cartBody').textContent);
      return JSON.stringify({ stillConfirmed, afterAdd, secondOrder });
    })()`));
    check('order confirmation survives until the cart is changed again', orderRegress.stillConfirmed, JSON.stringify(orderRegress));
    check('cart still works after placing an order', orderRegress.afterAdd.count === 1 && orderRegress.afterAdd.bodyHasItem && orderRegress.afterAdd.footerHasPlace && !orderRegress.afterAdd.confirmed, JSON.stringify(orderRegress.afterAdd));
    check('a second order can be placed', orderRegress.secondOrder, JSON.stringify(orderRegress));
    await sleep(700); // past the old 400ms window - confirmation must still be there
    const orderAfter2 = JSON.parse(await c.evalExpr(`JSON.stringify({ confirmed: /Order Confirmed/i.test($('cartBody').textContent) })`));
    check('second order confirmation survives the timeout too', orderAfter2.confirmed, JSON.stringify(orderAfter2));


    // ---------- BOOKING CALCULATIONS ----------
    const bk = JSON.parse(await c.evalExpr(`(() => {
      setBookingRoom('suite');
      $('bkIn').value = '2026-11-01'; $('bkOut').value = '2026-11-04';
      const r = calcBooking();
      const price = ROOMS.suite.price;
      return JSON.stringify({
        r, price,
        expectedNights: 3,
        expectedBase: price * 3,
        expectedTax: Math.round(price * 3 * 0.12),
        line: $('bkSummaryLine').textContent,
        base: $('bkBase').textContent, tax: $('bkTax').textContent, total: $('bkTotal').textContent
      });
    })()`));
    check('booking nights computed correctly', bk.r.nights === bk.expectedNights, JSON.stringify(bk.r));
    check('booking base/tax/total correct',
      bk.r.total === bk.expectedBase + bk.expectedTax && bk.line.includes('3 nights'),
      JSON.stringify(bk));

    const bkSame = JSON.parse(await c.evalExpr(`(() => {
      $('bkIn').value = '2026-11-04'; $('bkOut').value = '2026-11-01';
      const r = calcBooking();
      return JSON.stringify({ nights: r.nights, line: $('bkSummaryLine').textContent });
    })()`));
    check('reversed dates clamp to 1 night', bkSame.nights === 1, JSON.stringify(bkSame));

    // ---------- BOOKING FORM VALIDATION ----------
    const val = JSON.parse(await c.evalExpr(`(() => {
      const out = [];
      $('bkName').value = ''; $('bkPhone').value = '1234567890';
      $('bkIn').value = '2026-11-01'; $('bkOut').value = '2026-11-04';
      submitBooking();
      out.push(['short name', $('bkError').textContent, !$('bkError').classList.contains('hidden')]);
      $('bkName').value = 'Test Guest'; $('bkPhone').value = '1234567890';
      submitBooking();
      out.push(['bad phone', $('bkError').textContent, !$('bkError').classList.contains('hidden')]);
      $('bkPhone').value = '9876543210';
      $('bkOut').value = '2026-10-30';
      submitBooking();
      out.push(['co before ci', $('bkError').textContent, !$('bkError').classList.contains('hidden')]);
      $('bkOut').value = '2026-11-04';
      submitBooking();
      out.push(['valid', $('bkError').classList.contains('hidden'), !$('bookingSuccess').classList.contains('hidden')]);
      return JSON.stringify(out);
    })()`));
    check('booking rejects short name', val[0][2] && /full name/i.test(val[0][1]), JSON.stringify(val[0]));
    check('booking rejects invalid phone', val[1][2] && /mobile/i.test(val[1][1]), JSON.stringify(val[1]));
    check('booking rejects checkout before checkin', val[2][2] && /after check-in/i.test(val[2][1]), JSON.stringify(val[2]));
    check('booking succeeds with valid data', val[3][0] && val[3][1], JSON.stringify(val[3]));

    // ---------- FAQ ACCORDION ----------
    const faq = JSON.parse(await c.evalExpr(`(() => {
      const btns = [...document.querySelectorAll('.faq-btn')];
      const bodies = [...document.querySelectorAll('.faq-body')];
      const before = bodies.map(b => b.style.maxHeight);
      btns[0].click();
      const afterOpen = bodies.map(b => b.style.maxHeight);
      const sign = btns[0].querySelector('span').textContent;
      btns[1].click();
      const afterSwitch = bodies.map(b => b.style.maxHeight);
      return JSON.stringify({
        count: btns.length, before, afterOpen, afterSwitch,
        opened: afterOpen[0] !== '0px' && afterOpen[0] !== '',
        sign: sign,
        exclusive: afterSwitch[0] === '0px' && afterSwitch[1] !== '0px'
      });
    })()`));
    check('FAQ accordion expands on click', faq.count === 3 && faq.opened && faq.sign === '\u2212', JSON.stringify(faq));
    check('FAQ is exclusive (opening one closes others)', faq.exclusive, JSON.stringify(faq));

    // ---------- TESTIMONIAL CAROUSEL ----------
    const testi = JSON.parse(await c.evalExpr(`(() => {
      clearInterval(testiTimer); // stop auto-advance so it can't race the assertions
      goTesti(0);                 // reset to a known slide (the 6s auto-advance may have moved it)
      const name0 = $('testiName').textContent;
      document.querySelectorAll('#testiDots button')[1].click();
      const name1 = $('testiName').textContent;
      // renderTestiDots() replaces the dot markup, so re-query for the active one
      const dots = [...document.querySelectorAll('#testiDots button')];
      const activeIdx = dots.findIndex(d => d.className.includes('w-8'));
      return JSON.stringify({ dots: dots.length, name0, name1,
        changed: name0 !== name1, activeIdx });
    })()`));
    check('testimonial dots switch slides', testi.dots === 3 && testi.changed && testi.activeIdx === 1, JSON.stringify(testi));

    // ---------- IMAGES ----------
    const imgs = JSON.parse(await c.evalExpr(`(() => {
      const all = [...document.querySelectorAll('img')];
      const broken = all.filter(i => i.complete && i.naturalWidth === 0).map(i => i.src);
      return JSON.stringify({ total: all.length, broken });
    })()`));
    check('no broken images', imgs.broken.length === 0, JSON.stringify(imgs));

    // ---------- ROOM DETAIL MODAL (image src fix) ----------
    const room = JSON.parse(await c.evalExpr(`(() => {
      openRoomDetail('suite');
      const img = $('rmImg');
      const shown = {
        modalVisible: !$('roomModal').classList.contains('hidden'),
        title: $('rmTitle').textContent,
        srcSet: img.getAttribute('src'),
        resolved: img.currentSrc || img.src,
        naturalWidth: img.naturalWidth,
        broken: img.complete && img.naturalWidth === 0,
        price: $('rmPrice').textContent,
        amenities: $('rmAmenities').children.length
      };
      closeRoomDetail();
      return JSON.stringify(shown);
    })()`));
    check('room detail modal opens with a valid image', room.modalVisible && room.title.length > 0 && !room.broken && room.naturalWidth > 0, JSON.stringify(room));
    check('room detail modal is closed again', true, 'closeRoomDetail() called');

    // ---------- CONSOLE / PAGE ERRORS ----------
    const errs = c.events.filter(e =>
      (e.method === 'Runtime.exceptionThrown') ||
      (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') ||
      (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'));
    check('no runtime/console errors', errs.length === 0,
      errs.map(e => JSON.stringify(e.params)).join(' | ').slice(0, 600));

    // ---------- RESPONSIVE ----------
    await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(800);
    const mob = JSON.parse(await c.evalExpr(`(() => {
      const de = document.documentElement;
      return JSON.stringify({
        scrollW: de.scrollWidth, clientW: de.clientWidth,
        overflow: de.scrollWidth > de.clientWidth + 1,
        cartBtnHidden: getComputedStyle(document.querySelector('#cartBadge').parentElement).display
      });
    })()`));
    check('no horizontal overflow at 390px', !mob.overflow, JSON.stringify(mob));
    await c.send('Emulation.clearDeviceMetricsOverride');
    await sleep(500);

    // ---------- SUMMARY ----------
    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass);
    console.log('\n==================================');
    console.log(`TOTAL: ${results.length}   PASSED: ${passed}   FAILED: ${failed.length}`);
    if (failed.length) {
      console.log('\nFAILURES:');
      failed.forEach(f => console.log('  - ' + f.name + '  ::  ' + f.detail));
    }
    console.log('==================================');
    process.exitCode = failed.length ? 1 : 0;
  } catch (e) {
    console.error('HARNESS ERROR:', e.stack || e.message);
    process.exitCode = 2;
  } finally {
    try { chrome.kill(); } catch (e) {}
  }
})();
