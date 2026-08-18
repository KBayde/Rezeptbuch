import {
    listShoppingListItems,
    getWeeklyHouseholdCosts,
    getPriceHistoryInRange,
    getRecentPriceHistory,
} from "./db.js";
import {
    escapeHtml,
    formatPrice,
    categorizeIngredient,
    CATEGORY_ORDER,
    getWeekStart,
    addDays,
    formatDateISO,
    formatDateDisplay,
    WEEKDAY_LABELS_DE,
} from "./utils.js";

const CATEGORY_COLORS = {
    meat: "#ad3b26",
    dairy: "#f2c166",
    produce: "#8fa27a",
    bakery: "#c98a4b",
    frozen: "#6fa8b8",
    beverages: "#7a9bc4",
    spices: "#b5651d",
    pantry: "#d9a640",
    other: "#8c7f6e",
};

const BUDGET_KEYS = { week: "cookcook-budget-week", month: "cookcook-budget-month" };

function getBudget(period) {
    const raw = localStorage.getItem(BUDGET_KEYS[period]);
    const n = Number(raw);
    return raw && !Number.isNaN(n) && n > 0 ? n : null;
}
function setBudget(period, value) {
    if (value === null) localStorage.removeItem(BUDGET_KEYS[period]);
    else localStorage.setItem(BUDGET_KEYS[period], String(value));
}

