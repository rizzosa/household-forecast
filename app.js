const form = document.getElementById('inputs');
const chart = document.getElementById('chart');
const cash = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0
});
const signedCash = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0, signDisplay: 'exceptZero'
});
const compactCash = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1
});
const setText = (id, value) => { document.getElementById(id).textContent = value; };
let chartData;
let bestDownPayment = null;
let jointSettings;
let jointResult;

const monthAndYear = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
const defaultsStorageKey = 'household-forecast.private-defaults.v1';
const defaultFields = [
  'person1Roth', 'yourRetirement', 'yourInvestments', 'person1Salary', 'person1Housing',
  'roth', 'traditional', 'partnerInvestments', 'person2Salary', 'person2Housing',
  'trust', 'equity', 'leaseEnd'
];

function readDefaults(text) {
  const contents = text.trim();
  const localScript = contents.match(/^window\.localForecastDefaults\s*=\s*([\s\S]+);$/);
  const values = JSON.parse(localScript ? localScript[1] : contents);
  if (!values || Array.isArray(values) || typeof values !== 'object') throw new Error('Invalid defaults');
  const entries = Object.entries(values);
  if (!entries.length || entries.some(([name, value]) => {
    if (!defaultFields.includes(name)) return true;
    if (name === 'leaseEnd') return typeof value !== 'string' || !/^(?:\d{4}-(?:0[1-9]|1[0-2]))?$/.test(value);
    return !['number', 'string'].includes(typeof value) || !/^\d+$/.test(String(value)) ||
      !Number.isSafeInteger(Number(value));
  })) throw new Error('Invalid defaults');
  return values;
}

function applyDefaults(values) {
  for (const [name, value] of Object.entries(values)) {
    form.elements.namedItem(name).value = value;
  }
}

function resetDefaultFields() {
  for (const name of defaultFields) {
    const field = form.elements.namedItem(name);
    field.value = field.defaultValue;
  }
}

function initHostedDefaults() {
  const fileInput = document.getElementById('defaults-file');
  const clearButton = document.getElementById('clear-defaults');
  document.getElementById('private-defaults').hidden = false;

  try {
    const saved = window.localStorage.getItem(defaultsStorageKey);
    if (saved) {
      applyDefaults(readDefaults(saved));
      clearButton.hidden = false;
      setText('defaults-status', 'Saved defaults loaded for this browser.');
    }
  } catch {
    setText('defaults-status', 'Saved defaults could not be loaded. You can import them again.');
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    let values;
    try {
      if (file.size > 16384) throw new Error('Defaults file is too large');
      values = readDefaults(await file.text());
    } catch {
      setText('defaults-status', 'Could not read that file. Choose local-defaults.js or a JSON defaults file.');
      return;
    } finally {
      fileInput.value = '';
    }
    resetDefaultFields();
    applyDefaults(values);
    clearButton.hidden = false;
    update();
    try {
      window.localStorage.setItem(defaultsStorageKey, JSON.stringify(values));
      setText('defaults-status', 'Defaults applied and saved in this browser.');
    } catch {
      setText('defaults-status', 'Defaults applied for this visit. This browser blocked saving them.');
    }
  });

  clearButton.addEventListener('click', () => {
    try {
      window.localStorage.removeItem(defaultsStorageKey);
    } catch {
      setText('defaults-status', 'Browser storage could not be cleared. Clear this site’s data in your browser settings.');
      return;
    }
    resetDefaultFields();
    clearButton.hidden = true;
    setText('defaults-status', 'Defaults cleared from this browser.');
    update();
  });
}

function resetJointOptimizer(settings) {
  jointSettings = settings;
  jointResult = null;
  const eligible = settings?.useBudget && settings.buy && settings.price > 0 &&
    settings.buyIn <= settings.years && settings.earliestMoveMonths < settings.buyIn * 12;
  document.getElementById('joint-run').disabled = !eligible;
  document.getElementById('joint-apply').hidden = true;
  setText('joint-result', eligible ? '' : settings && !settings.useBudget
    ? 'Turn on Estimate savings from income and expenses to compare move-in dates.'
    : 'Enter a valid budget and leave at least one eligible move-in month before buying.');
}

