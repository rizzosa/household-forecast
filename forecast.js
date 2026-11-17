(function (root) {
  function forecast(settings) {
    const { years, startYear, roth, traditional, trust, equity, iraReturn, trustReturn,
      appreciation, buy, buyIn, price, down, closing, sell, withdrawal, annual,
      withdrawIn, interest, term, pmi = 0, yourRetirement = 0,
      yourInvestments = 0, partnerInvestments = 0, investingReturn = trustReturn,
      useTrust = true, monthlySavings = 0, moveSavings = 0,
      person1Roth = 0, useBudget = false, person1Salary = 0, person2Salary = 0,
      person1TakeHome = 75, person2TakeHome = 75, person1Housing = 0, person2Housing = 0,
      livingCosts = 0, movedHousing = 'person2', customHousing = 0, ownerCosts = 0,
      leaseEndMonths = 0, relet = false, takeoverDelay = 0 } = settings;
    const moveInMonths = settings.moveInMonths ?? (settings.moveIn ?? -1) * 12;
    const overlapMonths = Math.max(0, leaseEndMonths - Math.max(0, moveInMonths));
    const canRelet = takeoverDelay < overlapMonths;
    const takeoverMonth = relet && canRelet ? moveInMonths + takeoverDelay + 1 : null;
    const lease = {
      overlapMonths, canRelet, takeoverMonth,
      rentMonthsAfterMove: takeoverMonth === null ? overlapMonths : takeoverDelay,
      fullCost: overlapMonths * person1Housing,
      takeoverCost: (canRelet ? takeoverDelay + 1 : overlapMonths) * person1Housing
    };
    let rothBalance = roth;
    let traditionalBalance = traditional;
    let trustBalance = trust;
    let yourRetirementBalance = person1Roth + yourRetirement;
    let yourInvestmentsBalance = yourInvestments;
    let partnerInvestmentsBalance = partnerInvestments;
    let householdSavings = 0;
    let oldEquity = equity;
    let homeValue = 0;
    let mortgage = 0;
    let shortfall = 0;
    let budgetShortfall = 0;
    let purchaseGap = 0;
    let purchased = false;
    let paymentCost = 0;
    let paymentsMade = 0;
    const loan = price * (1 - down / 100);
    const monthlyRate = interest / 1200;
    const months = term * 12;
    const payment = monthlyRate === 0 ? loan / months
      : loan * monthlyRate / -Math.expm1(-months * Math.log1p(monthlyRate));
    const mortgageInsurance = down < 20 ? loan * pmi / 1200 : 0;
    const investingFactor = 1 + investingReturn / 100;
    const monthlyInvestingFactor = investingFactor ** (1 / 12);
    const monthlyTakeHome = (person1Salary * person1TakeHome + person2Salary * person2TakeHome) / 1200;
    const currentHousing = person1Housing + person2Housing;
    const sharedHousing = { person1: person1Housing, person2: person2Housing,
      both: currentHousing, custom: customHousing }[movedHousing];
    const beforeMove = monthlyTakeHome - livingCosts - currentHousing;
    const afterMove = monthlyTakeHome - livingCosts - sharedHousing;
    const afterPurchase = monthlyTakeHome - livingCosts - ownerCosts;
    const availableCash = () => householdSavings + yourInvestmentsBalance +
      partnerInvestmentsBalance + (useTrust ? trustBalance : 0);

    function draw(amount) {
      const fromSavings = Math.min(amount, householdSavings);
      householdSavings -= fromSavings;
      let remaining = amount - fromSavings;
      const investments = yourInvestmentsBalance + partnerInvestmentsBalance;
      if (investments > 0) {
        const retainedFraction = Math.max(0, 1 - remaining / investments);
        yourInvestmentsBalance *= retainedFraction;
        partnerInvestmentsBalance *= retainedFraction;
        remaining = Math.max(0, remaining - investments);
      }
      if (useTrust) {
        const fromTrust = Math.min(remaining, trustBalance);
        trustBalance -= fromTrust;
        remaining -= fromTrust;
      }
      return remaining;
    }

    const rows = [];
    for (let offset = 0; offset <= years; offset++) {
      if (offset > 0) {
        rothBalance *= 1 + iraReturn / 100;
        traditionalBalance *= 1 + iraReturn / 100;
        yourRetirementBalance *= 1 + iraReturn / 100;
        trustBalance *= 1 + trustReturn / 100;
        yourInvestmentsBalance *= investingFactor;
        partnerInvestmentsBalance *= investingFactor;
        if (purchased) homeValue *= 1 + appreciation / 100;
        for (let month = 0; month < 12; month++) {
          const elapsedMonth = (offset - 1) * 12 + month + 1;
          const moved = elapsedMonth > moveInMonths;
          const manualSavings = monthlySavings + (moved && !purchased ? moveSavings : 0);
          // The first replacement month incurs the reletting fee in place of rent.
          const leaseCost = moved && elapsedMonth <= (takeoverMonth ?? leaseEndMonths) ? person1Housing : 0;
          let loanPayment = 0;
          if (purchased) {
            paymentCost *= monthlyInvestingFactor;
            if (loan > 0 && paymentsMade < months) {
              const amountDue = mortgage * (1 + monthlyRate);
              const principalAndInterest = Math.min(payment, amountDue);
              const insurance = mortgage > price * 0.8 ? mortgageInsurance : 0;
              loanPayment = principalAndInterest + insurance;
              paymentCost += loanPayment;
              paymentsMade++;
              mortgage = paymentsMade === months ? 0 : Math.max(0, amountDue - principalAndInterest);
            }
          }
          householdSavings *= monthlyInvestingFactor;
          const budgetSavings = (purchased ? afterPurchase - loanPayment : moved ? afterMove : beforeMove) - leaseCost;
          const contribution = useBudget ? budgetSavings : manualSavings;
          if (contribution < 0) budgetShortfall += draw(-contribution);
          else householdSavings += contribution;
        }
      }
      if (offset >= withdrawIn) {
        shortfall += draw(annual + (offset === withdrawIn ? withdrawal : 0));
      }
      let cashToClose = null;
      if (buy && offset === buyIn && offset * 12 > moveInMonths) {
        const cost = price * down / 100 + closing;
        cashToClose = availableCash() + (sell ? oldEquity : 0);
        purchaseGap = Math.max(0, cost - cashToClose);
        if (purchaseGap <= 1e-8) {
          const saleProceeds = sell ? oldEquity : 0;
          if (sell) oldEquity = 0;
          householdSavings += Math.max(0, saleProceeds - cost);
          draw(Math.max(0, cost - saleProceeds));
          purchased = true;
          homeValue = price;
          mortgage = loan;
        }
      }
      const homeEquity = oldEquity + homeValue - mortgage;
      const partnerRetirement = rothBalance + traditionalBalance;
      rows.push({ year: startYear + offset, yourRetirement: yourRetirementBalance, partnerRetirement,
        yourTaxable: yourInvestmentsBalance, partnerTaxable: partnerInvestmentsBalance,
        householdSavings, trust: trustBalance, homeEquity,
        availableCash: availableCash(), cashToClose,
        total: yourRetirementBalance + partnerRetirement + yourInvestmentsBalance + partnerInvestmentsBalance +
          householdSavings + trustBalance + homeEquity, shortfall, budgetShortfall, purchaseGap, purchased });
    }
    const initialPayment = payment + mortgageInsurance;
    return { rows, payment, initialPayment, paymentCost, lease, budget: {
      monthlyTakeHome, beforeMove, afterMove, duringOverlap: afterMove - person1Housing,
      afterPurchase: afterPurchase - initialPayment
    } };
  }

  function compareDownPayment(settings, result = forecast(settings)) {
    const closing = result.rows[settings.buyIn];
    const ending = result.rows.at(-1);
    const issues = [];
    if (settings.down < settings.minimumDown) issues.push('Below minimum down payment');
    if (!closing?.purchased) issues.push('Insufficient cash to close');
    if (ending.shortfall >= 0.005) issues.push('Unfunded withdrawals');
    if (ending.budgetShortfall >= 0.005) issues.push('Unfunded monthly expenses');
    if (settings.paymentCap > 0 && result.initialPayment > settings.paymentCap + 0.005) {
      issues.push('Above payment cap');
    }
    if (closing?.purchased && result.rows.slice(settings.buyIn)
      .some(row => row.availableCash + 0.005 < (settings.cashReserve ?? settings.trustReserve))) {
      issues.push('Below cash reserve');
    }
    return {
      down: settings.down,
      cashToClose: closing?.cashToClose ?? null,
      closingCash: closing?.purchased ? closing.availableCash : null,
      payment: result.initialPayment,
      endingNetWorth: closing?.purchased ? ending.total : null,
      score: closing?.purchased ? ending.total - (settings.useBudget ? 0 : result.paymentCost) : null,
      issues
    };
  }

  function optimizeDownPayment(settings) {
    let best = null;
    if (!settings.buy || settings.price <= 0 || settings.buyIn > settings.years ||
        settings.buyIn * 12 <= (settings.moveInMonths ?? (settings.moveIn ?? -1) * 12)) return best;
    for (let tenth = Math.round(settings.minimumDown * 10); tenth <= 1000; tenth++) {
      const option = compareDownPayment({ ...settings, down: tenth / 10 });
      if (!option.issues.length && (!best || option.score > best.score + 0.005)) best = option;
    }
    return best;
  }

  forecast.optimizeDownPayment = optimizeDownPayment;
  forecast.compareDownPayment = compareDownPayment;
  if (typeof module === 'object') module.exports = forecast;
  else root.forecast = forecast;
})(globalThis);
