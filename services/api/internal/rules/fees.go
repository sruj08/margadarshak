package rules

// Fee computation (BACKEND.md §6, D-06). Integer paise only; every amount comes
// from rulepacks/fees.json. per=class items repeat for each class (one line per
// class); per=application items appear once. State rows with `overrides`
// replace a base head for that state; other state rows are informational and
// never added to the total unless includedInTotal is true.

// effectiveFeeItems returns the base fee heads with this state's overrides applied.
func (c *Compiled) effectiveFeeItems() []*FeeItem {
	out := make([]*FeeItem, 0, len(c.Fees.Items))
	for _, it := range c.Fees.Items {
		chosen := it
		for _, s := range c.Fees.StateItems {
			if s.State == c.PackID && s.Overrides == it.ID {
				chosen = s
			}
		}
		out = append(out, chosen)
	}
	return out
}

// FeeQuote returns the quote for a class list (exported for API-03).
func (c *Compiled) FeeQuote(classes []string) FeeQuote { return c.feeQuote(classes) }

func (c *Compiled) feeQuote(classes []string) FeeQuote {
	items := c.effectiveFeeItems()
	q := FeeQuote{
		Classes: append([]string{}, classes...), Lines: []FeeLine{}, StateItems: []StateFee{}, Retest: []RetestFee{},
		Excludes: append([]string{}, c.Fees.Excludes...),
	}
	addLine := func(it *FeeItem, class *string) {
		q.Lines = append(q.Lines, FeeLine{
			FeeID: it.ID, LabelKey: it.LabelKey, Per: it.Per, ClassCode: class, Quantity: 1,
			UnitPaise: it.Amount, AmountPaise: it.Amount, Stage: it.Stage, RuleID: it.ID,
		})
		q.TotalPaise += it.Amount
		if it.Stage == "LL" {
			q.LLStagePaise += it.Amount
		}
		if it.SmartCard {
			q.SmartCardPaise += it.Amount
		}
	}
	for _, it := range items {
		if it.Per == "class" {
			for _, cl := range classes {
				addLine(it, sp(cl))
			}
			continue
		}
		addLine(it, nil)
	}
	for _, s := range c.Fees.StateItems {
		if s.State != c.PackID || s.Overrides != "" {
			continue
		}
		included := s.IncludedInTotal != nil && *s.IncludedInTotal
		if included {
			addLine(s, nil)
		}
		q.StateItems = append(q.StateItems, StateFee{FeeID: s.ID, LabelKey: s.LabelKey, AmountPaise: s.Amount, IncludedInTotal: included, Provenance: prov(s.Provenance)})
	}
	for _, r := range c.Fees.Retest {
		q.Retest = append(q.Retest, RetestFee{FeeID: r.ID, LabelKey: r.LabelKey, Per: r.Per, AmountPaise: r.Amount})
	}
	q.SubtotalGovtFeePaise = q.TotalPaise - q.SmartCardPaise
	if len(items) > 0 {
		q.Provenance = prov(items[0].Provenance)
	}
	return q
}