async function runJointOptimizer() {
  const settings = jointSettings;
  const run = document.getElementById('joint-run');
  run.disabled = true;
  document.getElementById('joint-apply').hidden = true;
  jointResult = null;
  setText('joint-result', 'Comparing move-in months and down payments…');
  let best;
  let waitUntilLeaseEnds;
  let tiedMonths = 0;
  for (let moveInMonths = settings.earliestMoveMonths; moveInMonths < settings.buyIn * 12; moveInMonths++) {
    // Yield between months so edits can cancel an outdated search.
    await new Promise(resolve => setTimeout(resolve, 0));
    if (jointSettings !== settings) return;
    const option = forecast.optimizeDownPayment({ ...settings, moveInMonths });
    if (!option) continue;
    if (moveInMonths === settings.leaseEndMonths) waitUntilLeaseEnds = option;
    if (!best || option.score > best.score + 0.005) {
      best = { ...option, moveInMonths };
      tiedMonths = 1;
    } else if (Math.abs(option.score - best.score) <= 0.005) {
      tiedMonths++;
    }
  }
  run.disabled = false;
  if (!best) {
    setText('joint-result', 'No combination met your closing costs, cash reserve, monthly budget, and payment cap.');
    return;
  }
  jointResult = best;
  const date = new Date(settings.startYear, settings.startMonth + best.moveInMonths, 1);
  const when = best.moveInMonths === 0 ? 'this month' : `in ${monthAndYear.format(date)}`;
  const tie = tiedMonths > 1 ? ` ${tiedMonths} move-in months tied to the cent. This shows the earliest.` : '';
  const difference = waitUntilLeaseEnds && best.score - waitUntilLeaseEnds.score >= 0.5
    ? ` That is ${cash.format(best.score - waitUntilLeaseEnds.score)} more at the forecast horizon than moving at lease end with the best down payment for that date.` : '';
  setText('joint-result', `Move in ${when} and put ${best.down}% down (${cash.format(settings.price * best.down / 100)}). Projected ending wealth is ${cash.format(best.score)}, with ${cash.format(best.closingCash)} available after closing.${tie}${difference}`);
  document.getElementById('joint-apply').hidden = false;
}

function updateHousingSchedule(settings, lease) {
  const sharedPayment = settings.movedHousing === 'custom' ? settings.customHousing : settings.person2Housing;
  const rent = settings.person1Housing;
  const phases = [];
  if (settings.moveInMonths > 0) phases.push(['Before moving in', rent, settings.person2Housing]);
  if (lease.rentMonthsAfterMove > 0) {
    const months = lease.rentMonthsAfterMove;
    phases.push([`After moving in · ${months} month${months === 1 ? '' : 's'} of rent`, rent, sharedPayment]);
  }
  if (lease.takeoverMonth !== null) phases.push(['Reletting month · one-time fee', rent, sharedPayment]);
  phases.push([lease.overlapMonths ? 'After Person 1’s lease obligation ends' : 'After moving in', 0, sharedPayment]);
  document.getElementById('lease-rows').innerHTML = phases.map(([label, sam, shared]) =>
    `<tr><th scope="row">${label}</th><td>${cash.format(sam)}</td><td>${cash.format(shared)}</td><td>${cash.format(sam + shared)}</td></tr>`
  ).join('');
}

function updateTiming(settings) {
  const firstYear = Math.floor(settings.moveInMonths / 12) + 1;
  const rows = [];
  if (settings.buy && settings.price > 0) {
    for (let buyIn = firstYear; buyIn <= settings.years; buyIn++) {
      rows.push({ buyIn, ...forecast.compareDownPayment({ ...settings, buyIn }) });
    }
  }
  document.getElementById('timing-table').hidden = !rows.length;
  const earliest = rows.find(row => !row.issues.length);
  const moveSummary = settings.moveInMonths === 0 ? 'Move in together today.'
    : `Move in together in ${monthAndYear.format(settings.moveDate)}.`;
  const summary = earliest
    ? `Earliest year that meets your limits at ${settings.down}% down is ${settings.startYear + earliest.buyIn}.`
    : rows.length ? `No purchase year meets your limits at ${settings.down}% down.`
      : 'Include a home purchase with an annual forecast date after moving in to compare dates.';
  setText('timing-summary', `${moveSummary} ${summary}`);
  const displayCash = value => value === null ? '—' : cash.format(value);
  document.getElementById('timing-rows').innerHTML = rows
    .filter((row, index) => index < 5 || row === earliest || row.buyIn === settings.buyIn)
    .map(row => {
      const selected = row.buyIn === settings.buyIn;
      const cells = [displayCash(row.cashToClose), displayCash(row.closingCash),
        displayCash(row.endingNetWorth), row.issues.join(', ') || 'Meets limits'];
      return `<tr${selected ? ' class="purchase-row"' : ''}><th scope="row">${settings.startYear + row.buyIn}${selected ? ' · Selected' : ''}</th>${cells.map(value => `<td>${value}</td>`).join('')}</tr>`;
    }).join('');
}

