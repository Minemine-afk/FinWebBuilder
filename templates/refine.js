/* Chat-style refinement panel for a published calculator. Inlined by lib/render.ts; config below is filled in per page. */
(function () {
  var cfg = __REFINE_CONFIG__;
  var KINDS = { compare: "comparison", estimate: "cost estimate", projection: "projection" };
  var KEY = "refine-chat:" + cfg.slug;
  var root = document.getElementById("refine-root");
  if (!root) return;

  function store(get, k, v) { try { return get ? sessionStorage.getItem(k) : sessionStorage.setItem(k, v); } catch { return null; } }
  var log = [];
  try { log = JSON.parse(store(true, KEY) || "[]"); } catch { log = []; }

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; }
  var open = el("button", "rf-open", "Suggest a change");
  var panel = el("div", "rf-panel"); panel.hidden = true; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Suggest a change to this calculator");
  var head = el("div", "rf-head");
  head.appendChild(el("strong", "", "Change this calculator"));
  var close = el("button", "rf-x", "×"); close.setAttribute("aria-label", "Close"); head.appendChild(close);
  var intro = el("p", "rf-note", "This is a " + KINDS[cfg.kind] + ". Ask for a change and it is rebuilt and published in a few minutes. An edit that needs no new prices costs about S$0.20 and uses the quicker model.");
  var chat = el("div", "rf-chat"); chat.setAttribute("aria-live", "polite");
  var chips = el("div", "rf-chips");
  var form = el("form", "rf-form");
  var pass = el("input", "rf-in"); pass.type = "password"; pass.placeholder = "Builder passcode"; pass.autocomplete = "current-password"; pass.value = store(true, "refine-pass") || "";
  var box = el("textarea", "rf-in"); box.rows = 2; box.maxLength = 500; box.required = true; box.placeholder = "e.g. Add a hybrid car, or recheck the BYD Atto 1 price";
  var cheap = el("label", "rf-check"); var cb = el("input"); cb.type = "checkbox"; cheap.appendChild(cb); cheap.appendChild(document.createTextNode(" No new research (cheapest: edits only what the page already holds)"));
  var send = el("button", "rf-send", "Send"); send.type = "submit";
  [pass, box, cheap, send].forEach(function (n) { form.appendChild(n); });
  [intro, chat, chips, form].forEach(function (n) { panel.appendChild(n); }); panel.insertBefore(head, panel.firstChild);
  root.appendChild(open); root.appendChild(panel);

  function say(who, text) { log.push({ who: who, text: text }); log = log.slice(-30); store(false, KEY, JSON.stringify(log)); draw(); }
  function draw() {
    chat.textContent = "";
    log.forEach(function (m) { chat.appendChild(el("p", "rf-msg rf-" + m.who, m.text)); });
    chat.scrollTop = chat.scrollHeight;
  }
  draw();

  [["Add more options", "Add more options, keeping the existing ones.", false], ["Recheck prices", "Recheck the prices and sources, and update any that changed.", false], ["Fix wording", "Tighten the wording of the scope, limits and notes.", true]].forEach(function (c) {
    var b = el("button", "rf-chip", c[0]); b.type = "button"; b.onclick = function () { box.value = c[1]; cb.checked = c[2]; box.focus(); }; chips.appendChild(b);
  });
  Object.keys(KINDS).filter(function (k) { return k !== cfg.kind; }).forEach(function (k) {
    var b = el("button", "rf-chip", "Rebuild as " + KINDS[k]); b.type = "button";
    b.onclick = function () { post("Rebuild this as a " + KINDS[k] + ", keeping the prices already here.", k, false); };
    chips.appendChild(b);
  });

  open.onclick = function () { panel.hidden = false; open.hidden = true; box.focus(); };
  close.onclick = function () { panel.hidden = true; open.hidden = false; };
  form.onsubmit = function (e) { e.preventDefault(); var t = box.value.trim(); if (t) post(t, null, cb.checked); };

  function post(prompt, kind, noResearch) {
    if (!pass.value) { say("bot", "Enter the builder passcode first."); pass.focus(); return; }
    store(false, "refine-pass", pass.value);
    say("me", prompt); box.value = ""; send.disabled = true;
    var body = { mode: "refine", passcode: pass.value, slug: cfg.slug, prompt: prompt };
    if (kind) body.kind = kind;
    if (noResearch) body.noResearch = true;
    fetch("/api/build", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (r) {
        if (!r.ok) { say("bot", r.d.error || "Something went wrong."); send.disabled = false; return; }
        say("bot", kind ? "Rebuilding as a " + KINDS[kind] + ". This takes a few minutes." : noResearch ? "Editing without new research. This takes a minute or two." : "Working on it. This takes a few minutes.");
        watch();
      })
      .catch(function () { say("bot", "Couldn't reach the server."); send.disabled = false; });
  }

  function watch() {
    var seen = false, tries = 0;
    (function tick() {
      fetch("/api/builds", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (d) {
        var mine = (d.runs || []).filter(function (r) { return r.kind === "refine" && r.title.indexOf(cfg.slug) === 0; });
        if (mine.length) { seen = true; var last = log[log.length - 1]; if (!last || last.text !== mine[0].step) say("bot", mine[0].step); }
        tries++;
        if (seen && !mine.length) { say("bot", "Done. The site redeploys in about a minute; reload then to see the new version."); send.disabled = false; return; }
        if (tries > 120) { send.disabled = false; return; }
        setTimeout(tick, seen ? 6000 : 4000);
      }).catch(function () { setTimeout(tick, 8000); });
    })();
  }
})();