export async function renderHouseholdCosts(container) {
    let period = "week"; // "week" | "month"

  container.innerHTML = `
      <div class="page-header">
            <div>
                    <h1>Kosten-Tracker</h1>
                            <p class="text-muted">Ausgaben für Lebensmittel im Überblick – geplant vs. tatsächlich.</p>
                                  </div>
                                        <a href="#/einkaufsliste" class="btn btn-secondary">← Zur Einkaufsliste</a>
                                            </div>

                                                <div class="chip-row">
                                                      <button class="chip chip-toggle" data-period="week" type="button">Woche</button>
                                                            <button class="chip chip-toggle" data-period="month" type="button">Monat</button>
                                                                </div>

                                                                    <div id="cost-content">
                                                                          <p class="text-muted">Lade Kostenübersicht…</p>
                                                                              </div>
                                                                                `;

  const content = container.querySelector("#cost-content");
    const periodButtons = container.querySelectorAll(".chip-toggle");

  periodButtons.forEach((btn) => {
        btn.classList.toggle("chip-toggle--active", btn.dataset.period === period);
        btn.addEventListener("click", () => {
                if (btn.dataset.period === period) return;
                period = btn.dataset.period;
                periodButtons.forEach((b) => b.classList.toggle("chip-toggle--active", b.dataset.period === period));
                load();
        });
  });

  function skeletonHtml() {
        content.innerHTML = `
              <div class="card cost-summary-card">
                      <div>
                                <p class="text-muted" id="cost-period-label"></p>
                                          <p class="cost-summary-total" id="cost-total"></p>
                                                    <p class="text-muted" id="cost-planned-line"></p>
                                                            </div>
                                                                    <p class="cost-compare" id="cost-compare"></p>
                                                                          </div>

                                                                                <div class="card cost-chart-card">
                                                                                        <h2 id="cost-chart-title">Ausgaben nach Tag</h2>
                                                                                                <div class="cost-bar-chart" id="cost-bar-chart"></div>
                                                                                                      </div>
                                                                                                      
                                                                                                            <div class="cost-grid">
                                                                                                                    <div class="card">
                                                                                                                              <h2>Ausgaben nach Kategorie</h2>
                                                                                                                                        <div class="cost-donut-wrap">
                                                                                                                                                    <div class="cost-donut" id="cost-donut"></div>
                                                                                                                                                                <ul class="cost-category-list" id="cost-category-list"></ul>
                                                                                                                                                                          </div>
                                                                                                                                                                                    <p class="empty-state" id="cost-category-empty" hidden>Noch keine Ausgaben in diesem Zeitraum.</p>
                                                                                                                                                                                            </div>
                                                                                                                                                                                            
                                                                                                                                                                                                    <div class="card">
                                                                                                                                                                                                              <h2 id="cost-budget-title">Wochenbudget</h2>
                                                                                                                                                                                                                        <p class="text-muted" id="cost-budget-label"></p>
                                                                                                                                                                                                                                  <div class="cost-budget-bar"><div class="cost-budget-fill" id="cost-budget-fill"></div></div>
                                                                                                                                                                                                                                            <p class="text-small text-muted" id="cost-budget-remaining"></p>
                                                                                                                                                                                                                                                      <button class="btn btn-ghost btn-small" id="cost-budget-edit" type="button">Budget anpassen</button>
                                                                                                                                                                                                                                                              </div>
                                                                                                                                                                                                                                                                    </div>
                                                                                                                                                                                                                                                                    
                                                                                                                                                                                                                                                                          <div class="card">
                                                                                                                                                                                                                                                                                  <h2>Letzte Ausgaben</h2>
                                                                                                                                                                                                                                                                                          <ul class="cost-recent-list" id="cost-recent-list"></ul>
                                                                                                                                                                                                                                                                                                  <p class="empty-state" id="cost-recent-empty" hidden>Noch keine Ausgaben erfasst.</p>
                                                                                                                                                                                                                                                                                                        </div>
                                                                                                                                                                                                                                                                                                        
                                                                                                                                                                                                                                                                                                              <div class="card">
                                                                                                                                                                                                                                                                                                                      <h2>Verlauf über mehrere Wochen</h2>
                                                                                                                                                                                                                                                                                                                              <ul class="cost-history-list" id="cost-history-list"></ul>
                                                                                                                                                                                                                                                                                                                                      <p class="empty-state" id="cost-history-empty" hidden>Noch kein Verlauf vorhanden – wird befüllt, sobald erledigte Einkaufsposten mit Preis entfernt werden.</p>
                                                                                                                                                                                                                                                                                                                                            </div>
                                                                                                                                                                                                                                                                                                                                                `;
  }

  function dayBarChartHtml(dayTotals) {
        const max = Math.max(1, ...dayTotals.map((d) => d.amount));
        return dayTotals
          .map(
                    (d) => `
                            <div class="cost-bar" title="${escapeHtml(d.label)}: ${formatPrice(d.amount)} €">
                                      <div class="cost-bar-track">
                                                  <div class="cost-bar-fill" style="height:${d.amount > 0 ? Math.max(4, Math.round((d.amount / max) * 100)) : 0}%"></div>
                                                            </div>
                                                                      <span class="cost-bar-label">${escapeHtml(d.shortLabel)}</span>
                                                                              </div>
                                                                                    `
                  )
          .join("");
  }

  function donutGradient(categories, total) {
        if (total <= 0) return "conic-gradient(var(--color-border) 0% 100%)";
        let cumulative = 0;
        const stops = categories.map((c) => {
                const pct = (c.amount / total) * 100;
                const stop = `${CATEGORY_COLORS[c.key] || CATEGORY_COLORS.other} ${cumulative}% ${cumulative + pct}%`;
                cumulative += pct;
                return stop;
        });
        return `conic-gradient(${stops.join(", ")})`;
  }

  function categoryListHtml(categories, total) {
        return categories
          .map((c) => {
                    const pct = total > 0 ? Math.round((c.amount / total) * 100) : 0;
                    return `
                              <li class="cost-category-row">
                                          <span class="cost-category-dot" style="background:${CATEGORY_COLORS[c.key] || CATEGORY_COLORS.other}"></span>
                                                      <span class="cost-category-icon">${c.icon}</span>
                                                                  <span class="cost-category-name">${escapeHtml(c.label)}</span>
                                                                              <span class="cost-category-amount">${formatPrice(c.amount)} € <span class="text-muted">(${pct}%)</span></span>
                                                                                        </li>
                                                                                                `;
          })
          .join("");
  }

  function recentListHtml(entries, todayIso) {
        return entries
          .map((e) => {
                    const cat = categorizeIngredient(e.ingredientName);
                    const dateLabel =
                                e.recordedDate === todayIso ? "heute" : formatDateDisplay(new Date(`${e.recordedDate}T00:00:00`));
                    return `
                              <li class="cost-recent-item">
                                          <span class="cost-recent-icon">${cat.icon}</span>
                                                      <span class="cost-recent-name">${escapeHtml(e.ingredientName)}</span>
                                                                  <span class="cost-recent-date text-muted">${dateLabel}</span>
                                                                              <span class="cost-recent-price">${formatPrice(e.price)} €</span>
                                                                                        </li>
                                                                                                `;
          })
          .join("");
  }

  function historyListHtml(rows) {
        return rows
          .map((w) => {
                    const start = new Date(`${w.weekStart}T00:00:00`);
                    const end = addDays(start, 6);
                    const diff = w.actualTotal - w.plannedTotal;
                    const diffClass = diff > 0.004 ? "cost-diff--over" : diff < -0.004 ? "cost-diff--under" : "";
                    const diffLabel =
                                Math.abs(diff) < 0.005 ? "genau geplant" : `${diff > 0 ? "+" : ""}${formatPrice(diff)} €`;
                    return `
                              <li class="cost-history-row">
                                          <span class="cost-history-label">${formatDateDisplay(start)} – ${formatDateDisplay(end)}</span>
                                                      <span class="cost-history-planned text-muted">geplant ${formatPrice(w.plannedTotal)} €</span>
                                                                  <span class="cost-history-actual">${formatPrice(w.actualTotal)} €</span>
                                                                              <span class="cost-diff ${diffClass}">${diffLabel}</span>
                                                                                        </li>
                                                                                                `;
          })
          .join("");
  }

  async function load() {
        skeletonHtml();

      const today = new Date();
        const todayIso = formatDateISO(today);
        const weekStart = getWeekStart(today);
        const weekEnd = addDays(weekStart, 6);
        const weekStartIso = formatDateISO(weekStart);
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

      let liveItems, weeklyCosts, periodEntries, recentEntries;
        try {
                const rangeStart = period === "week" ? weekStart : monthStart;
                const rangeEnd = period === "week" ? weekEnd : monthEnd;
                [liveItems, weeklyCosts, periodEntries, recentEntries] = await Promise.all([
                          listShoppingListItems(),
                          getWeeklyHouseholdCosts(26),
                          getPriceHistoryInRange(formatDateISO(rangeStart), formatDateISO(rangeEnd)),
                          getRecentPriceHistory(8),
                        ]);
        } catch (err) {
                content.innerHTML = `<p class="form-error">Kostenübersicht konnte nicht geladen werden: ${escapeHtml(
                          err.message
                        )}</p>`;
                return;
        }

      const liveActualEntries = liveItems
          .filter((i) => i.checked && i.actualPrice !== null)
          .map((i) => ({ ingredientName: i.name, price: i.actualPrice, recordedDate: todayIso }));
        const livePlannedSum = liveItems.reduce((s, i) => s + (i.plannedPrice || 0), 0);
        const liveActualSum = liveActualEntries.reduce((s, e) => s + e.price, 0);
        const combinedEntries = [...periodEntries, ...liveActualEntries];

      const committedThisWeek = weeklyCosts.find((w) => w.weekStart === weekStartIso);
        let totalPlanned, totalActual, prevActual, prevLabel;

      if (period === "week") {
              totalPlanned = (committedThisWeek?.plannedTotal || 0) + livePlannedSum;
              totalActual = (committedThisWeek?.actualTotal || 0) + liveActualSum;
              const prevWeekIso = formatDateISO(addDays(weekStart, -7));
              const prevWeek = weeklyCosts.find((w) => w.weekStart === prevWeekIso);
              prevActual = prevWeek?.actualTotal || 0;
              prevLabel = "letzte Woche";
      } else {
              const weeksInMonth = weeklyCosts.filter((w) => {
                        const d = new Date(`${w.weekStart}T00:00:00`);
                        return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth();
              });
              totalPlanned = weeksInMonth.reduce((s, w) => s + w.plannedTotal, 0) + livePlannedSum;
              totalActual = weeksInMonth.reduce((s, w) => s + w.actualTotal, 0) + liveActualSum;
              const prevMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
              const weeksInPrevMonth = weeklyCosts.filter((w) => {
                        const d = new Date(`${w.weekStart}T00:00:00`);
                        return d.getFullYear() === prevMonthDate.getFullYear() && d.getMonth() === prevMonthDate.getMonth();
              });
              prevActual = weeksInPrevMonth.reduce((s, w) => s + w.actualTotal, 0);
              prevLabel = "letzter Monat";
      }

      const periodLabelEl = content.querySelector("#cost-period-label");
        const totalEl = content.querySelector("#cost-total");
        const plannedLineEl = content.querySelector("#cost-planned-line");
        const compareEl = content.querySelector("#cost-compare");

      periodLabelEl.textContent =
              period === "week"
            ? `Diese Woche · ${formatDateDisplay(weekStart)} – ${formatDateDisplay(weekEnd)}`
                : `Dieser Monat · ${today.toLocaleDateString("de-DE", { month: "long", year: "numeric" })}`;
        totalEl.textContent = `${formatPrice(totalActual)} €`;
        plannedLineEl.textContent = totalPlanned > 0 ? `davon geplant: ${formatPrice(totalPlanned)} €` : "";

      if (prevActual <= 0 && totalActual <= 0) {
              compareEl.textContent = "";
      } else if (prevActual <= 0) {
              compareEl.innerHTML = `<span class="text-muted">Noch keine Vergleichsdaten aus ${escapeHtml(prevLabel)}.</span>`;
      } else {
              const diff = totalActual - prevActual;
              const pct = Math.round((diff / prevActual) * 100);
              const arrow = diff > 0 ? "↑" : diff < 0 ? "↓" : "→";
              const cls = diff > 0 ? "cost-compare--up" : diff < 0 ? "cost-compare--down" : "cost-compare--flat";
              compareEl.innerHTML = `<span class="${cls}">${arrow} ${formatPrice(Math.abs(diff))} € (${
                        pct > 0 ? "+" : ""
              }${pct}%) vs. ${escapeHtml(prevLabel)}</span>`;
      }

      const chartTitleEl = content.querySelector("#cost-chart-title");
        const barChartEl = content.querySelector("#cost-bar-chart");

      if (period === "week") {
              chartTitleEl.textContent = "Ausgaben nach Tag";
              const dayIsos = Array.from({ length: 7 }, (_, i) => formatDateISO(addDays(weekStart, i)));
              const dayTotals = dayIsos.map((iso, i) => ({
                        label: WEEKDAY_LABELS_DE[i],
                        shortLabel: WEEKDAY_LABELS_DE[i].slice(0, 2),
                        amount: combinedEntries.filter((e) => e.recordedDate === iso).reduce((s, e) => s + e.price, 0),
              }));
              barChartEl.innerHTML = dayBarChartHtml(dayTotals);
      } else {
              chartTitleEl.textContent = "Ausgaben nach Woche";
              const weeksInMonth = weeklyCosts
                .filter((w) => {
                            const d = new Date(`${w.weekStart}T00:00:00`);
                            return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth();
                })
                .map((w) => ({ weekStart: w.weekStart, amount: w.actualTotal }));
              if (!weeksInMonth.some((w) => w.weekStart === weekStartIso)) {
                        weeksInMonth.push({ weekStart: weekStartIso, amount: 0 });
              }
              const merged = weeksInMonth
                .map((w) => ({
                            weekStart: w.weekStart,
                            amount: w.weekStart === weekStartIso ? w.amount + liveActualSum : w.amount,
                }))
                .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
              const weekTotals = merged.map((w) => {
                        const d = new Date(`${w.weekStart}T00:00:00`);
                        return { label: formatDateDisplay(d), shortLabel: formatDateDisplay(d), amount: w.amount };
              });
              barChartEl.innerHTML = dayBarChartHtml(weekTotals);
      }

      const donutEl = content.querySelector("#cost-donut");
        const categoryListEl = content.querySelector("#cost-category-list");
        const categoryEmptyEl = content.querySelector("#cost-category-empty");

      const categoryMap = new Map();
        for (const e of combinedEntries) {
                const cat = categorizeIngredient(e.ingredientName);
                const existing = categoryMap.get(cat.key);
                if (existing) existing.amount += e.price;
                else categoryMap.set(cat.key, { key: cat.key, label: cat.label, icon: cat.icon, amount: e.price });
        }
        const categories = CATEGORY_ORDER.filter((k) => categoryMap.has(k))
          .map((k) => categoryMap.get(k))
          .sort((a, b) => b.amount - a.amount);
        const categoryTotal = categories.reduce((s, c) => s + c.amount, 0);

      if (categories.length === 0) {
              donutEl.style.background = "var(--color-border)";
              categoryListEl.innerHTML = "";
              categoryEmptyEl.hidden = false;
      } else {
              donutEl.style.background = donutGradient(categories, categoryTotal);
              categoryListEl.innerHTML = categoryListHtml(categories, categoryTotal);
              categoryEmptyEl.hidden = true;
      }

      const budgetTitleEl = content.querySelector("#cost-budget-title");
        const budgetLabelEl = content.querySelector("#cost-budget-label");
        const budgetFillEl = content.querySelector("#cost-budget-fill");
        const budgetRemainingEl = content.querySelector("#cost-budget-remaining");
        const budgetEditBtn = content.querySelector("#cost-budget-edit");

      budgetTitleEl.textContent = period === "week" ? "Wochenbudget" : "Monatsbudget";
        const budget = getBudget(period);
        if (budget === null) {
                budgetLabelEl.textContent = `Noch kein ${period === "week" ? "Wochen" : "Monats"}budget gesetzt.`;
                budgetFillEl.style.width = "0%";
                budgetFillEl.classList.remove("cost-budget-fill--over");
                budgetRemainingEl.textContent = "";
        } else {
                const pct = Math.min(100, Math.round((totalActual / budget) * 100));
                budgetLabelEl.textContent = `${formatPrice(totalActual)} € / ${formatPrice(budget)} €`;
                budgetFillEl.style.width = `${pct}%`;
                budgetFillEl.classList.toggle("cost-budget-fill--over", totalActual > budget);
                const remaining = budget - totalActual;
                budgetRemainingEl.textContent =
                          remaining >= 0 ? `${formatPrice(remaining)} € übrig` : `${formatPrice(-remaining)} € über Budget`;
        }
        budgetEditBtn.addEventListener("click", () => {
                const current = getBudget(period);
                const input = prompt(
                          `${period === "week" ? "Wochenbudget" : "Monatsbudget"} in € (leer lassen zum Entfernen):`,
                          current !== null ? String(current) : ""
                        );
                if (input === null) return;
                const trimmed = input.trim();
                if (trimmed === "") {
                          setBudget(period, null);
                } else {
                          const value = Number(trimmed.replace(",", "."));
                          if (!Number.isFinite(value) || value <= 0) {
                                      alert("Bitte eine gültige Zahl größer 0 eingeben.");
                                      return;
                          }
                          setBudget(period, value);
                }
                load();
        });

      const recentListEl = content.querySelector("#cost-recent-list");
        const recentEmptyEl = content.querySelector("#cost-recent-empty");
        const mergedRecent = [...liveActualEntries, ...recentEntries]
          .sort((a, b) => b.recordedDate.localeCompare(a.recordedDate))
          .slice(0, 8);
        if (mergedRecent.length === 0) {
                recentListEl.innerHTML = "";
                recentEmptyEl.hidden = false;
        } else {
                recentListEl.innerHTML = recentListHtml(mergedRecent, todayIso);
                recentEmptyEl.hidden = true;
        }

      const historyListEl = content.querySelector("#cost-history-list");
        const historyEmptyEl = content.querySelector("#cost-history-empty");
        const historyRows = weeklyCosts.slice(0, 10);
        if (historyRows.length === 0) {
                historyListEl.innerHTML = "";
                historyEmptyEl.hidden = false;
        } else {
                historyListEl.innerHTML = historyListHtml(historyRows);
                historyEmptyEl.hidden = true;
        }
  }

  await load();
}