function updateOptimizer(settings, result) {
  bestDownPayment = forecast.optimizeDownPayment(settings);
  const button = document.getElementById('optimizer-apply');
  button.hidden = !bestDownPayment;
  const canCompare = settings.buy && settings.buyIn * 12 > settings.moveInMonths &&
    settings.buyIn <= settings.years && settings.price > 0;
  document.getElementById('optimizer-table').hidden = !canCompare;
  setText('optimizer-difference-label', settings.useBudget ? 'Ending difference vs. your selection'
    : 'Ending difference vs. your selection with payment savings invested');
  setText('optimizer-method', settings.useBudget
    ? 'Compares down payments in 0.1-point increments using the ending wealth shown in the chart. The monthly budget already includes each option’s mortgage payment. The cash reserve applies at closing and on each later annual forecast date.'
    : 'Compares down payments in 0.1-point increments and values payment savings at the personal investment return. The chart shows balances before any investment of payment savings. The cash reserve applies at closing and on each later annual forecast date.');
  if (canCompare) {
    const effectiveRate = 100 * Math.expm1(12 * Math.log1p(settings.interest / 1200));
    setText('optimizer-rates', `Personal investment return ${settings.investingReturn}% per year · Mortgage cost ${effectiveRate.toFixed(2)}% per year before PMI and fees`);
    const selected = forecast.compareDownPayment(settings, result);
    const percentages = [...new Set([settings.minimumDown, 20, settings.down, bestDownPayment?.down, 100])]
      .filter(value => value !== undefined).sort((a, b) => a - b);
    document.getElementById('optimizer-rows').innerHTML = percentages.map(down => {
      const option = down === settings.down ? selected : forecast.compareDownPayment({ ...settings, down });
      const change = option.score === null || selected.score === null ? '—'
        : signedCash.format(option.score - selected.score);
      const label = [down === settings.down && 'Selected', down === bestDownPayment?.down && 'Best']
        .filter(Boolean).join(', ');
      const cells = [cash.format(option.payment),
        option.closingCash === null ? '—' : cash.format(option.closingCash),
        option.endingNetWorth === null ? '—' : cash.format(option.endingNetWorth),
        change, option.issues.join(', ') || 'Meets limits'];
      return `<tr><th scope="row">${down}%${label ? ` · ${label}` : ''}</th>${cells.map(value => `<td>${value}</td>`).join('')}</tr>`;
    }).join('');
  } else {
    setText('optimizer-rates', '');
  }
  if (!bestDownPayment) {
    setText('optimizer-best', '');
    const message = !canCompare
      ? 'Select a purchase date after moving in and within the forecast to compare down payments.'
      : 'No down payment meets your closing costs, planned withdrawals, cash reserve, and payment cap.';
    setText('optimizer-details', message);
    return;
  }
  const { down, payment, closingCash } = bestDownPayment;
  button.disabled = down === settings.down;
  setText('optimizer-best', `${down}% down · ${cash.format(settings.price * down / 100)}`);
  setText('optimizer-details', `${cash.format(payment)}/mo initial loan payment · ${cash.format(closingCash)} available outside retirement after closing`);
}

function drawChart() {
  if (!chartData) return;
  const { scenario, hold, purchaseOnly } = chartData;
  const { width, height } = chart.getBoundingClientRect();
  if (width === 0 || height === 0) return;
  const density = window.devicePixelRatio || 1;
  chart.width = Math.round(width * density);
  chart.height = Math.round(height * density);
  const ctx = chart.getContext('2d');
  ctx.scale(density, density);
  ctx.font = '12px system-ui';
  const series = [scenario, hold, purchaseOnly];
  const values = series.flatMap(rows => rows.map(row => row.total));
  const high = Math.max(1, ...values);
  const low = Math.min(0, ...values);
  const left = Math.max(ctx.measureText(compactCash.format(high)).width,
    ctx.measureText(compactCash.format(low)).width) + 12;
  const right = width - 21;
  const top = 16;
  const bottom = height - 30;
  const x = i => left + i / (scenario.length - 1) * (right - left);
  const y = value => bottom - (value - low) / (high - low) * (bottom - top);
  ctx.fillStyle = '#526762';
  ctx.strokeStyle = '#dce5dc';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const value = low + (high - low) * i / 4;
    ctx.fillText(compactCash.format(value), left - 8, y(value));
    ctx.beginPath();
    ctx.moveTo(left, y(value));
    ctx.lineTo(right, y(value));
    ctx.stroke();
  }
  ctx.textAlign = 'center';
  const tickCount = Math.min(scenario.length - 1, width < 450 ? 3 : 6);
  for (let i = 0; i <= tickCount; i++) {
    const index = Math.round(i / tickCount * (scenario.length - 1));
    ctx.fillText(scenario[index].year, x(index), bottom + 17);
  }
  const purchaseIndex = scenario.findIndex(row => row.purchased);
  if (purchaseIndex >= 0) {
    ctx.strokeStyle = '#b9c9bc';
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(x(purchaseIndex), top);
    ctx.lineTo(x(purchaseIndex), bottom);
    ctx.stroke();
  }
  function plot(rows, color, dash, thickness) {
    ctx.strokeStyle = color;
    ctx.lineWidth = thickness;
    ctx.setLineDash(dash);
    ctx.beginPath();
    rows.forEach((row, i) => {
      if (i === 0) ctx.moveTo(x(i), y(row.total));
      else ctx.lineTo(x(i), y(row.total));
    });
    ctx.stroke();
  }
  plot(hold, '#6d7e84', [7, 5], 2);
  if (chartData.buy) plot(purchaseOnly, '#9a6022', [2, 4], 2);
  plot(scenario, '#12674f', [], 3);
}

