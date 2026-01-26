def run_dcf(payload: dict):
    years = int(payload.get("years", 10))
    growth = float(payload.get("growth", 0.10))
    wacc = float(payload.get("wacc", 0.11))
    tg = float(payload.get("terminal_growth", 0.04))

    revenue0 = float(payload.get("revenue", 1000))
    ebit_m = float(payload.get("ebit_margin", 0.18))
    tax = float(payload.get("tax_rate", 0.25))
    da_pct = float(payload.get("da_pct", 0.04))
    capex_pct = float(payload.get("capex_pct", 0.06))
    wc_pct = float(payload.get("wc_pct", 0.01))

    revenues, fcffs = [], []
    rev = revenue0

    for _ in range(years):
        rev *= (1 + growth)
        ebit = rev * ebit_m
        nopat = ebit * (1 - tax)
        da = rev * da_pct
        capex = rev * capex_pct
        wc = rev * wc_pct
        fcff = nopat + da - capex - wc

        revenues.append(rev)
        fcffs.append(fcff)

    pv_fcff = sum(fcffs[t] / ((1 + wacc) ** (t + 1)) for t in range(years))
    terminal_fcf = fcffs[-1] * (1 + tg)
    terminal_value = terminal_fcf / (wacc - tg)
    pv_terminal = terminal_value / ((1 + wacc) ** years)

    enterprise_value = pv_fcff + pv_terminal

    return {
        "enterprise_value": round(enterprise_value, 2),
        "pv_fcff": round(pv_fcff, 2),
        "pv_terminal": round(pv_terminal, 2),
        "fcff_series": [round(x, 2) for x in fcffs],
        "revenue_series": [round(x, 2) for x in revenues],
    }