function update() {
  const useBudget = form.elements.namedItem('useBudget').checked;
  const housing = form.elements.namedItem('movedHousing');
  const relet = form.elements.namedItem('relet').checked;
  const delay = document.getElementById('takeover-delay');
  delay.hidden = !relet;
  delay.querySelector('input').disabled = !relet;
  for (const field of form.querySelectorAll('[data-budget], [data-manual], #custom-housing')) {
    const visible = field.id === 'custom-housing' ? useBudget && housing.value === 'custom'
      : field.hasAttribute('data-budget') ? useBudget : !useBudget;
    field.hidden = !visible;
    field.querySelector('input, select').disabled = !visible;
  }
  if (!form.checkValidity()) {
    resetJointOptimizer(null);
    setText('status', 'Enter valid values to update the forecast. Results show the last valid scenario.');
    document.getElementById('optimizer-apply').disabled = true;
    return;
  }
  const today = new Date();
  const settings = { startYear: today.getFullYear(), startMonth: today.getMonth() };
  for (const input of form.querySelectorAll('input[type="checkbox"], input[type="number"]')) {
    settings[input.name] = input.type === 'checkbox' ? input.checked : input.valueAsNumber;
  }
  settings.moveDate = new Date(settings.startYear, today.getMonth() + settings.moveInMonths, 1);
  const leaseValue = form.elements.namedItem('leaseEnd').value;
  const [leaseYear, leaseMonth] = leaseValue.split('-').map(Number);
  settings.leaseEndMonths = leaseValue
    ? (leaseYear - settings.startYear) * 12 + leaseMonth - 1 - today.getMonth() : 0;
  if (!relet) settings.takeoverDelay = 0;
  settings.movedHousing = useBudget ? housing.value : 'person2';
  resetJointOptimizer(settings);
  const result = forecast(settings);
  updateHousingSchedule(settings, result.lease);
  const { overlapMonths, canRelet, fullCost, takeoverCost } = result.lease;
  const leaseEnd = leaseValue ? monthAndYear.format(new Date(leaseYear, leaseMonth - 1, 1)) : '';
  setText('lease-summary', overlapMonths
    ? `${overlapMonths} month${overlapMonths === 1 ? '' : 's'} of rent after the move through ${leaseEnd} would cost ${cash.format(fullCost)}. ${canRelet
      ? `A takeover ${relet && settings.takeoverDelay ? `after ${settings.takeoverDelay} month${settings.takeoverDelay === 1 ? '' : 's'} of rent` : 'right after the move'} would cost ${cash.format(takeoverCost)} including the fee, a difference of ${cash.format(fullCost - takeoverCost)}.`
      : 'The selected takeover delay runs through the end of the lease.'}`
    : leaseEnd ? `There is no rent overlap at the selected move-in date. The final rent month is ${leaseEnd}.`
      : 'Enter the final rent month to model a lease overlap.');
  setText('lease-active', useBudget
    ? `The forecast includes ${cash.format(relet ? takeoverCost : fullCost)} in lease overlap costs.`
    : 'Turn on Estimate savings from income and expenses to include these lease costs in the forecast.');
  document.getElementById('budget-summary').hidden = !useBudget;
  if (useBudget) {
    const budget = result.budget;
    setText('budget-take-home', `Estimated combined take-home pay is ${cash.format(budget.monthlyTakeHome)}/mo.`);
    setText('budget-before', signedCash.format(budget.beforeMove));
    document.getElementById('budget-overlap-card').hidden = !overlapMonths;
    setText('budget-overlap', signedCash.format(budget.duringOverlap));
    setText('budget-moved', signedCash.format(budget.afterMove));
    setText('budget-bought', settings.buy && settings.price > 0 ? signedCash.format(budget.afterPurchase) : '—');
  }
  updateTiming(settings);
  updateOptimizer(settings, result);
  const samePurchase = forecast({ ...settings, withdrawal: 0, annual: 0 });
  const hold = forecast({ ...settings, withdrawal: 0, annual: 0, buy: false });
  const last = result.rows.at(-1);
  const purchaseRow = result.rows.find(row => row.purchased);
  const issues = [];
  if (settings.buy && settings.buyIn * 12 <= settings.moveInMonths) issues.push('Choose a purchase date after your move-in date.');
  if (settings.buy && settings.buyIn > settings.years) issues.push('The purchase is beyond the forecast horizon.');
  if (last.purchaseGap >= 0.005) issues.push(`Purchase skipped in ${settings.startYear + settings.buyIn}. Available funds fell ${cash.format(last.purchaseGap)} short at closing.`);
  if (last.shortfall >= 0.005) issues.push(`${cash.format(last.shortfall)} in scheduled withdrawals went unfunded during the forecast.`);
  if (last.budgetShortfall >= 0.005) issues.push(`${cash.format(last.budgetShortfall)} in monthly expenses went unfunded. The forecast still shows the scheduled mortgage paydown, so these results assume the spending gap is covered separately.`);
  setText('status', issues.join(' '));
  setText('end-label', `${last.year} net worth`);
  setText('ending', cash.format(last.total));
  setText('available-end', cash.format(last.availableCash));
  setText('difference', signedCash.format(last.total - hold.rows.at(-1).total));
  const withdrawalEffect = last.total - samePurchase.rows.at(-1).total;
  const summary = [];
  if (purchaseRow) {
    const paymentLabel = result.initialPayment > result.payment
      ? 'initial principal, interest, and PMI' : 'principal and interest';
    summary.push(`Purchase in ${purchaseRow.year} · ${cash.format(result.initialPayment)}/mo ${paymentLabel}`);
  }
  if (settings.withdrawal || settings.annual) {
    summary.push(`Withdrawals change ending net worth by ${signedCash.format(withdrawalEffect)} versus the same plan with zero extra withdrawals`);
  }
  setText('purchase-summary', summary.join('. ') + (summary.length ? '.' : ''));
  document.getElementById('purchase-key').hidden = !settings.buy;
  const moveRowIndex = Math.ceil(settings.moveInMonths / 12);
  document.getElementById('annual-rows').innerHTML = result.rows.map((row, index) => {
    const milestones = [row.year];
    if (index === moveRowIndex) milestones.push(`Move in ${monthAndYear.format(settings.moveDate)}`);
    if (row === purchaseRow) milestones.push('Purchase');
    const year = milestones.join(' · ');
    const cells = [row.yourRetirement, row.partnerRetirement, row.yourTaxable, row.partnerTaxable,
      row.householdSavings, row.trust, row.homeEquity, row.total]
      .map(value => `<td>${cash.format(value)}</td>`).join('');
    return `<tr${row === purchaseRow ? ' class="purchase-row"' : ''}><th scope="row">${year}</th>${cells}</tr>`;
  }).join('');
  chartData = { scenario: result.rows, hold: hold.rows, purchaseOnly: samePurchase.rows, buy: settings.buy };
  drawChart();
}

form.addEventListener('input', update);
form.addEventListener('submit', event => event.preventDefault());
document.getElementById('joint-run').addEventListener('click', runJointOptimizer);
document.getElementById('joint-apply').addEventListener('click', () => {
  if (!jointResult) return;
  form.elements.namedItem('moveInMonths').value = jointResult.moveInMonths;
  form.elements.namedItem('down').value = jointResult.down;
  update();
});
document.getElementById('optimizer-apply').addEventListener('click', () => {
  if (!bestDownPayment || !form.checkValidity()) return;
  form.elements.namedItem('down').value = bestDownPayment.down;
  update();
});
new ResizeObserver(drawChart).observe(chart);
if (window.location.protocol === 'file:') {
  const defaults = document.createElement('script');
  defaults.src = 'local-defaults.js';
  defaults.onload = () => {
    applyDefaults(window.localForecastDefaults ?? {});
    update();
  };
  defaults.onerror = update;
  document.head.append(defaults);
} else {
  initHostedDefaults();
  update();
}
